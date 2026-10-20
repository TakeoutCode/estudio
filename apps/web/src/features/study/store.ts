import type { Confidence } from '@estudio/shared';
import type { SessionPlan, StopReason } from '@estudio/srs';
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
  /** LD12: la vuelta de repaso previa a este examen; null en la sesión de Hoy. */
  readonly examReviewId: string | null;
}

/** P5 en la sesión. */
export interface FatigueState {
  /** Avisos sin un descanso entre ellos: con `fatigueWarningsToStop` se sugiere parar (P6). */
  readonly inRow: number;
  /** Respuestas de la sesión en el último aviso o descanso (`fatigueWarningDue`). */
  readonly since: number | null;
  /** El aviso está en pantalla. */
  readonly showing: boolean;
}

interface StudyState {
  readonly session: StudySession | null;
  /** Tarjeta en pantalla; `null` tras calificar, para presentar la siguiente aunque sea la misma. */
  readonly currentCardId: string | null;
  readonly phase: CardPhase;
  readonly shownAt: number;
  /** Inicio del descanso con una tarjeta en pantalla; ese tiempo no cuenta en su duración (R3). */
  readonly heldAt: number | null;
  readonly confidence: Confidence | null;
  readonly answered: number;
  readonly fatigue: FatigueState;
  /** P6: motivos para parar que ella ya vio en esta sesión; no se repiten. */
  readonly dismissedStops: readonly StopReason[];
  /** LD5: temas cuya autoexplicación ella dejó para después en esta sesión. */
  readonly postponedTopics: readonly string[];
  readonly start: (session: StudySession) => void;
  readonly present: (cardId: string, now: number) => void;
  /** R1: revelar solo desde el intento. */
  readonly reveal: (confidence: Confidence | null) => void;
  readonly markAnswered: () => void;
  /** Empieza un descanso (§3) con la tarjeta en pantalla. */
  readonly hold: (now: number) => void;
  /** Termina el descanso: la duración de la tarjeta sigue desde donde quedó. */
  readonly release: (now: number) => void;
  /** P5: aviso de fatiga con `answers` respuestas en la sesión. */
  readonly warnFatigue: (answers: number) => void;
  readonly dismissFatigue: () => void;
  /** Tomó un descanso: los avisos ya no van seguidos y se juzga con respuestas nuevas. */
  readonly rested: (answers: number) => void;
  readonly dismissStop: (reason: StopReason) => void;
  readonly postponeTopic: (topicId: string) => void;
  readonly end: () => void;
}

const idle = {
  session: null,
  currentCardId: null,
  phase: 'prompt',
  shownAt: 0,
  heldAt: null,
  confidence: null,
  answered: 0,
  fatigue: { inRow: 0, since: null, showing: false },
  dismissedStops: [],
  postponedTopics: [],
} as const;

export const useStudy = create<StudyState>()((set) => ({
  ...idle,
  start: (session) => {
    set({ ...idle, session });
  },
  present: (cardId, now) => {
    set({ currentCardId: cardId, phase: 'prompt', shownAt: now, heldAt: null, confidence: null });
  },
  reveal: (confidence) => {
    set((s) => (s.currentCardId && s.phase === 'prompt' ? { phase: 'revealed', confidence } : s));
  },
  markAnswered: () => {
    set((s) => ({
      currentCardId: null,
      phase: 'prompt',
      heldAt: null,
      confidence: null,
      answered: s.answered + 1,
    }));
  },
  hold: (now) => {
    set((s) => (s.currentCardId && s.heldAt === null ? { heldAt: now } : s));
  },
  release: (now) => {
    set((s) => (s.heldAt === null ? s : { heldAt: null, shownAt: s.shownAt + Math.max(0, now - s.heldAt) }));
  },
  warnFatigue: (answers) => {
    set((s) => ({ fatigue: { inRow: s.fatigue.inRow + 1, since: answers, showing: true } }));
  },
  dismissFatigue: () => {
    set((s) => (s.fatigue.showing ? { fatigue: { ...s.fatigue, showing: false } } : s));
  },
  rested: (answers) => {
    set({ fatigue: { inRow: 0, since: answers, showing: false } });
  },
  dismissStop: (reason) => {
    set((s) => (s.dismissedStops.includes(reason) ? s : { dismissedStops: [...s.dismissedStops, reason] }));
  },
  postponeTopic: (topicId) => {
    set((s) =>
      s.postponedTopics.includes(topicId) ? s : { postponedTopics: [...s.postponedTopics, topicId] },
    );
  },
  end: () => {
    set(idle);
  },
}));
