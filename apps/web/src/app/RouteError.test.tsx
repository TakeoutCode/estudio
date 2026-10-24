import { render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteError } from './RouteError';
import { routes } from './router';

vi.mock('@/sync', () => ({ reportRouteError: vi.fn() }));
// El router trae el layout, que usa el registro del service worker (no existe en jsdom).
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, () => undefined], updateServiceWorker: vi.fn() }),
}));

function Boom(): never {
  throw new Error('fallo de prueba');
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RouteError (FRONTEND FE13, UI-UX UX3)', () => {
  it('FE13: el error de una pantalla queda dentro del layout; las pestañas siguen', async () => {
    const router = createMemoryRouter([
      {
        path: '/',
        element: (
          <>
            <nav aria-label="Secciones">Pestañas</nav>
            <main>
              <Outlet />
            </main>
          </>
        ),
        errorElement: <RouteError standalone />,
        children: [{ errorElement: <RouteError />, children: [{ index: true, element: <Boom /> }] }],
      },
    ]);
    render(<RouterProvider router={router} />);
    expect(await screen.findByText(/Algo no salió bien/)).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Secciones' })).toBeTruthy();
    expect(screen.getAllByRole('main')).toHaveLength(1); // sin un <main> dentro de otro
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  });

  it('FE13: todas las pantallas tienen su boundary bajo el layout, y la raíz el suyo', () => {
    const [root] = routes;
    expect(root?.errorElement).toBeTruthy();
    for (const child of root?.children ?? []) expect(child.errorElement).toBeTruthy();
  });
});
