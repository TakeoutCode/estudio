import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { readNotificationPrefs } from '@/db/settings';
import { NotificationsSection } from './NotificationsSection';
import type { PushEnvironment } from './push';

const mocks = vi.hoisted(() => ({
  environment: null as PushEnvironment | null,
  enable: vi.fn<() => Promise<'granted' | 'denied'>>(),
  disable: vi.fn<() => Promise<void>>(),
}));

vi.mock('./push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./push')>()),
  detectEnvironment: () => mocks.environment,
  deviceSubscription: () => Promise.resolve(null),
  notificationPermission: () => 'default',
}));
vi.mock('./commands', () => ({ enableOnThisDevice: mocks.enable, disableOnThisDevice: mocks.disable }));

const DESKTOP: PushEnvironment = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0',
  maxTouchPoints: 0,
  standalone: false,
  hasPush: true,
  vapidKey: 'clave',
};

beforeEach(async () => {
  mocks.environment = DESKTOP;
  mocks.enable.mockResolvedValue('granted');
  mocks.disable.mockResolvedValue();
  await db.delete({ disableAutoOpen: false });
  await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Ajustes · Avisos (NOTIFICATIONS §1, NT8)', () => {
  it('NT8: explica para qué sirven, pide el permiso con un toque y luego deja elegir la hora', async () => {
    render(<NotificationsSection />);
    expect(
      await screen.findByText(/Nunca entre las 22:00 y las 07:00, y como máximo 2 recordatorios al día/),
    ).toBeTruthy();
    expect((await readNotificationPrefs(db)).enabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Activar avisos' }));
    const daily = await screen.findByLabelText<HTMLInputElement>('Recordatorio diario');
    expect(mocks.enable).toHaveBeenCalledOnce();
    // La pantalla cambia al tocar; lo guardado en Dexie puede llegar un instante después.
    await waitFor(async () => {
      expect(await readNotificationPrefs(db)).toMatchObject({ enabled: true, dailyReminderTime: null });
    });
    const profile = await db.userSettings.where('section').equals('profile').first();
    expect(profile?.data).toMatchObject({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });

    // NT3: dentro de las horas silenciosas no se guarda, y se dice por qué.
    fireEvent.change(daily, { target: { value: '23:00' } });
    expect(await screen.findByText('Esa hora cae en tus horas silenciosas; elige otra.')).toBeTruthy();
    expect((await readNotificationPrefs(db)).dailyReminderTime).toBeNull();
    fireEvent.change(daily, { target: { value: '19:30' } });
    await waitFor(async () => {
      expect((await readNotificationPrefs(db)).dailyReminderTime).toBe('19:30');
    });
    expect(
      screen.getByText('Solo si tienes al menos 10 tarjetas pendientes. Déjalo vacío si no lo quieres.'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: /Plan del día/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Antes de un examen/ }));
    await waitFor(async () => {
      expect(await readNotificationPrefs(db)).toMatchObject({
        studyPlan: { enabled: false },
        examSoonDaysBefore: [],
        breakEnd: { enabled: true },
      });
    });

    // Las horas silenciosas no pueden tapar el recordatorio ya elegido.
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '19:00' } });
    expect(await screen.findByText('Esa hora cae en tus horas silenciosas; elige otra.')).toBeTruthy();
    expect((await readNotificationPrefs(db)).quietHours.start).toBe('22:00');

    fireEvent.click(screen.getByRole('button', { name: 'Desactivar avisos' }));
    expect(await screen.findByRole('button', { name: 'Activar avisos' })).toBeTruthy();
    expect(mocks.disable).toHaveBeenCalledOnce();
    await waitFor(async () => {
      expect((await readNotificationPrefs(db)).enabled).toBe(false);
    });
  });

  it('NT8: si no da el permiso, explica dónde cambiarlo; nada queda activado', async () => {
    mocks.enable.mockResolvedValue('denied');
    render(<NotificationsSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activar avisos' }));
    expect(await screen.findByText(/Los avisos están bloqueados para Estudio/)).toBeTruthy();
    expect((await readNotificationPrefs(db)).enabled).toBe(false);
  });

  it('NT8: en Safari de iPhone explica cómo instalar la app, sin botón de permiso', async () => {
    mocks.environment = { ...DESKTOP, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' };
    render(<NotificationsSection />);
    expect(await screen.findByText(/Agregar a inicio/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Activar avisos' })).toBeNull();
  });

  it('sin conexión no se puede activar (requiere conexión)', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<NotificationsSection />);
    expect((await screen.findByRole<HTMLButtonElement>('button', { name: 'Activar avisos' })).disabled).toBe(
      true,
    );
    expect(screen.getByText('Requiere conexión.')).toBeTruthy();
  });
});
