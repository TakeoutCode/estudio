import { type Exam, ExamSchema, localDateOf, LocalDateSchema, startOfLocalDate } from '@estudio/shared';
import { type SubmitEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { createExam, deleteExam, updateExam } from './commands';
import { type DeckTopics, useExam, useTimeZone, useTopicsByDeck } from './queries';
import { Loading } from '@/ui/Loading';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `w-full rounded-(--radius-card) border-2 border-line-strong bg-bg px-4 py-2 text-text ${focus}`;
// UX2: guardar va al final del formulario, como en el editor de notas (teclado de iOS).
const primary = `min-h-14 w-full rounded-(--radius-card) bg-primary px-4 font-bold text-primary-contrast candy disabled:opacity-60 ${focus}`;

/** R11, LD11: título, fecha y temas de un examen. */
export function ExamEditorScreen() {
  const { examId } = useParams();
  const exam = useExam(examId);
  const groups = useTopicsByDeck();
  const timeZone = useTimeZone();
  if (exam === undefined || groups === undefined || timeZone === undefined) return <Loading />;
  return <ExamForm key={exam?.id ?? 'new'} exam={exam} groups={groups} timeZone={timeZone} />;
}

type Status = 'idle' | 'title' | 'date' | 'topics' | 'failed';

function ExamForm({
  exam,
  groups,
  timeZone,
}: {
  readonly exam: Exam | null;
  readonly groups: readonly DeckTopics[];
  readonly timeZone: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [title, setTitle] = useState(exam?.title ?? '');
  const [date, setDate] = useState(exam ? localDateOf(exam.date, timeZone) : '');
  const [topicIds, setTopicIds] = useState<ReadonlySet<string>>(() => new Set(exam?.topicIds ?? []));
  const [status, setStatus] = useState<Status>('idle');
  const [busy, setBusy] = useState(false);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const day = LocalDateSchema.safeParse(date);
    // Solo los temas que siguen vivos; uno borrado se cae del alcance al guardar.
    const alive = new Set(groups.flatMap((g) => g.topics.map((topic) => topic.id)));
    const chosen = [...topicIds].filter((id) => alive.has(id));
    const invalid: Status | null = !ExamSchema.shape.title.safeParse(title).success
      ? 'title'
      : !day.success
        ? 'date'
        : chosen.length === 0
          ? 'topics'
          : null;
    if (invalid || !day.success) {
      setStatus(invalid ?? 'date');
      return;
    }
    const input = { title, date: startOfLocalDate(day.data, timeZone), topicIds: chosen };
    setBusy(true);
    (exam ? updateExam(exam.id, input) : createExam(input))
      .then(() => navigate('/exams'))
      .catch(() => {
        setStatus('failed');
        setBusy(false);
      });
  };

  const toggle = (id: string, on: boolean) => {
    setTopicIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    setStatus('idle');
  };

  const message = {
    idle: null,
    title: t('exams.error.title'),
    date: t('exams.error.date'),
    topics: t('exams.error.topics'),
    failed: t('error.generic'),
  }[status];

  return (
    <>
      <header className="flex flex-col">
        <Link
          className={`-ml-2 inline-flex min-h-11 items-center self-start px-2 text-primary ${focus}`}
          to="/exams"
        >
          {t('exams.title')}
        </Link>
        <h1 className="m-0 text-title font-extrabold">{t(exam ? 'exams.editTitle' : 'exams.newTitle')}</h1>
      </header>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <label className="flex flex-col gap-1">
          <span>{t('exams.name')}</span>
          <input
            className={field + ' min-h-11'}
            value={title}
            maxLength={120}
            onChange={(event) => {
              setTitle(event.target.value);
              setStatus('idle');
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t('exams.date')}</span>
          <input
            type="date"
            className={field + ' min-h-11'}
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setStatus('idle');
            }}
          />
        </label>
        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <legend className="mb-1">{t('exams.topics')}</legend>
          {groups.length === 0 ? (
            <p className="m-0 text-caption text-muted">
              {t('exams.noTopics')}{' '}
              <Link className={`text-primary ${focus}`} to="/notes/new">
                {t('today.addCard')}
              </Link>
            </p>
          ) : null}
          {groups.map((group) => (
            <div key={group.deck.id} className="flex flex-col">
              <p className="m-0 text-caption text-muted">{group.deck.name}</p>
              {group.topics.map((topic) => (
                <label key={topic.id} className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-primary"
                    checked={topicIds.has(topic.id)}
                    onChange={(event) => {
                      toggle(topic.id, event.target.checked);
                    }}
                  />
                  <span>{topic.name}</span>
                </label>
              ))}
            </div>
          ))}
        </fieldset>
        {message ? (
          <p role="status" className="m-0 text-caption">
            {message}
          </p>
        ) : null}
        <button type="submit" className={primary} disabled={busy}>
          {t('exams.save')}
        </button>
      </form>
      {exam ? (
        <button
          type="button"
          className={`min-h-11 w-full rounded-(--radius-card) px-4 text-danger ${focus}`}
          onClick={() => {
            void deleteExam(exam.id).then(() => navigate('/exams'));
          }}
        >
          {t('exams.delete')}
        </button>
      ) : null}
    </>
  );
}
