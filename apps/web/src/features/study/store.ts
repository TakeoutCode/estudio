import type { Confidence, Rating } from '@estudio/shared';
import {
  type CardClock,
  type CardPause,
  type RatingConfig,
  pauseCardClock,
  resumeCardClock,
  type SessionPlan,
  startCardClock,
  type StopReason,
} from '@estudio/srs';
import { create } from 'zustand';
import { useSessionLock } from '@/lib/session-lock';

// FRONTEND FE2: estado efímero de la sesión. La cola es una foto del plan al empezar (§3:
// "al iniciar se arma la cola"); los datos de cada tarjeta se leen de Dexie.

/** LD §4: `prompt` (intento) → `revealed` (respuesta y explicación) → calificación. */
export type CardPhase = 'prompt' | 'revealed';

/**
 * LD2: el intento que se registra antes de revelar cuando no basta con "Mostrar": escribir u
 * opción múltiple (se califican solas), V/F con justificación y la respuesta abierta.
 */
export type Attempt =
  | { readonly kind: 'typed'; readonly text: string; readonly correct: boolean }
  | { readonly kind: 'choice'; readonly option: number; readonly correct: boolean }
  | {
      readonly kind: 'verdict';
      readonly verdict: boolean;
      readonly justification: string;
      readonly correct: boolean;
    }
  | { readonly kind: 'written'; readonly text: string }
  /** LD §2: ordenar, relacionar o etiquetar; `rating` sale de `toRating` con el puntaje (LD2). */
  | {
      readonly kind: 'scored';
      readonly score: number;
      readonly rating: Rating;
      readonly answer: Readonly<Record<string, unknown>>;
    };

/** Lo que ella va armando en un ejercicio antes de comprobar (efímero, FE2). */
export type ExerciseWork =
  | { readonly kind: 'sequence'; readonly order: readonly string[] }
  /** Por cada elemento de la columna A, en su orden, la pareja que eligió de la B. */
  | { readonly kind: 'matching'; readonly picks: readonly (string | null)[] }
  /** Lo que escribió para cada etiqueta, en el orden de sus números. */
  | { readonly kind: 'label_image'; readonly answers: readonly string[] };

/**
 * Qué se estudia: Hoy mezcla todos los mazos (R9, P4); `deck` aplica el plan a un solo mazo
 * (`?mazo=`) y `tag` a las tarjetas de una etiqueta (`?etiqueta=`); `exam` es la vuelta de
 * repaso previa a un examen (LD12, `?examen=`).
 */
export type StudyScope =
  | { readonly kind: 'today' }
  | { readonly kind: 'deck'; readonly deckId: string }
  | { readonly kind: 'tag'; readonly tagId: string }
  | { readonly kind: 'exam'; readonly examId: string };

/** Dos alcances con la misma clave son la misma sesión. */
export const scopeKey = (scope: StudyScope): string =>
  scope.kind === 'deck'
    ? `deck:${scope.deckId}`
    : scope.kind === 'tag'
      ? `tag:${scope.tagId}`
      : scope.kind === 'exam'
        ? `exam:${scope.examId}`
        : 'today';

