import { newId, type ReviewLog } from '@estudio/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { updateGamificationConfig } from '@/features/settings';
import { TodayScreen } from '@/features/today';
import { answerGamification, saveReward } from './commands';
import { GamificationCard } from './GamificationCard';
import { GamificationSection } from './GamificationSection';
import { MilestoneCelebration } from './MilestoneCelebration';
import { useGamificationConfig } from './queries';
import { RewardsScreen } from './RewardsScreen';

// jsdom no tiene Worker: el worker corre en el mismo hilo.
vi.mock('@/workers/projection', async () => {
  const api = (await import('@/workers/projection-api')).projectionApi;
  return {
    projectionWorker: () => ({
      gamificationSummary: (...args: Parameters<typeof api.gamificationSummary>) =>
        Promise.resolve(api.gamificationSummary(...args)),
    }),
  };
});

const ME = '0192f1a0-0000-7000-8000-00000000c0de';
const T0 = Date.UTC(2026, 9, 20, 15);

const review = (reviewedAt: number, type: ReviewLog['type'] = 'review'): ReviewLog => ({
  id: newId(),
  cardId: newId(),
  cardKind: 'basic',
  reviewedAt,
  rating: 3,
  durationMs: 3000,
  type,
  confidence: null,
  sessionId: newId(),
  deviceId: newId(),
});

/** Con los valores iniciales: 10 XP y 1 moneda por repaso; el nivel 1 pide 100 XP. */
const answered = (count: number, at = T0) =>
  db.reviewLogs.bulkAdd(Array.from({ length: count }, (_, i) => review(at - (i + 1) * 1000)));

const inRouter = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); // QA1: reloj falso, nunca el real
  vi.setSystemTime(T0);
  await db.delete({ disableAutoOpen: false });
  await db.meta.put({ key: 'accountUserId', value: ME });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('UX10: la pregunta del onboarding', () => {
  it('mientras no responde, Hoy pregunta sin mostrar nada de gamificación', async () => {
    const { container } = inRouter(<GamificationCard />);
    expect(await screen.findByRole('heading', { name: '¿Quieres puntos, niveles y premios?' })).toBeTruthy();
    expect(container.querySelector('[data-gamification]')).toBeNull();
  });

  it('"No, gracias" la deja apagada y la pregunta no vuelve', async () => {
    const { container } = inRouter(<GamificationCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'No, gracias' }));
    await vi.waitFor(() => {
      expect(container.textContent).toBe('');
    });
  });

  it('"Sí, activarlos" muestra su nivel y sus monedas, calculados de sus repasos', async () => {
    await answered(12);
    inRouter(<GamificationCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, activarlos' }));
    expect(await screen.findByText('Nivel 2')).toBeTruthy();
    expect(screen.getByText('12 monedas')).toBeTruthy();
    expect(
      screen.getByRole('progressbar', { name: 'Avance del nivel 2' }).getAttribute('aria-valuenow'),
    ).toBe('20');
    expect(screen.getByRole('link', { name: 'Premios y logros' }).getAttribute('href')).toBe('/rewards');
  });

  it('racha opcional: aparece solo si la activa, y en pausa sin texto de pérdida', async () => {
    await answerGamification(true);
    await db.reviewLogs.add(review(T0 - 5 * 86_400_000));
    const { container } = inRouter(<GamificationCard />);
    expect(await screen.findByText('Nivel 1')).toBeTruthy();
    expect(container.textContent).not.toMatch(/racha/i);
    await updateGamificationConfig((c) => ({ ...c, streakEnabled: true }));
    expect(await screen.findByText('Racha en pausa: 1 día de estudio')).toBeTruthy();
    expect(container.textContent).not.toMatch(/perd|rompi|riesgo/i);
  });
});

