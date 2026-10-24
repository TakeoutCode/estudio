import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginScreen } from './LoginScreen';

afterEach(() => {
  vi.restoreAllMocks();
});

const renderLogin = () =>
  render(
    <MemoryRouter>
      <LoginScreen />
    </MemoryRouter>,
  );

describe('LoginScreen (FRONTEND FE7)', () => {
  it('FE7: sin red, "Entrar" se deshabilita y dice que requiere conexión, sin un error', () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderLogin();
    expect(screen.getByRole('button', { name: 'Entrar' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(/Requiere conexión/);
    expect(screen.queryByRole('alert')).toBeNull();

    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.getByRole('button', { name: 'Entrar' }).hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(/Requiere conexión/)).toBeNull();
  });
});