export interface StudySession {
  readonly id: string;
  readonly startedAt: number;
  readonly plan: SessionPlan;
  /** R6, LD6: pedir confianza antes de revelar (`review.askConfidence`). */
  readonly askConfidence: boolean;
  /** §1, LD14: tras olvidar una tarjeta aprendida, pedirle explicarla (`review.explainLapses`). */
  readonly explainLapses: boolean;
  /** LD2: lo que `toRating()` necesita de la configuración, fijo al empezar como la cola. */
  readonly ratingConfig: RatingConfig;
  readonly scope: StudyScope;
  /** Nombre del mazo o la etiqueta del alcance, para el título. */
  readonly scopeName: string | null;
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
  /**
   * R3: duración de la tarjeta en pantalla, sin descansos, app oculta ni tiempo fuera de la
   * sesión. Sus pausas siguen abiertas entre tarjetas: son de la pantalla.
   */
  readonly clock: CardClock;
  readonly confidence: Confidence | null;
  /** null en las tarjetas que ella califica (basic, cloze). */
  readonly attempt: Attempt | null;
  /** Ordenar, relacionar o etiquetar: lo armado hasta comprobar; se descarta al pasar de tarjeta. */
  readonly work: ExerciseWork | null;
  readonly answered: number;
  readonly fatigue: FatigueState;
  /** P6: motivos para parar que ella ya vio en esta sesión; no se repiten. */
  readonly dismissedStops: readonly StopReason[];
  /** LD5: temas cuya autoexplicación ella dejó para después en esta sesión. */
  readonly postponedTopics: readonly string[];
  /** R13: pidió descanso con una tarjeta en pantalla; empieza al terminarla. */
  readonly breakRequested: boolean;
  readonly start: (session: StudySession) => void;
  readonly present: (cardId: string, now: number) => void;
  /** R1: revelar solo desde el intento. */
  readonly reveal: (confidence: Confidence | null, attempt?: Attempt) => void;
  /** R6: confianza antes de escribir o elegir, sin revelar todavía. */
  readonly chooseConfidence: (confidence: Confidence) => void;
  /** Solo antes del intento (R1): después de comprobar ya no cambia. */
  readonly setWork: (work: ExerciseWork) => void;
  readonly markAnswered: () => void;
  /** Detiene el reloj de la tarjeta desde `at` (descanso, app oculta o fuera de la sesión). */
  readonly hold: (reason: CardPause, at: number) => void;
  /** Cierra esa pausa: la duración de la tarjeta sigue desde donde quedó. */
  readonly release: (reason: CardPause, at: number) => void;
  /** P5: aviso de fatiga con `answers` respuestas en la sesión. */
  readonly warnFatigue: (answers: number) => void;
  readonly dismissFatigue: () => void;
  /** Tomó un descanso: los avisos ya no van seguidos y se juzga con respuestas nuevas. */
  readonly rested: (answers: number) => void;
  readonly dismissStop: (reason: StopReason) => void;
  readonly postponeTopic: (topicId: string) => void;
  readonly requestBreak: (requested: boolean) => void;
  readonly end: () => void;
}

const idle = {
  session: null,
  currentCardId: null,
  phase: 'prompt',
  clock: startCardClock(0),
  confidence: null,
  attempt: null,
  work: null,
  answered: 0,
  fatigue: { inRow: 0, since: null, showing: false },
  dismissedStops: [],
  postponedTopics: [],
  breakRequested: false,
} as const;

export const useStudy = create<StudyState>()((set) => ({
  ...idle,
  start: (session) => {
    set({ ...idle, session });
  },
  present: (cardId, now) => {
    set((s) => ({
      currentCardId: cardId,
      phase: 'prompt',
      clock: startCardClock(now, s.clock),
      confidence: null,
      attempt: null,
      work: null,
    }));
  },
  reveal: (confidence, attempt) => {
    set((s) =>
      s.currentCardId && s.phase === 'prompt'
        ? { phase: 'revealed', confidence: confidence ?? s.confidence, attempt: attempt ?? null }
        : s,
    );
  },
  setWork: (work) => {
    set((s) => (s.currentCardId && s.phase === 'prompt' ? { work } : s));
  },
  chooseConfidence: (confidence) => {
    set((s) => (s.currentCardId && s.phase === 'prompt' ? { confidence } : s));
  },
  markAnswered: () => {
    set((s) => ({
      currentCardId: null,
      phase: 'prompt',
      confidence: null,
      attempt: null,
      work: null,
      answered: s.answered + 1,
    }));
  },
  hold: (reason, at) => {
    set((s) => {
      const clock = pauseCardClock(s.clock, reason, at);
      return clock === s.clock ? s : { clock };
    });
  },
  release: (reason, at) => {
    set((s) => {
      const clock = resumeCardClock(s.clock, reason, at);
      return clock === s.clock ? s : { clock };
    });
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
  requestBreak: (requested) => {
    set({ breakRequested: requested });
  },
  end: () => {
    set(idle);
  },
}));

// FE6: la sesión retiene la actualización de la PWA desde que empieza hasta que ella la termina,
// también tras "Salir": la cola y la tarjeta a medias viven solo aquí.
let releaseLock: (() => void) | null = null;
useStudy.subscribe((state) => {
  if (state.session && !releaseLock) releaseLock = useSessionLock.getState().hold();
  else if (!state.session && releaseLock) {
    releaseLock();
    releaseLock = null;
  }
});
