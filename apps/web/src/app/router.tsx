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
            path: 'tags',
            lazy: async () => ({ Component: (await import('@/features/decks')).TagsScreen }),
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
