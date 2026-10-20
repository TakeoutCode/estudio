import type { Confidence } from '@estudio/shared';
import type { SessionPlan } from '@estudio/srs';
import { create } from 'zustand';

// FRONTEND FE2: estado efímero de la sesión. La cola es una foto del plan al empezar (§3:
// "al iniciar se arma la cola"); los datos de cada tarjeta se leen de Dexie.

/** LD §4: `prompt` (intento) → `revealed` (respuesta y explicación) → calificación. */
export type CardPhase = 'prompt' | 'revealed';

export interface StudySession {
  readonly id: string;
  readonly startedAt: number;
  readonly plan: SessionPlan;
  /** R6, LD6: pedir confianza antes de revelar (`review.askConfidence`). */
  readonly askConfidence: boolean;
}

interface StudyState {
  readonly session: StudySession | null;
  /** Tarjeta en pantalla; `null` tras calificar, para presentar la siguiente aunque sea la misma. */
  readonly currentCardId: string | null;
  readonly phase: CardPhase;
  readonly shownAt: number;
  readonly confidence: Confidence | null;
  readonly answered: number;
  readonly start: (session: StudySession) => void;
  readonly present: (cardId: string, now: number) => void;
  /** R1: revelar solo desde el intento. */
  readonly reveal: (confidence: Confidence | null) => void;
  readonly markAnswered: () => void;
  readonly end: () => void;
}

const idle = {
  session: null,
  currentCardId: null,
  phase: 'prompt',
  shownAt: 0,
  confidence: null,
  answered: 0,
} as const;

export const useStudy = create<StudyState>()((set) => ({
  ...idle,
  start: (session) => {
    set({ ...idle, session });
  },
  present: (cardId, now) => {
    set({ currentCardId: cardId, phase: 'prompt', shownAt: now, confidence: null });
  },
  reveal: (confidence) => {
    set((s) => (s.currentCardId && s.phase === 'prompt' ? { phase: 'revealed', confidence } : s));
  },
  markAnswered: () => {
    set((s) => ({ currentCardId: null, phase: 'prompt', confidence: null, answered: s.answered + 1 }));
  },
  end: () => {
    set(idle);
  },
}));
