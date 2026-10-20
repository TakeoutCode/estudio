import { type Confidence, newId, Rating } from '@estudio/shared';
import { type CardState, nextCard, type SessionPlan, type TimerBlockRecord } from '@estudio/srs';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import {
  AwayPrompt,
  BreakPanel,
  dispatchTimer,
  type TimerResult,
  TimerStrip,
  useTimerTicker,
  useTimerView,
} from '@/features/timer';
import { ActionBar } from '@/ui/ActionBar';
import { Banner } from '@/ui/Banner';
import { EmptyState } from '@/ui/EmptyState';
import { RatingButton } from '@/ui/RatingButton';
import { answerCard } from './commands';
import { planSessionNow, type StudyCardView, useQueueStates, useStudyCard } from './queries';
import { useStudy } from './store';
import { SuggestionPanel } from './SuggestionPanel';
import { useSessionSuggestion } from './use-session-suggestion';
import { useStudyShortcuts } from './use-study-shortcuts';

const RATINGS = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const;
const CONFIDENCES = [1, 2, 3] as const;
const MINUTE_MS = 60_000;

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const primary = `inline-flex min-h-14 w-full items-center justify-center rounded-(--radius-card) bg-primary px-4 font-medium text-primary-contrast disabled:opacity-60 ${focus}`;
const secondary = `inline-flex min-h-11 w-full items-center justify-center rounded-(--radius-card) border border-muted/40 px-4 text-primary ${focus}`;

/**
 * Sesión de repaso: intento → respuesta y explicación → calificación (LD §4; R1, R3, R4).
 * Mobile first (UX2): la tarjeta arriba y las acciones en la zona del pulgar.
 */
