import { type Confidence, MOCK_ANSWER_MAX_LENGTH, type MockItem, type StudySession } from '@estudio/shared';
import {
  type CardClock,
  cardElapsedMs,
  mockResults,
  pauseCardClock,
  resumeCardClock,
  startCardClock,
} from '@estudio/srs';
import { type SubmitEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { OcclusionFigure } from '@/features/media';
import { useHoldSessionLock } from '@/lib/session-lock';
import { usePageVisibility } from '@/lib/use-page-visibility';
import { EmptyState } from '@/ui/EmptyState';
import { Loading } from '@/ui/Loading';
import { answerMockItem, gradeMockItem, NoMockQuestionsError, startMock } from './commands';
import { type MockCardView, type MockView, useMockView } from './queries';

const CONFIDENCES = [1, 2, 3] as const;

/** La pregunta; en una oclusión, con su imagen (R10). Antes de revisar, la etiqueta va tapada (R1). */
function MockPrompt({ card, revealed }: { readonly card: MockCardView; readonly revealed: boolean }) {
  return (
    <>
      <p className="m-0 text-card whitespace-pre-wrap">{card.prompt}</p>
      {card.occlusion ? (
        <OcclusionFigure
          content={card.occlusion.content}
          ordinal={card.occlusion.ordinal}
          revealed={revealed}
          eager
        />
      ) : null}
    </>
  );
}

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `w-full rounded-(--radius-card) border-2 border-line-strong bg-bg px-4 py-2 text-text ${focus}`;
const primary = `inline-flex min-h-14 w-full items-center justify-center rounded-(--radius-card) bg-primary px-4 font-bold text-primary-contrast candy disabled:opacity-60 ${focus}`;
const neutral = `inline-flex min-h-14 items-center justify-center rounded-(--radius-card) border-2 border-line-strong bg-surface px-2 font-bold text-text disabled:opacity-60 ${focus}`;
const link = `inline-flex min-h-11 items-center px-2 text-primary ${focus}`;

/**
 * Simulacro (P7, LD13): acumulativo, con confianza antes de ver cada respuesta (R6) y
 * resultado por tema, sin nota de aprobado ni comparación con nadie. Los botones van al
 * final de cada paso, no en una barra fija: con el teclado de iOS quedarían tapados (UX2).
 */
export function MockScreen() {
  const { t } = useTranslation();
  const { examId } = useParams();
  const view = useMockView(examId);
  if (view === undefined) return <Loading />;
  return (
    <>
      <header className="flex flex-col">
        <Link className={`-ml-2 self-start ${link}`} to="/exams">
          {t('exams.title')}
        </Link>
        <h1 className="m-0 text-title font-extrabold">
          {view ? t('mock.title', { exam: view.exam.title }) : t('mock.titlePlain')}
        </h1>
      </header>
      {view === null ? <EmptyState message={t('mock.missing')} /> : null}
      {view?.active ? <ActiveMock key={view.active.id} view={view} session={view.active} /> : null}
      {view && !view.active ? <MockHome view={view} /> : null}
    </>
  );
}

function MockHome({ view }: { readonly view: MockView }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'busy' | 'empty' | 'failed'>('idle');
  const start = () => {
    setState('busy');
    startMock(view.exam.id).catch((error: unknown) => {
      setState(error instanceof NoMockQuestionsError ? 'empty' : 'failed');
    });
  };
  return (
    <>
      {view.last ? <Results view={view} session={view.last} previous={view.previous} /> : null}
      <section className="flex flex-col gap-2 rounded-(--radius-card) bg-surface shadow-card p-5">
        <p className="m-0">{t('mock.intro', { count: view.config.exam.mockSize })}</p>
        <p className="m-0 text-caption text-muted">
          {t(view.config.exam.feedbackTiming === 'end' ? 'mock.feedbackEnd' : 'mock.feedbackImmediate')}
        </p>
      </section>
      {state === 'empty' ? (
        <p role="status" className="m-0">
          {t('mock.noCards')}
        </p>
      ) : null}
      {state === 'failed' ? (
        <p role="alert" className="m-0">
          {t('error.generic')}
        </p>
      ) : null}
      <button type="button" className={primary} disabled={state === 'busy'} onClick={start}>
        {t(view.last ? 'mock.again' : 'mock.start')}
      </button>
    </>
  );
}

function ActiveMock({ view, session }: { readonly view: MockView; readonly session: StudySession }) {
  // FE6: con el simulacro en pantalla la PWA no se actualiza; fuera de ella, se retoma desde Dexie.
  useHoldSessionLock(true);
  const total = session.items.length;
  const unanswered = session.items.findIndex((i) => i.confidence === null);
  const ungraded = session.items.findIndex((i) => i.correct === null);
  // Con retroalimentación inmediata se califica cada una al responderla; al final, se revisan
  // todas después de la última (P7, [15]).
  const immediate = session.feedbackTiming === 'immediate';
  const asking = immediate ? session.items[ungraded]?.confidence === null : unanswered >= 0;
  const index = asking ? (immediate ? ungraded : unanswered) : ungraded;
  const item = session.items[index];
  const card = item ? view.cards.get(item.cardId) : undefined;
  if (!item || !card) return null;
  return asking ? (
    <AskStep key={`ask-${String(index)}`} session={session} index={index} total={total} card={card} />
  ) : (
    <GradeStep
      key={`grade-${String(index)}`}
      session={session}
      index={index}
      total={total}
      item={item}
      card={card}
      review={!immediate}
    />
  );
}

/** R6: la confianza es obligatoria y va antes de ver la respuesta; escribirla es opcional. */
function AskStep({
  session,
  index,
  total,
  card,
}: {
  readonly session: StudySession;
  readonly index: number;
  readonly total: number;
  readonly card: MockCardView;
}) {
  const { t } = useTranslation();
  const ids = useId();
  // R3: la duración no cuenta el tiempo con la app en segundo plano o el teléfono bloqueado.
  // Empieza al montar la pregunta (el primer aviso de `usePageVisibility`).
  const clock = useRef<CardClock | null>(null);
  usePageVisibility((hidden, at) => {
    const current = clock.current ?? startCardClock(at);
    clock.current = hidden ? pauseCardClock(current, 'hidden', at) : resumeCardClock(current, 'hidden', at);
  });
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (confidence === null || busy) return;
    setBusy(true);
    const durationMs = clock.current ? cardElapsedMs(clock.current, Date.now()) : 0;
    answerMockItem(session.id, index, { confidence, answer, durationMs }).catch(() => {
      setFailed(true); // su respuesta sigue en el campo
      setBusy(false);
    });
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <p className="m-0 text-caption text-muted">{t('mock.progress', { done: index + 1, total })}</p>
      <article className="flex flex-col gap-3 rounded-(--radius-card) bg-surface shadow-card p-5">
        <MockPrompt card={card} revealed={false} />
      </article>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-answer`}>{t('mock.answer')}</label>
        <textarea
          id={`${ids}-answer`}
          className={field}
          rows={3}
          maxLength={MOCK_ANSWER_MAX_LENGTH}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={answer}
          onChange={(event) => {
            setAnswer(event.target.value);
          }}
        />
      </div>
      <div role="group" aria-labelledby={`${ids}-confidence`} className="flex flex-col gap-2">
        <p id={`${ids}-confidence`} className="m-0 text-center text-caption text-muted">
          {t('study.confidence.question')}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {CONFIDENCES.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={confidence === level}
              className={`min-h-14 rounded-(--radius-card) px-2 font-bold text-text ${confidence === level ? 'bg-primary/40 outline-2 outline-primary' : 'bg-primary/20'} ${focus}`}
              onClick={() => {
                setConfidence(level);
              }}
            >
              {t(`study.confidence.level${level}`)}
            </button>
          ))}
        </div>
      </div>
      {failed ? (
        <p role="alert" className="m-0 text-caption">
          {t('mock.saveFailed')}
        </p>
      ) : null}
      <button type="submit" className={primary} disabled={confidence === null || busy}>
        {t(session.feedbackTiming === 'immediate' ? 'study.reveal' : 'mock.next')}
      </button>
    </form>
  );
}

/** R4 y LD2: respuesta y explicación; ella marca si acertó. Sin rojo para el fallo (R19). */
function GradeStep({
  session,
  index,
  total,
  item,
  card,
  review,
}: {
  readonly session: StudySession;
  readonly index: number;
  readonly total: number;
  readonly item: MockItem;
  readonly card: MockCardView;
  readonly review: boolean;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const grade = (correct: boolean) => {
    if (busy) return;
    setBusy(true);
    gradeMockItem(session.id, index, correct).catch(() => {
      setFailed(true);
      setBusy(false);
    });
  };
  return (
    <>
      <p className="m-0 text-caption text-muted">
        {t(review ? 'mock.reviewProgress' : 'mock.progress', { done: index + 1, total })}
      </p>
      <article
        className="flex flex-col gap-3 rounded-(--radius-card) bg-surface shadow-card p-5"
        aria-live="polite"
      >
        <MockPrompt card={card} revealed />
        <section className="flex flex-col gap-1 border-t-2 border-dashed border-line pt-3">
          <h2 className="m-0 text-caption font-normal text-muted">{t('mock.yourAnswer')}</h2>
          <p className="m-0 whitespace-pre-wrap">{item.answer ?? t('mock.noAnswer')}</p>
        </section>
        <section className="flex flex-col gap-1 border-t-2 border-dashed border-line pt-3">
          <h2 className="m-0 text-caption font-normal text-muted">{t('study.answer')}</h2>
          <p className="m-0 text-card whitespace-pre-wrap">{card.answer}</p>
          {card.explanation ? <p className="m-0 whitespace-pre-wrap text-muted">{card.explanation}</p> : null}
        </section>
      </article>
      {failed ? (
        <p role="alert" className="m-0 text-caption">
          {t('mock.saveFailed')}
        </p>
      ) : null}
      <div role="group" aria-labelledby={`${ids}-grade`} className="flex flex-col gap-2">
        <p id={`${ids}-grade`} className="m-0 text-center text-caption text-muted">
          {t('mock.gradeQuestion')}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={neutral}
            disabled={busy}
            onClick={() => {
              grade(false);
            }}
          >
            {t('mock.missed')}
          </button>
          <button
            type="button"
            className={primary}
            disabled={busy}
            onClick={() => {
              grade(true);
            }}
          >
            {t('mock.got')}
          </button>
        </div>
      </div>
    </>
  );
}

/** §5 y LD13: por tema, con tendencia y "pocos datos"; la calibración como frase neutra. */
function Results({
  view,
  session,
  previous,
}: {
  readonly view: MockView;
  readonly session: StudySession;
  readonly previous: StudySession | null;
}) {
  const { t } = useTranslation();
  const id = useId();
  const result = mockResults(session.items, previous?.items ?? null, view.config);
  const c = result.calibration;
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-(--radius-card) bg-surface shadow-card p-5"
    >
      <h2 id={id} className="m-0 text-body font-semibold">
        {t('mock.results')}
      </h2>
      <p className="m-0 text-title font-extrabold">
        {t('mock.total', { correct: result.correct, count: result.graded })}
      </p>
      <ul className="m-0 flex list-none flex-col gap-2 border-t-2 border-dashed border-line p-0 pt-3">
        {result.topics.map((topic) => (
          <li key={topic.topicId ?? 'none'} className="flex flex-col">
            <span className="flex items-baseline justify-between gap-3">
              <span>{(topic.topicId && view.topics.get(topic.topicId)) ?? t('notes.noTopic')}</span>
              <span className="shrink-0 tabular-nums">
                {t('mock.topicScore', { correct: topic.correct, count: topic.graded })}
              </span>
            </span>
            <span className="text-caption text-muted">
              {[
                topic.fewData ? t('mock.fewData') : null,
                topic.previous
                  ? t('mock.before', { correct: topic.previous.correct, count: topic.previous.graded })
                  : null,
                topic.calibration ? t(`mock.topicCalibration.${topic.calibration}`) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </li>
        ))}
      </ul>
      {c ? (
        <div className="flex flex-col gap-1 border-t-2 border-dashed border-line pt-3">
          <p className="m-0 text-caption text-muted">{t('dashboard.calibration.title')}</p>
          <p className="m-0">{t(`mock.calibration.${c.tendency}`)}</p>
          {c.resolution ? <p className="m-0">{t(`dashboard.calibration.${c.resolution}`)}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
