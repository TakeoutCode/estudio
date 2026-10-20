import { cardIdFor, newId, Rating } from '@estudio/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { useStoredTheme } from '@/app/use-stored-theme';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { readProfile, readStudyConfig, readUiSettings } from '@/db/settings';
import { createNote } from '@/features/notes';
import { answerCard } from '@/features/study';
import { projectionApi } from '@/workers/projection-api';
import { ensureProfileTimeZone } from './commands';
import { loadProjectionInput } from './queries';
import { SettingsScreen } from './SettingsScreen';

// jsdom no tiene Worker: el worker corre en el mismo hilo.
vi.mock('@/workers/projection', async () => {
  const api = (await import('@/workers/projection-api')).projectionApi;
  return {
    projectionWorker: () => ({
      projectLoads: (...args: Parameters<typeof api.projectLoads>) =>
        Promise.resolve(api.projectLoads(...args)),
      replayCards: (...args: Parameters<typeof api.replayCards>) => Promise.resolve(api.replayCards(...args)),
      breakUsage: (...args: Parameters<typeof api.breakUsage>) => Promise.resolve(api.breakUsage(...args)),
    }),
  };
});

const T0 = Date.UTC(2026, 9, 20, 15);
const DAY = 86_400_000;
const SESSION = '0192f1a0-0000-7000-8000-00000000a001';

const renderSettings = () =>
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <SettingsScreen />
    </MemoryRouter>,
  );

async function studied(count: number) {
  for (let i = 0; i < count; i += 1) {
    const start = T0 - (12 + (i % 20)) * DAY;
    const content = { kind: 'basic', front: `¿${i}?`, back: 'R', explanation: '', reverse: false } as const;
    const note = await createNote({ deck: { name: 'Anatomía' }, content }, { now: start - 1 });
    const cardId = cardIdFor(note.id, 0);
    for (const at of [start, start + 600_000, start + (2 + (i % 3)) * DAY]) {
      await answerCard(
        { cardId, rating: Rating.Good, durationMs: 4_000, sessionId: SESSION, confidence: null },
        { now: at },
      );
    }
  }
}

/** La misma proyección que usa la pantalla, sin redondear. */
async function projectedPerDay(retention: number) {
  const [load] = projectionApi.projectLoads(await loadProjectionInput(db, T0), [retention]);
  return load?.reviewsPerDay ?? -1;
}

/** Lo que debería mostrar: la misma proyección, redondeada. */
const expectedPerDay = async (retention: number) => Math.round(await projectedPerDay(retention));