export function StudyScreen() {
  const { t } = useTranslation();
  const session = useStudy((s) => s.session);
  const start = useStudy((s) => s.start);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (session) return;
    let cancelled = false;
    planSessionNow()
      .then(({ plan, config }) => {
        if (!cancelled) {
          start({ id: newId(), startedAt: Date.now(), plan, askConfidence: config.review.askConfidence });
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [session, start]);

  if (loadFailed) return <EmptyState message={t('error.generic')} />;
  if (!session) return null;
  if (session.plan.queue.length === 0) {
    return (
      <>
        <StudyHeader />
        <EmptyState message={t('today.empty')} />
        <ActionBar>
          <Link className={primary} to="/notes/new">
            {t('today.addCard')}
          </Link>
        </ActionBar>
      </>
    );
  }
  return <Session plan={session.plan} sessionId={session.id} startedAt={session.startedAt} />;
}

/** "Salir" no corta nada: lo respondido ya está guardado (R3) y la sesión sigue al volver. */
function StudyHeader({ done, total }: { readonly done?: number; readonly total?: number }) {
  const { t } = useTranslation();
  return (
    <header className="flex min-h-11 items-center justify-between gap-3">
      <Link className={`-ml-2 inline-flex min-h-11 min-w-11 items-center px-2 text-primary ${focus}`} to="/">
        {t('study.exit')}
      </Link>
      <h1 className="m-0 text-body font-semibold">{t('study.title')}</h1>
      <span className="min-w-11 text-right text-caption text-muted">
        {done !== undefined && total !== undefined ? t('study.progress', { done, total }) : null}
      </span>
    </header>
  );
}

function Session({
  plan,
  sessionId,
  startedAt,
}: {
  readonly plan: SessionPlan;
  readonly sessionId: string;
  readonly startedAt: number;
}) {
  const ids = useMemo(() => plan.queue.map((q) => q.cardId), [plan]);
  const live = useQueueStates(ids);
  // La consulta en vivo llega un render tarde: sin esto, la tarjeta recién calificada
  // volvería a elegirse. El estado que devuelve `answerCard` ya está guardado.
  const [answered, setAnswered] = useState<ReadonlyMap<string, CardState>>(() => new Map());
  const states = useMemo(() => live && newest(live, answered), [live, answered]);
  const [clock, setClock] = useState(startedAt);
  const currentCardId = useStudy((s) => s.currentCardId);
  const present = useStudy((s) => s.present);

  const step = states ? nextCard(plan.queue, states, startedAt, clock) : null;
  const nextId = step?.kind === 'card' ? step.item.cardId : null;
  const done = states
    ? plan.queue.filter((q) => (states.get(q.cardId)?.lastReview ?? -1) >= startedAt).length
    : 0;

  // Temporizador (§3): opcional; si corre en este dispositivo, el descanso reemplaza la tarjeta.
  const timer = useTimerView();
  const onBreak =
    timer?.isOwner === true &&
    (timer.session?.state === 'break_short' || timer.session?.state === 'break_long');

  // R3: la duración de una tarjeta no incluye el descanso. Durante el descanso no se presenta
  // la siguiente, y la que ya estaba en pantalla descuenta el tiempo de descanso.
  const hold = useStudy((s) => s.hold);
  const release = useStudy((s) => s.release);
  useEffect(() => {
    if (onBreak) hold(Date.now());
    else release(Date.now());
  }, [onBreak, hold, release]);
  useEffect(() => {
    if (nextId && currentCardId === null && !onBreak) present(nextId, Date.now());
  }, [nextId, currentCardId, onBreak, present]);

  // Una tarjeta en aprendizaje vuelve en unos minutos: se repinta cuando vence (§3).
  const waitUntil = step?.kind === 'wait' ? step.until : null;
  useEffect(() => {
    if (waitUntil === null) return;
    const handle = window.setTimeout(
      () => {
        setClock(Date.now());
      },
      Math.max(0, waitUntil - Date.now()),
    );
    return () => {
      window.clearTimeout(handle);
    };
  }, [waitUntil]);

  const [away, setAway] = useState<{ sessionId: string; interrupted: TimerBlockRecord } | null>(null);
  const onTimerResult = (result: TimerResult) => {
    if (result.notice === 'interrupted_while_away' && result.closed) {
      setAway({ sessionId: result.sessionId, interrupted: result.closed });
    }
  };
  const now = useTimerTicker(timer, step?.kind === 'card' && currentCardId !== null, onTimerResult);
  const serverNow = now + (timer?.offsetMs ?? 0);

  // P5 y P6: sugerencias suaves entre tarjetas; nunca bloquean.
  const navigate = useNavigate();
  const end = useStudy((s) => s.end);
  const { suggestion, bedtime, planner, dismiss } = useSessionSuggestion({
    sessionId,
    startedAt,
    onBreak,
    queueDone: step?.kind === 'done',
    now: Math.max(clock, now),
  });
  const inBlock =
    timer?.isOwner === true && (timer.session?.state === 'focus' || timer.session?.state === 'paused');
  const aside =
    suggestion && planner ? (
      <SuggestionPanel
        suggestion={suggestion}
        planner={planner}
        canBreak={inBlock}
        onTakeBreak={() => {
          dismiss();
          void dispatchTimer({ type: 'takeBreak' });
        }}
        onFinish={() => {
          end();
          void navigate('/');
        }}
        onDismiss={dismiss}
      />
    ) : null;

  if (!step) return null;
  return (
    <>
      <StudyHeader done={done} total={plan.queue.length} />
      {timer ? <TimerStrip view={timer} now={now} onResult={onTimerResult} /> : null}
      {away ? (
        <AwayPrompt
          sessionId={away.sessionId}
          interrupted={away.interrupted}
          now={serverNow}
          onDone={() => {
            setAway(null);
          }}
        />
      ) : null}
      <PlanNotices plan={plan} />
      {onBreak ? <BreakPanel session={timer.session} at={serverNow} /> : null}
      {!onBreak && step.kind === 'done' ? <SessionDone bedtime={bedtime} /> : null}
      {!onBreak && step.kind === 'wait' ? <Waiting until={step.until} now={clock} /> : null}
      {!onBreak && step.kind === 'card' && currentCardId ? (
        <CurrentCard
          cardId={currentCardId}
          sessionId={sessionId}
          aside={aside}
          onAnswered={(state) => {
            // Responder es seguir: el aviso en pantalla no se repite.
            if (suggestion) dismiss();
            setAnswered((prev) => new Map(prev).set(state.cardId, state));
            setClock(Date.now());
            // R13: en estructurado, el bloque que ya llegó a 0 cierra al terminar la tarjeta.
            void dispatchTimer({ type: 'cardDone' });
          }}
        />
      ) : null}
    </>
  );
}

/** Por tarjeta, el estado con el repaso más reciente: el local recién escrito o lo que ya leyó Dexie. */
function newest(
  live: ReadonlyMap<string, CardState>,
  answered: ReadonlyMap<string, CardState>,
): ReadonlyMap<string, CardState> {
  const merged = new Map(live);
  for (const [id, state] of answered) {
    const current = merged.get(id);
    if (!current || (current.lastReview ?? 0) < (state.lastReview ?? 0)) merged.set(id, state);
  }
  return merged;
}

/** Avisos neutros del plan (UI-UX UX7): nunca "atrasadas" ni culpa (§5, R19). */
function PlanNotices({ plan }: { readonly plan: SessionPlan }) {
  const { t } = useTranslation();
  return (
    <>
      {plan.newBlockedBy === 'overdue' ? <Banner>{t('study.notice.overdue')}</Banner> : null}
      {plan.newBlockedBy === 'low_retention' ? <Banner>{t('study.notice.lowRetention')}</Banner> : null}
      {plan.backlogSpreadDays ? (
        <Banner>{t('study.notice.spread', { days: plan.backlogSpreadDays })}</Banner>
      ) : null}
    </>
  );
}

function CurrentCard({
  cardId,
  sessionId,
  aside,
  onAnswered,
}: {
  readonly cardId: string;
  readonly sessionId: string;
  /** Sugerencia de P5 o P6, sobre las acciones. */
  readonly aside: ReactNode;
  readonly onAnswered: (state: CardState) => void;
}) {
  const { t } = useTranslation();
  const content = useStudyCard(cardId);
  const phase = useStudy((s) => s.phase);
  const askConfidence = useStudy((s) => s.session?.askConfidence ?? false);
  const reveal = useStudy((s) => s.reveal);
  const markAnswered = useStudy((s) => s.markAnswered);
  const [busy, setBusy] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [help, setHelp] = useState(false);

  const rate = (rating: Rating) => {
    if (busy) return;
    const { shownAt, confidence } = useStudy.getState();
    setBusy(true);
    setSaveFailed(false);
    const now = Date.now();
    answerCard({ cardId, rating, durationMs: now - shownAt, sessionId, confidence }, { now })
      .then(({ state }) => {
        onAnswered(state);
        markAnswered();
      })
      .catch(() => {
        setSaveFailed(true); // la tarjeta sigue en pantalla; nada se perdió
      })
      .finally(() => {
        setBusy(false);
      });
  };

  useStudyShortcuts({
    onReveal:
      phase === 'prompt' && !askConfidence
        ? () => {
            reveal(null);
          }
        : null,
    onConfidence:
      phase === 'prompt' && askConfidence
        ? (c) => {
            reveal(c);
          }
        : null,
    onRate: phase === 'revealed' ? rate : null,
    onHelp: () => {
      setHelp((open) => !open);
    },
  });

  if (content === undefined) return null;
  if (content === null) {
    // Borrada durante la sesión (p. ej. desde otro dispositivo): se pasa a la siguiente.
    return <SkipDeleted onSkip={markAnswered} />;
  }
  return (
    <>
      <article className="flex flex-col gap-4 rounded-(--radius-card) bg-surface p-5">
        <p className="m-0 text-card whitespace-pre-wrap">{content.prompt}</p>
        <div aria-live="polite">{phase === 'revealed' ? <Answer content={content} /> : null}</div>
      </article>
      {/* Los atajos solo sirven con teclado y puntero fino (FE12); en el teléfono no estorban. */}
      <div className="hidden pointer-fine:block">
        <button
          type="button"
          className={`min-h-11 text-caption text-muted ${focus}`}
          aria-expanded={help}
          onClick={() => {
            setHelp(!help);
          }}
        >
          {t('study.shortcuts.toggle')}
        </button>
        {help ? (
          <ul className="m-0 flex flex-col gap-1 pl-5 text-caption text-muted">
            <li>{t('study.shortcuts.reveal')}</li>
            <li>{t('study.shortcuts.rate')}</li>
            <li>{t('study.shortcuts.help')}</li>
          </ul>
        ) : null}
      </div>
      <ActionBar>
        {aside}
        {saveFailed ? (
          <p role="alert" className="m-0 text-caption">
            {t('study.saveFailed')}
          </p>
        ) : null}
        {phase === 'prompt' ? <Attempt askConfidence={askConfidence} onReveal={reveal} /> : null}
        {phase === 'revealed' ? (
          <div role="group" aria-labelledby={`rate-${cardId}`} className="flex flex-col gap-2">
            <p id={`rate-${cardId}`} className="m-0 text-center text-caption text-muted">
              {t('study.rate.label')}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {RATINGS.map((rating) => (
                <RatingButton key={rating} rating={rating} onRate={rate} disabled={busy} />
              ))}
            </div>
          </div>
        ) : null}
      </ActionBar>
    </>
  );
}

/** R1: el intento. Con `askConfidence`, elegir la confianza es lo que revela (R6). */
function Attempt({
  askConfidence,
  onReveal,
}: {
  readonly askConfidence: boolean;
  readonly onReveal: (confidence: Confidence | null) => void;
}) {
  const { t } = useTranslation();
  if (!askConfidence) {
    return (
      <button
        type="button"
        className={primary}
        onClick={() => {
          onReveal(null);
        }}
      >
        {t('study.reveal')}
      </button>
    );
  }
  return (
    <div role="group" aria-labelledby="confidence-question" className="flex flex-col gap-2">
      <p id="confidence-question" className="m-0 text-center text-caption text-muted">
        {t('study.confidence.question')}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {CONFIDENCES.map((level) => (
          <button
            key={level}
            type="button"
            className={`min-h-14 rounded-(--radius-card) bg-primary/20 px-2 font-medium text-text ${focus}`}
            onClick={() => {
              onReveal(level);
            }}
          >
            {t(`study.confidence.level${level}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** R4: respuesta y explicación tras cada intento, también si acertó con poca confianza. */
function Answer({ content }: { readonly content: StudyCardView }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-2 border-t border-muted/30 pt-4">
      <h2 className="m-0 text-caption font-normal text-muted">{t('study.answer')}</h2>
      <p className="m-0 text-card whitespace-pre-wrap">{content.answer}</p>
      {content.explanation ? (
        <p className="m-0 whitespace-pre-wrap text-muted">{content.explanation}</p>
      ) : null}
    </section>
  );
}

function SkipDeleted({ onSkip }: { readonly onSkip: () => void }) {
  useEffect(() => {
    onSkip();
  }, [onSkip]);
  return null;
}

function Waiting({ until, now }: { readonly until: number; readonly now: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const end = useStudy((s) => s.end);
  const minutes = Math.max(1, Math.ceil((until - now) / MINUTE_MS));
  return (
    <>
      <section className="rounded-(--radius-card) bg-surface p-5">
        <p className="m-0">{t('study.waiting', { minutes })}</p>
      </section>
      <ActionBar>
        <button
          type="button"
          className={secondary}
          onClick={() => {
            end();
            void navigate('/');
          }}
        >
          {t('study.finish')}
        </button>
      </ActionBar>
    </>
  );
}

/** §3: resumen final opcional y neutral. P6: si ya es su hora de dormir, lo dice sin presión. */
function SessionDone({ bedtime }: { readonly bedtime: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const answered = useStudy((s) => s.answered);
  const end = useStudy((s) => s.end);
  return (
    <>
      <section className="flex flex-col gap-2 rounded-(--radius-card) bg-surface p-5">
        <h2 className="m-0 text-title font-semibold">{t('study.done.title')}</h2>
        <p className="m-0">{t('study.done.summary', { count: answered })}</p>
        {bedtime ? <p className="m-0 text-muted">{t('study.done.bedtime')}</p> : null}
      </section>
      <ActionBar>
        <button
          type="button"
          className={primary}
          onClick={() => {
            end();
            void navigate('/');
          }}
        >
          {t('study.done.back')}
        </button>
      </ActionBar>
    </>
  );
}
