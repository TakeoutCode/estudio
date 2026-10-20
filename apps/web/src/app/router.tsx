import { createBrowserRouter } from 'react-router';
import { RequireAccount } from '@/features/auth';
import { RootLayout } from './RootLayout';
import { RouteError } from './RouteError';

// Rutas lazy: la de estudio no carga el editor (FRONTEND FE9).
export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      {
        path: 'login',
        lazy: async () => ({ Component: (await import('@/features/auth')).LoginScreen }),
      },
      {
        element: <RequireAccount />,
        children: [
          {
            index: true,
            lazy: async () => ({ Component: (await import('@/features/today')).TodayScreen }),
          },
        ],
      },
    ],
  },
]);
