import type { NotificationState } from '@estudio/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { readNotificationPrefs } from '@/db/settings';
import { updateNotificationPrefs } from '@/features/settings';
import { NotificationsAtOpen } from './NotificationsAtOpen';
import { useAtOpen } from './store';

const mocks = vi.hoisted(() => ({
  reportOpened: vi.fn<(ids: readonly string[]) => Promise<void>>(),
  refresh: vi.fn<() => Promise<void>>(),
  state: vi.fn<() => Promise<NotificationState>>(),
  answer: vi.fn<(choice: string) => Promise<void>>(),
  disable: vi.fn<() => Promise<void>>(),
}));
vi.mock('./commands', () => ({
  reportOpened: mocks.reportOpened,
  refreshDeviceSubscription: mocks.refresh,
  fetchNotificationState: mocks.state,
  answerBackoff: mocks.answer,
  disableOnThisDevice: mocks.disable,
}));

const EVENT_ID = '0192f1a0-0000-7000-8000-0000000000f1';

function Search() {
  return <output data-testid="search">{useLocation().search}</output>;
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationsAtOpen />
      <Search />
    </MemoryRouter>,
  );

beforeEach(async () => {
  useAtOpen.getState().reset();
  mocks.reportOpened.mockResolvedValue();
  mocks.refresh.mockResolvedValue();
  mocks.state.mockResolvedValue({ backoff: true, askBackoffQuestion: true });
  mocks.answer.mockResolvedValue();
  mocks.disable.mockResolvedValue();
  await db.delete({ disableAutoOpen: false });
  await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
  await updateNotificationPrefs((p) => ({ ...p, enabled: true }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('NT7: al abrir la app', () => {
  it('desde un recordatorio reporta la apertura, limpia la URL y no pregunta', async () => {
    renderAt(`/?aviso=${EVENT_ID}`);
    await waitFor(() => {
      expect(mocks.reportOpened).toHaveBeenCalledWith([EVENT_ID]);
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(screen.getByTestId('search').textContent).toBe('');
    expect(mocks.state).not.toHaveBeenCalled();
  });

  it('en modo reducido pregunta una vez; "Cada 3 días" lo guarda y la pregunta se va', async () => {
    const { unmount } = renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Cada 3 días' }));
    await waitFor(() => {
      expect(screen.queryByText('¿Quieres seguir recibiendo recordatorios?')).toBeNull();
    });
    expect(mocks.answer).toHaveBeenCalledWith('reduced');
    expect(mocks.reportOpened).toHaveBeenCalledWith([]); // reintenta aperturas pendientes

    unmount();
    renderAt('/'); // volver a Hoy en la misma apertura no vuelve a preguntar
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.state).toHaveBeenCalledOnce();
    expect(screen.queryByText('¿Quieres seguir recibiendo recordatorios?')).toBeNull();
  });

  it('"Desactivar" apaga los avisos en sus ajustes y en este dispositivo', async () => {
    renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar' }));
    await waitFor(async () => {
      expect((await readNotificationPrefs(db)).enabled).toBe(false);
    });
    expect(mocks.answer).toHaveBeenCalledWith('off');
    expect(mocks.disable).toHaveBeenCalledOnce();
  });

  it('con los avisos apagados no consulta ni pregunta nada', async () => {
    await updateNotificationPrefs((p) => ({ ...p, enabled: false }));
    renderAt('/');
    await waitFor(() => {
      expect(mocks.reportOpened).toHaveBeenCalledWith([]);
    });
    expect(mocks.state).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
