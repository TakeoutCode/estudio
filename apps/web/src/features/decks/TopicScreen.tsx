import { type Topic, TOPIC_EXPLANATION_MAX_LENGTH, TopicSchema } from '@estudio/shared';
import { type SubmitEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { EmptyState } from '@/ui/EmptyState';
import { deleteTopic, updateTopic } from './commands';
import { useTopic } from './queries';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `w-full rounded-(--radius-card) border border-muted/40 bg-bg px-4 py-2 text-text ${focus}`;
// UX2: como en el editor de notas, guardar va al final del formulario y no en una barra fija,
// para que con el teclado abierto en iOS no quede tapado.
const primary = `min-h-14 w-full rounded-(--radius-card) bg-primary px-4 font-medium text-primary-contrast disabled:opacity-60 ${focus}`;

/** LD5, R5: el tema y la explicación que se muestra antes de su primera tarjeta nueva. */
export function TopicScreen() {
  const { t } = useTranslation();
  const { topicId } = useParams();
  const topic = useTopic(topicId);
  if (topic === undefined) return null;
  if (topic === null) return <EmptyState message={t('topics.missing')} />;
  return <TopicForm key={topic.id} topic={topic} />;
}

type Status = 'idle' | 'saved' | 'invalid' | 'failed';

function TopicForm({ topic }: { readonly topic: Topic }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ids = useId();
  const [name, setName] = useState(topic.name);
  const [explanation, setExplanation] = useState(topic.explanation);
  const [status, setStatus] = useState<Status>('idle');
  const [busy, setBusy] = useState(false);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!TopicSchema.shape.name.safeParse(name).success) {
      setStatus('invalid');
      return;
    }
    setBusy(true);
    updateTopic(topic.id, { name, explanation })
      .then(() => {
        setStatus('saved');
      })
      .catch(() => {
        setStatus('failed');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const message = {
    idle: null,
    saved: t('topics.saved'),
    invalid: t('topics.error.name'),
    failed: t('error.generic'),
  }[status];

  return (
    <>
      <header className="flex flex-col">
        <Link
          className={`-ml-2 inline-flex min-h-11 items-center self-start px-2 text-primary ${focus}`}
          to="/"
        >
          {t('notes.backToToday')}
        </Link>
        <h1 className="m-0 text-title font-semibold">{t('topics.title')}</h1>
      </header>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <label className="flex flex-col gap-1">
          <span>{t('topics.name')}</span>
          <input
            className={field + ' min-h-11'}
            value={name}
            maxLength={120}
            onChange={(event) => {
              setName(event.target.value);
              setStatus('idle');
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t('notes.topicExplanation')}</span>
          <textarea
            className={field}
            rows={6}
            maxLength={TOPIC_EXPLANATION_MAX_LENGTH}
            aria-describedby={`${ids}-hint`}
            value={explanation}
            onChange={(event) => {
              setExplanation(event.target.value);
              setStatus('idle');
            }}
          />
          <span id={`${ids}-hint`} className="text-caption text-muted">
            {t('notes.topicExplanationHint')}
          </span>
        </label>
        {message ? (
          <p role="status" className="m-0 text-caption">
            {message}
          </p>
        ) : null}
        <button type="submit" className={primary} disabled={busy}>
          {t('topics.save')}
        </button>
      </form>
      <button
        type="button"
        className={`min-h-11 w-full rounded-(--radius-card) px-4 text-danger ${focus}`}
        onClick={() => {
          void deleteTopic(topic.id).then(() => navigate('/'));
        }}
      >
        {t('topics.delete')}
      </button>
      <p className="m-0 text-center text-caption text-muted">{t('topics.deleteHint')}</p>
    </>
  );
}