const reviews = (n: number) => `${String(n)} ${n === 1 ? 'repaso' : 'repasos'} al día`;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  await db.delete({ disableAutoOpen: false });
  await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Ajustes · retención objetivo (R2, LD8)', () => {
  it('R2: al moverla muestra la carga nueva frente a la actual, y no se guarda sola (LD9)', async () => {
    await studied(30);
    renderSettings();
    const now90 = await expectedPerDay(0.9);
    expect(await screen.findByText(`Con 90 %: ≈ ${reviews(now90)}`)).toBeTruthy();

    const up = screen.getByRole('button', { name: 'Subir la retención objetivo' });
    for (let i = 0; i < 5; i += 1) fireEvent.click(up);
    expect(screen.getByText('95 %', { selector: 'output' })).toBeTruthy();
    expect(up.hasAttribute('disabled')).toBe(true); // tope del rango de R2

    const at95 = await expectedPerDay(0.95);
    // R2: más retención, más repasos. Sin redondear: con ids al azar, a veces redondean igual.
    expect(await projectedPerDay(0.95)).toBeGreaterThan(await projectedPerDay(0.9));
    expect(await screen.findByText(`Con 95 %: ≈ ${reviews(at95)}`)).toBeTruthy();
    expect(screen.getByText(`Ahora, con 90 %: ≈ ${reviews(now90)}`)).toBeTruthy();
    expect(screen.getByText(/se recalculan con este valor/)).toBeTruthy();
    expect((await readStudyConfig(db)).fsrs.requestRetention).toBe(0.9);

    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Cambios guardados.')).toBeTruthy();
    expect((await readStudyConfig(db)).fsrs.requestRetention).toBe(0.95);
    expect(await screen.findByText(`Con 95 %: ≈ ${reviews(at95)}`)).toBeTruthy();
  });

  it('§5: dice cuánto olvido es lo esperado con el valor elegido; el control respeta 80-95', async () => {
    renderSettings();
    expect(
      await screen.findByText('Con 90 %, olvidar unas 10 de cada 100 al repasarlas es lo esperado.'),
    ).toBeTruthy();
    const slider = screen.getByRole('slider', { name: 'Retención objetivo' });
    expect(slider.getAttribute('min')).toBe('80');
    expect(slider.getAttribute('max')).toBe('95');
    fireEvent.change(slider, { target: { value: '85' } });
    expect(
      screen.getByText('Con 85 %, olvidar unas 15 de cada 100 al repasarlas es lo esperado.'),
    ).toBeTruthy();
  });

  it('UX3: sin tarjetas explica para qué sirve la carga en lugar de mostrar 0', async () => {
    renderSettings();
    expect(await screen.findByText(/Cuando tengas tarjetas/)).toBeTruthy();
    expect(screen.queryByText(/≈/)).toBeNull();
  });
});

describe('Ajustes · temporizador (R7)', () => {
  it('R7: acepta minutos fuera de los presets dentro de sus rangos y avisa fuera de ellos', async () => {
    renderSettings();
    const save = await screen.findByRole('button', { name: 'Guardar cambios' });
    expect(save.hasAttribute('disabled')).toBe(true); // sin cambios

    fireEvent.change(screen.getByLabelText('Enfoque (min)'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Descanso largo (min)'), { target: { value: '61' } });
    expect(screen.getByText('Escribe un número de 5 a 60.')).toBeTruthy();
    expect(save.hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Restar uno: Descanso largo (min)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sumar uno: Bloques antes del largo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restar uno: Descanso corto (min)' }));
    expect(save.hasAttribute('disabled')).toBe(false);
    fireEvent.click(save);

    expect(await screen.findByText('Cambios guardados.')).toBeTruthy();
    await waitFor(async () => {
      expect((await readStudyConfig(db)).timer).toMatchObject({
        focusMin: 40,
        shortBreakMin: 4,
        longBreakMin: 60,
        cyclesBeforeLong: 5,
      });
    });
  });
});

describe('Ajustes · confianza y métricas (R6, UX9)', () => {
  it('R6, UX9: pedir confianza y ocultar una métrica se guardan con "Guardar cambios"', async () => {
    renderSettings();
    const confidence = await screen.findByRole('checkbox', { name: /Pedir tu confianza/ });
    expect((confidence as HTMLInputElement).checked).toBe(false); // R6: opcional, apagada al inicio
    fireEvent.click(confidence);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Retención real' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText('Cambios guardados.')).toBeTruthy();
    const config = await readStudyConfig(db);
    expect(config.review.askConfidence).toBe(true);
    expect(config.metrics.visible).toMatchObject({ retention: false, activeTime: true, calibration: true });
  });
});

describe('Ajustes · uso de descansos (§5)', () => {
  const block = (
    kind: 'focus' | 'break_short',
    outcome: 'completed' | 'interrupted',
    at: number,
    extended = false,
  ) => ({
    id: newId(),
    timerSessionId: SESSION,
    deviceId: SESSION,
    kind,
    blockIndex: 0,
    mode: 'flexible' as const,
    startedAt: at - 60_000,
    endedAt: at,
    plannedMs: 60_000,
    activeMs: 60_000,
    outcome,
    extended,
  });

  it('§5: sin temporizador lo explica; con bloques cuenta tomados, terminados antes y extendidos', async () => {
    const { unmount } = renderSettings();
    expect(await screen.findByText(/Cuando uses el temporizador/)).toBeTruthy();
    unmount();

    await db.timerBlockLogs.bulkAdd([
      block('focus', 'completed', T0 - 3_600_000, true),
      block('break_short', 'completed', T0 - 3_000_000),
      block('focus', 'completed', T0 - 2 * DAY),
      block('break_short', 'interrupted', T0 - 2 * DAY + 60_000),
    ]);
    renderSettings();
    const section = await screen.findByRole('region', { name: 'Tus descansos' });
    const value = (term: string) => within(section).getByText(term).nextElementSibling?.textContent;
    expect(await within(section).findByText('Descansos completos')).toBeTruthy();
    expect(value('Descansos completos')).toBe('1');
    expect(value('Descansos terminados antes de tiempo')).toBe('1');
    expect(value('Bloques en los que sumaste minutos')).toBe('1');
  });
});

describe('Ajustes · apariencia (UX5)', () => {
  it('UX5: elegir Oscuro lo guarda en UserSettings.ui y se aplica a la app', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Oscuro' }));
    await waitFor(async () => {
      expect((await readUiSettings(db)).theme).toBe('dark');
    });
    expect(screen.getByRole('button', { name: 'Oscuro' }).getAttribute('aria-pressed')).toBe('true');

    const Layout = () => {
      useStoredTheme();
      return null;
    };
    render(<Layout />);
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark');
    });
  });
});