describe('UX10: premios que ella define', () => {
  it('apagada, la pantalla de premios solo ofrece ir a Ajustes', async () => {
    await answerGamification(false);
    const { container } = inRouter(<RewardsScreen />);
    expect(await screen.findByText(/están apagados/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir a Ajustes' }).getAttribute('href')).toBe('/settings');
    expect(container.querySelector('[data-gamification]')).toBeNull();
  });

  it('agrega un premio, pide confirmar el canje y descuenta las monedas', async () => {
    await answerGamification(true);
    await answered(30);
    inRouter(<RewardsScreen />);
    expect(await screen.findByText('Tienes 30 monedas')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Premio' }), {
      target: { value: 'Ver un capítulo' },
    });
    const cost = screen.getByRole('textbox', { name: 'Costo en monedas' });
    fireEvent.change(cost, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    const redeem = await screen.findByRole('button', { name: 'Canjear Ver un capítulo' });

    fireEvent.click(redeem);
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('¿Canjear Ver un capítulo por 25 monedas?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Canjear' }));
    expect(await screen.findByText('Tienes 5 monedas')).toBeTruthy();
    expect(await screen.findByText('Canjeaste Ver un capítulo. ¡Disfrútalo!')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Lo que canjeaste' })).toBeTruthy();

    // Ya no alcanza: el botón queda deshabilitado y dice cuánto falta, sin culpa.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Canjear Ver un capítulo' }).disabled).toBe(
      true,
    );
    expect(screen.getByText('Te faltan 20 monedas')).toBeTruthy();
  });

  it('logros: los ganados con su fecha y los demás con cómo se consiguen', async () => {
    await answerGamification(true);
    await db.reviewLogs.add(review(T0, 'exam'));
    inRouter(<RewardsScreen />);
    expect(await screen.findByText('Primer simulacro')).toBeTruthy();
    expect(screen.getAllByText(/^Desde el /)).toHaveLength(2); // primer repaso y primer simulacro
    expect(screen.getByText('Al completar tu primer bloque con el temporizador')).toBeTruthy();
  });

  it('editar un premio no cambia lo canjeado; borrar pide confirmación', async () => {
    await answerGamification(true);
    await saveReward({ name: 'Un postre', cost: 10 });
    inRouter(<RewardsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Un postre' }));
    fireEvent.click(screen.getByRole('button', { name: 'Borrar premio' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('Lo que ya canjeaste no cambia');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Borrar premio' }));
    expect(await screen.findByText(/Todavía no hay premios/)).toBeTruthy();
  });
});

describe('UX10: Ajustes', () => {
  it('se activa y se apaga en cualquier momento; la racha y las celebraciones solo con ella activa', async () => {
    inRouter(<GamificationSection />);
    const toggle = await screen.findByRole<HTMLInputElement>('checkbox', {
      name: 'Puntos, niveles y premios',
    });
    expect(toggle.checked).toBe(false);
    expect(screen.queryByRole('checkbox', { name: /Racha/ })).toBeNull();
    fireEvent.click(toggle);
    const streak = await screen.findByRole<HTMLInputElement>('checkbox', {
      name: /Racha de días de estudio/,
    });
    expect(streak.checked).toBe(false); // apagada por defecto
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /Celebraciones/ }).checked).toBe(true);
  });
});

/** La configuración que lee la celebración, para esperar a que esté cargada (QA1). */
function CelebrationsSetting() {
  const config = useGamificationConfig();
  return config ? <output>{`celebraciones: ${config.celebrations ? 'sí' : 'no'}`}</output> : null;
}

describe('UX6: celebraciones solo en hitos', () => {
  it('avisa al subir de nivel o ganar un logro durante la sesión, no en cada tarjeta', async () => {
    await answerGamification(true);
    await answered(8, T0 - 60_000);
    render(<MilestoneCelebration />);
    const region = await screen.findByRole('status');
    // El resumen base del worker llega antes de responder.
    await vi.waitFor(() => {
      expect(region.dataset.evaluated).toBe('0');
    });

    await db.reviewLogs.add(review(T0 + 1000));
    await vi.waitFor(() => {
      expect(region.dataset.evaluated).toBe('1');
    });
    expect(region.textContent).toBe(''); // 90 XP: sin hito

    await db.reviewLogs.add(review(T0 + 2000, 'contrast'));
    expect(await within(region).findByText('Nivel 2')).toBeTruthy();
    expect(within(region).getByText('Logro: Primer set de contraste')).toBeTruthy();
    fireEvent.click(within(region).getByRole('button'));
    expect(region.textContent).toBe('');
  });

  it('con las celebraciones apagadas no aparece nada', async () => {
    await answerGamification(true);
    await updateGamificationConfig((c) => ({ ...c, celebrations: false }));
    const { container } = render(
      <>
        <MilestoneCelebration />
        <CelebrationsSetting />
      </>,
    );
    // Ya leyó la configuración (apagada) cuando llega el repaso que daría un logro.
    await screen.findByText('celebraciones: no');
    await db.reviewLogs.add(review(T0 + 1000, 'contrast'));
    expect(await db.reviewLogs.count()).toBeGreaterThan(0);
    expect(container.querySelector('[data-gamification]')).toBeNull();
  });
});

describe('QUALITY §4: con la gamificación apagada no hay nodos data-gamification', () => {
  it('ni en Hoy, ni en premios, ni en la sesión', async () => {
    await answerGamification(false);
    await answered(30);
    const { container } = inRouter(
      <>
        <TodayScreen />
        <RewardsScreen />
        <GamificationSection />
        <MilestoneCelebration />
      </>,
    );
    expect(await screen.findByText(/están apagados/)).toBeTruthy();
    expect(await screen.findByRole('checkbox', { name: 'Puntos, niveles y premios' })).toBeTruthy();
    expect(container.querySelector('[data-gamification]')).toBeNull();
    expect(container.textContent).not.toMatch(/XP|monedas|Nivel \d|racha/i);
  });
});
