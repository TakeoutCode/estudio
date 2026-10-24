import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStatus } from '@/lib/app-status';
import { useSessionLock } from '@/lib/session-lock';
import { UpdatePrompt } from './UpdatePrompt';

const sw = vi.hoisted(() => ({
  needRefresh: false,
  update: vi.fn<(reload?: boolean) => Promise<void>>(),
  registration: { update: vi.fn<() => Promise<void>>() },
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options?: {
    onRegisteredSW?: (url: string, registration: ServiceWorkerRegistration) => void;
  }) => {
    options?.onRegisteredSW?.('/sw.js', sw.registration as unknown as ServiceWorkerRegistration);
    return {
      needRefresh: [sw.needRefresh, () => undefined],
      offlineReady: [false, () => undefined],
      updateServiceWorker: sw.update,
    };
  },
}));

beforeEach(() => {
  sw.needRefresh = true;
  sw.update.mockReset().mockResolvedValue(undefined);
  sw.registration.update.mockReset().mockResolvedValue(undefined);
  useSessionLock.setState({ holders: 0 });
  useAppStatus.setState({ contractOutdated: false });
});

describe('UpdatePrompt (FRONTEND FE6)', () => {
  it('FE6: sin sesión en curso, ofrece actualizar y lo hace solo cuando ella acepta', () => {
    render(<UpdatePrompt />);
    expect(sw.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(sw.update).toHaveBeenCalledWith(true);
  });

  it('FE6: con una sesión en curso no se actualiza; al soltarse, se aplica sola', () => {
    let release: () => void = () => undefined;
    act(() => {
      release = useSessionLock.getState().hold();
    });
    render(<UpdatePrompt />);
    expect(screen.queryByRole('button', { name: 'Actualizar' })).toBeNull();
    expect(screen.getByText('Se actualizará al terminar la sesión')).toBeTruthy();
    expect(sw.update).not.toHaveBeenCalled();

    act(() => {
      release();
      release(); // soltarlo dos veces no deja el contador negativo
    });
    expect(useSessionLock.getState().holders).toBe(0);
    expect(sw.update).toHaveBeenCalledTimes(1);
    expect(sw.update).toHaveBeenCalledWith(true);
  });

  it('ARC6: con un 426 pide al navegador que busque la versión nueva', () => {
    sw.needRefresh = false;
    useAppStatus.setState({ contractOutdated: true });
    render(<UpdatePrompt />);
    expect(screen.getByText(/Actualiza la app para seguir sincronizando/)).toBeTruthy();
    expect(sw.registration.update).toHaveBeenCalledTimes(1);
  });
});
