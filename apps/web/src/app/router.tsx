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
          {
            path: 'study',
            lazy: async () => ({ Component: (await import('@/features/study')).StudyScreen }),
          },
          {
            path: 'dashboard',
            lazy: async () => ({ Component: (await import('@/features/dashboard')).DashboardScreen }),
          },
          {
            path: 'settings',
            lazy: async () => ({ Component: (await import('@/features/settings')).SettingsScreen }),
          },
          {
            path: 'topics/:topicId',
            lazy: async () => ({ Component: (await import('@/features/decks')).TopicScreen }),
          },
          {
            path: 'notes/new',
            lazy: async () => ({ Component: (await import('@/features/notes')).NoteEditorScreen }),
          },
          {
            path: 'notes/:noteId',
            lazy: async () => ({ Component: (await import('@/features/notes')).NoteEditorScreen }),
          },
        ],
      },
    ],
  },
]);