describe('Ajustes · hora de dormir (P6)', () => {
  /** La zona de este dispositivo, distinta de la que trae el perfil por defecto. */
  function deviceIn(timeZone: string) {
    const real = new Intl.DateTimeFormat().resolvedOptions();
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ ...real, timeZone });
  }

  it('P6: sin hora elegida dice que se usa el inicio de las horas silenciosas', async () => {
    renderSettings();
    expect(await screen.findByText(/^Sin una hora elegida .* de 22:00 a 07:00/)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('¿A qué hora sueles dormir?').value).toBe('');
    expect(screen.queryByRole('button', { name: 'Quitar esta hora' })).toBeNull();
  });

  it('P6: elegirla la guarda al momento, con la zona del dispositivo, y dice la franja; se puede quitar', async () => {
    deviceIn('Europe/Madrid');
    renderSettings();
    fireEvent.change(await screen.findByLabelText('¿A qué hora sueles dormir?'), {
      target: { value: '23:30' },
    });
    expect(screen.getByText(/^De 23:30 a 07:00, la sesión te sugiere parar/)).toBeTruthy();
    await waitFor(async () => {
      expect(await readProfile(db)).toEqual({ timeZone: 'Europe/Madrid', bedtime: '23:30' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Quitar esta hora' }));
    expect(screen.getByText(/^Sin una hora elegida/)).toBeTruthy();
    await waitFor(async () => {
      expect((await readProfile(db)).bedtime).toBeNull();
    });
  });

  it('AG6: con un perfil ya guardado no cambia su zona', async () => {
    await ensureProfileTimeZone('America/Bogota');
    deviceIn('Europe/Madrid');
    renderSettings();
    fireEvent.change(await screen.findByLabelText('¿A qué hora sueles dormir?'), {
      target: { value: '21:00' },
    });
    await waitFor(async () => {
      expect(await readProfile(db)).toEqual({ timeZone: 'America/Bogota', bedtime: '21:00' });
    });
  });

  it('P6: a la misma hora en que terminan las horas silenciosas, avisa que no habrá sugerencia', async () => {
    renderSettings();
    fireEvent.change(await screen.findByLabelText('¿A qué hora sueles dormir?'), {
      target: { value: '07:00' },
    });
    expect(screen.getByText(/así que la sesión no te sugerirá parar por la hora/)).toBeTruthy();
  });
});
