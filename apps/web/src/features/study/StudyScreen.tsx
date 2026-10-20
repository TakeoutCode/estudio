import { newId, type Rating } from '@estudio/shared';
import {
  type CardState,
  isTypedAnswerCorrect,
  needsTopicIntro,
  nextCard,
  type SessionPlan,
  type TimerBlockRecord,
} from '@estudio/srs';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  AwayPrompt,
  BreakPanel,
  dispatchTimer,
  type TimerResult,
  TimerStrip,
  useTimerTicker,
  useTimerView,
} from '@/features/timer';
import { useBreakEndNotice } from '@/features/notifications';
import { ActionBar } from '@/ui/ActionBar';
import { Banner } from '@/ui/Banner';
import { EmptyState } from '@/ui/EmptyState';
import {
  allowedRatings,
  AttemptControls,
  CardBody,
  defaultObjectiveRating,
  isSelfGraded,
  RatingControls,
} from './CardView';
import { answerCard } from './commands';
import {
  planExamReviewNow,
  planSessionNow,
  useExplainedTopics,
  useQueueStates,
  useStudyCard,
} from './queries';
import { useStudy } from './store';
import { SuggestionPanel } from './SuggestionPanel';
import { TopicIntro } from './TopicIntro';
import { useSessionSuggestion } from './use-session-suggestion';
import { useStudyShortcuts } from './use-study-shortcuts';

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
  // LD12: `?examen=<id>` abre la vuelta de repaso previa a ese examen.
  const [params] = useSearchParams();
  const examReviewId = params.get('examen');

  useEffect(() => {
    if (session?.examReviewId === examReviewId) return;
    let cancelled = false;
    (examReviewId ? planExamReviewNow(examReviewId) : planSessionNow())
      .then(({ plan, config }) => {
        if (!cancelled) {
          start({
            id: newId(),
            startedAt: Date.now(),
            plan,
            askConfidence: config.review.askConfidence,
            examReviewId,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [session, start, examReviewId]);

  if (loadFailed) return <EmptyState message={t('error.generic')} />;
  if (!session) return null;
  if (session.examReviewId !== examReviewId) return null; // se está armando la otra
  if (session.plan.queue.length === 0) {
    return (
      <>
        <StudyHeader />
        <EmptyState message={t(examReviewId ? 'study.examReview.empty' : 'today.empty')} />
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
  const examReview = useStudy((s) => s.session?.examReviewId ?? null) !== null;
  return (
    <header className="flex min-h-11 items-center justify-between gap-3">
      <Link className={`-ml-2 inline-flex min-h-11 min-w-11 items-center px-2 text-primary ${focus}`} to="/">
        {t('study.exit')}
      </Link>
      <h1 className="m-0 text-body font-semibold">
        {t(examReview ? 'study.examReview.title' : 'study.title')}
      </h1>
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
  useBreakEndNotice(timer); // NT4: si sale de la app durante el descanso
  const onBreak =
    timer?.isOwner === true &&
    (timer.session?.state === 'break_short' || timer.session?.state === 'break_long');

  // R3: la duración de una tarjeta no incluye el descanso. Durante el descanso no se presenta
  // la siguiente, y la que ya estaba en pantalla descuenta el tiempo de descanso. Se mide con
  // las marcas del temporizador (hora del servidor → del dispositivo), no con la hora a la que
  // corre el efecto, que puede llegar tarde.
  const hold = useStudy((s) => s.hold);
  const release = useStudy((s) => s.release);
  const offsetMs = timer?.offsetMs ?? 0;
  const breakStartedAt = onBreak ? timer.session.startedAt : null;
  const focusStartedAt = timer?.session?.state === 'focus' ? timer.session.startedAt : null;
  useEffect(() => {
    if (onBreak) hold(breakStartedAt === null ? Date.now() : breakStartedAt - offsetMs);
    else release(focusStartedAt === null ? Date.now() : Math.min(Date.now(), focusStartedAt - offsetMs));
  }, [onBreak, breakStartedAt, focusStartedAt, offsetMs, hold, release]);
  // LD5: antes de la primera tarjeta nueva de un tema, su explicación y la autoexplicación.
  // La tarjeta se presenta después, así su duración no incluye la escritura (R3).
  const explained = useExplainedTopics();
  const postponed = useStudy((s) => s.postponedTopics);
  const postponeTopic = useStudy((s) => s.postponeTopic);
  const introTopic =
    step?.kind === 'card' &&
    explained &&
    currentCardId === null &&
    needsTopicIntro(step.item, new Set([...explained, ...postponed]))
      ? step.item.topicId
      : null;
  const introReady = explained !== undefined && introTopic === null;
  useEffect(() => {
    if (nextId && currentCardId === null && !onBreak && introReady) present(nextId, Date.now());
  }, [nextId, currentCardId, onBreak, introReady, present]);

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
      {!onBreak && introTopic ? (
        <TopicIntro
          key={introTopic}
          topicId={introTopic}
          onDone={() => {
            setClock(Date.now());
          }}
          onPostpone={() => {
            postponeTopic(introTopic);
          }}
        />
      ) : null}
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
  const card = useStudyCard(cardId);
  const phase = useStudy((s) => s.phase);
  const askConfidence = useStudy((s) => s.session?.askConfidence ?? false);
  const confidence = useStudy((s) => s.confidence);
  const attempt = useStudy((s) => s.attempt);
  const reveal = useStudy((s) => s.reveal);
  const chooseConfidence = useStudy((s) => s.chooseConfidence);
  const markAnswered = useStudy((s) => s.markAnswered);
  const [busy, setBusy] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [help, setHelp] = useState(false);

  const rate = (rating: Rating) => {
    if (busy || !card) return;
    const state = useStudy.getState();
    if (!allowedRatings(card, state.attempt).includes(rating)) return; // LD2
    setBusy(true);
    setSaveFailed(false);
    const now = Date.now();
    const answer =
      state.attempt?.kind === 'typed'
        ? { text: state.attempt.text }
        : state.attempt?.kind === 'choice'
          ? { option: state.attempt.option }
          : undefined;
    answerCard(
      { cardId, rating, durationMs: now - state.shownAt, sessionId, confidence: state.confidence, answer },
      { now },
    )
      .then(({ state: next }) => {
        onAnswered(next);
        markAnswered();
      })
      .catch(() => {
        setSaveFailed(true); // la tarjeta sigue en pantalla; nada se perdió
      })
      .finally(() => {
        setBusy(false);
      });
  };
  // LD2: escribir u opción múltiple se califican solas, de forma determinista.
  const typed = (text: string) => {
    if (card?.content.kind !== 'type_answer') return;
    reveal(null, {
      kind: 'typed',
      text: text.trim(),
      correct: isTypedAnswerCorrect(text, card.content.back),
    });
  };
  const choose = (option: number) => {
    if (card?.content.kind !== 'multiple_choice') return;
    reveal(null, { kind: 'choice', option, correct: option === card.content.correct });
  };
  const selfGraded = card ? isSelfGraded(card) : true;

  useStudyShortcuts({
    onReveal:
      phase === 'prompt' && selfGraded && !askConfidence
        ? () => {
            reveal(null);
          }
        : phase === 'revealed' && attempt
          ? () => {
              rate(defaultObjectiveRating(attempt));
            }
          : null,
    onConfidence:
      phase === 'prompt' && askConfidence && (selfGraded || confidence === null)
        ? (c) => {
            if (selfGraded) reveal(c);
            else chooseConfidence(c);
          }
        : null,
    onRate: phase === 'revealed' ? rate : null,
    onHelp: () => {
      setHelp((open) => !open);
    },
  });

  if (card === undefined) return null;
  if (card === null) {
    // Borrada durante la sesión (p. ej. desde otro dispositivo): se pasa a la siguiente.
    return <SkipDeleted onSkip={markAnswered} />;
  }
  return (
    <>
      <CardBody
        card={card}
        phase={phase}
        attempt={attempt}
        canChoose={phase === 'prompt' && (!askConfidence || confidence !== null)}
        onChoose={choose}
      />
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
      <ActionBar keyboardAware={card.content.kind === 'type_answer' && phase === 'prompt'}>
        {aside}
        {saveFailed ? (
          <p role="alert" className="m-0 text-caption">
            {t('study.saveFailed')}
          </p>
        ) : null}
        {phase === 'prompt' ? (
          <AttemptControls
            card={card}
            askConfidence={askConfidence}
            confidence={confidence}
            onReveal={reveal}
            onConfidence={chooseConfidence}
            onTyped={typed}
          />
        ) : null}
        {phase === 'revealed' ? (
          <RatingControls card={card} attempt={attempt} busy={busy} onRate={rate} />
        ) : null}
      </ActionBar>
    </>
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
