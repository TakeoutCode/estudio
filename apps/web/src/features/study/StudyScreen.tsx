import { type Confidence, newId, Rating } from '@estudio/shared';
import { type CardState, nextCard, type SessionPlan } from '@estudio/srs';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Banner } from '@/ui/Banner';
import { EmptyState } from '@/ui/EmptyState';
import { RatingButton } from '@/ui/RatingButton';
import { answerCard } from './commands';
import { planSessionNow, type StudyCardView, useQueueStates, useStudyCard } from './queries';
import { useStudy } from './store';
import { useStudyShortcuts } from './use-study-shortcuts';

const RATINGS = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const;
const CONFIDENCES = [1, 2, 3] as const;
const MINUTE_MS = 60_000;

const primary =
  'min-h-11 rounded-(--radius-card) bg-primary px-4 text-primary-contrast focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60';
const secondary =
  'min-h-11 rounded-(--radius-card) px-4 text-primary focus-visible:outline-2 focus-visible:outline-primary';

/** Sesión de repaso: intento → respuesta y explicación → calificación (LD §4; R1, R3, R4). */
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
        <h1 className="m-0 text-title font-semibold">{t('study.title')}</h1>
        <EmptyState
          message={t('today.empty')}
          action={
            <Link className={primary + ' inline-flex items-center'} to="/notes/new">
              {t('today.addCard')}
            </Link>
          }
        />
      </>
    );
  }
  return <Session plan={session.plan} sessionId={session.id} startedAt={session.startedAt} />;
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
  const { t } = useTranslation();
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

  useEffect(() => {
    if (nextId && currentCardId === null) present(nextId, Date.now());
  }, [nextId, currentCardId, present]);

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

  if (!step) return null;
  return (
    <>
      <h1 className="m-0 text-title font-semibold">{t('study.title')}</h1>
      <PlanNotices plan={plan} />
      {step.kind === 'done' ? <SessionDone /> : null}
      {step.kind === 'wait' ? <Waiting until={step.until} now={clock} /> : null}
      {step.kind === 'card' && currentCardId ? (
        <CurrentCard
          cardId={currentCardId}
          sessionId={sessionId}
          onAnswered={(state) => {
            setAnswered((prev) => new Map(prev).set(state.cardId, state));
            setClock(Date.now());
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
  onAnswered,
}: {
  readonly cardId: string;
  readonly sessionId: string;
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
    <article className="flex flex-col gap-4 rounded-(--radius-card) bg-surface p-5">
      <p className="m-0 text-card whitespace-pre-wrap">{content.prompt}</p>
      {phase === 'prompt' ? <Attempt askConfidence={askConfidence} onReveal={reveal} /> : null}
      <div aria-live="polite">{phase === 'revealed' ? <Answer content={content} /> : null}</div>
      {phase === 'revealed' ? (
        <div role="group" aria-label={t('study.rate.label')} className="grid grid-cols-4 gap-2">
          {RATINGS.map((rating) => (
            <RatingButton key={rating} rating={rating} onRate={rate} disabled={busy} />
          ))}
        </div>
      ) : null}
      {saveFailed ? (
        <p role="alert" className="m-0 text-caption">
          {t('study.saveFailed')}
        </p>
      ) : null}
      <button
        type="button"
        className="self-start text-caption text-muted"
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
    </article>
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
    <div role="group" aria-label={t('study.confidence.question')} className="grid grid-cols-3 gap-2">
      {CONFIDENCES.map((level) => (
        <button
          key={level}
          type="button"
          className="min-h-11 rounded-(--radius-card) bg-primary/20 px-2 text-text"
          onClick={() => {
            onReveal(level);
          }}
        >
          {t(`study.confidence.level${level}`)}
        </button>
      ))}
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
    <section className="flex flex-col gap-4 rounded-(--radius-card) bg-surface p-5">
      <p className="m-0">{t('study.waiting', { minutes })}</p>
      <button
        type="button"
        className={secondary + ' self-start'}
        onClick={() => {
          end();
          void navigate('/');
        }}
      >
        {t('study.finish')}
      </button>
    </section>
  );
}

/** §3: resumen final opcional y neutral. */
function SessionDone() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const answered = useStudy((s) => s.answered);
  const end = useStudy((s) => s.end);
  return (
    <section className="flex flex-col gap-4 rounded-(--radius-card) bg-surface p-5">
      <h2 className="m-0 text-title font-semibold">{t('study.done.title')}</h2>
      <p className="m-0">{t('study.done.summary', { count: answered })}</p>
      <button
        type="button"
        className={primary + ' self-start'}
        onClick={() => {
          end();
          void navigate('/');
        }}
      >
        {t('study.done.back')}
      </button>
    </section>
  );
}
