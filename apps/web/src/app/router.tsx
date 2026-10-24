import { createBrowserRouter, type RouteObject } from 'react-router';
import { RequireAccount } from '@/features/auth';
import { RootLayout } from './RootLayout';
import { RouteError } from './RouteError';

// Rutas lazy: la de estudio no carga el editor (FRONTEND FE9). FE13: cada pantalla tiene su
// error boundary dentro del layout (las pestañas y los avisos siguen); el de la raíz queda por si
// falla el layout mismo.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteError standalone />,
    children: [
      {
        path: 'login',
        errorElement: <RouteError />,
        lazy: async () => ({ Component: (await import('@/features/auth')).LoginScreen }),
      },
      {
        element: <RequireAccount />,
        errorElement: <RouteError />,
        children: [
          {
            index: true,
            lazy: async () => ({ Component: (await import('@/features/today')).TodayScreen }),
          },
          {
            path: 'study',
            lazy: async () => {
              // UX6, UX10: la celebración de hitos acompaña a la sesión sin entrar en ella.
              const [{ StudyScreen }, { MilestoneCelebration }] = await Promise.all([
                import('@/features/study'),
                import('@/features/gamification'),
              ]);
              return {
                Component: () => (
                  <>
                    <StudyScreen />
                    <MilestoneCelebration />
                  </>
                ),
              };
            },
          },
          {
            path: 'dashboard',
            lazy: async () => ({ Component: (await import('@/features/dashboard')).DashboardScreen }),
          },
          {
            path: 'settings',
            lazy: async () => {
              // `settings` no depende de las otras features: sus secciones se componen aquí.
              const [
                { SettingsScreen, SyncSection },
                { NotificationsSection },
                { DeleteAccountSection },
                { BackupSection },
                { GamificationSection },
              ] = await Promise.all([
                import('@/features/settings'),
                import('@/features/notifications'),
                import('@/features/auth'),
                import('@/features/backup'),
                import('@/features/gamification'),
              ]);
              return {
                Component: () => (
                  <SettingsScreen
                    end={
                      <>
                        <SyncSection />
                        <BackupSection />
                        <DeleteAccountSection />
                      </>
                    }
                  >
                    <NotificationsSection />
                    <GamificationSection />
                  </SettingsScreen>
                ),
              };
            },
          },
          {
            path: 'exams',
            lazy: async () => ({ Component: (await import('@/features/exams')).ExamsScreen }),
          },
          {
            path: 'exams/new',
            lazy: async () => ({ Component: (await import('@/features/exams')).ExamEditorScreen }),
          },
          {
            path: 'exams/:examId/mock',
            lazy: async () => {
              const [{ MockScreen }, { MilestoneCelebration }] = await Promise.all([
                import('@/features/exams'),
                import('@/features/gamification'),
              ]);
              return {
                Component: () => (
                  <>
                    <MockScreen />
                    <MilestoneCelebration />
                  </>
                ),
              };
            },
          },
          {
            path: 'exams/:examId',
            lazy: async () => ({ Component: (await import('@/features/exams')).ExamEditorScreen }),
          },
          {
            path: 'contrast',
            lazy: async () => ({ Component: (await import('@/features/contrast')).ContrastScreen }),
          },
          {
            path: 'contrast/new',
            lazy: async () => ({ Component: (await import('@/features/contrast')).ContrastEditorScreen }),
          },
          {
            path: 'contrast/:groupId',
            lazy: async () => ({ Component: (await import('@/features/contrast')).ContrastEditorScreen }),
          },
          {
            path: 'rewards',
            lazy: async () => ({ Component: (await import('@/features/gamification')).RewardsScreen }),
          },
          {
            path: 'decks',
            lazy: async () => ({ Component: (await import('@/features/decks')).DecksScreen }),
          },
          {
            path: 'decks/:deckId',
            lazy: async () => ({ Component: (await import('@/features/decks')).DeckScreen }),
          },
          {
            // LEARNING-DESIGN §8: borradores con IA para un mazo, que ella revisa.
            path: 'decks/:deckId/ia',
            lazy: async () => ({ Component: (await import('@/features/ai-drafts')).AiDraftsScreen }),
          },
          {
            path: 'tags',
            lazy: async () => ({ Component: (await import('@/features/decks')).TagsScreen }),
          },
          {
            path: 'topics/:topicId',
            lazy: async () => ({ Component: (await import('@/features/decks')).TopicScreen }),
          },
          {
            // STUDY-METHODS §1: "Explícaselo a alguien".
            path: 'topics/:topicId/explicar',
            lazy: async () => ({ Component: (await import('@/features/decks')).TeachScreen }),
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
];

export const router = createBrowserRouter(routes);
