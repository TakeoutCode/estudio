import { create } from 'zustand';

/**
 * FRONTEND FE2: lo que pasa una vez por cada vez que abre la app (NT7): reportar la apertura
 * desde un aviso, refrescar la suscripción y, si toca, la pregunta del modo reducido.
 */
interface AtOpenState {
  readonly started: boolean;
  readonly question: 'unknown' | 'ask' | 'none';
  start(): void;
  setQuestion(question: 'ask' | 'none'): void;
  reset(): void;
}

export const useAtOpen = create<AtOpenState>()((set) => ({
  started: false,
  question: 'unknown',
  start: () => {
    set({ started: true });
  },
  setQuestion: (question) => {
    set({ question });
  },
  reset: () => {
    set({ started: false, question: 'unknown' });
  },
}));
