import { type Topic, TOPIC_EXPLANATION_MAX_LENGTH, TopicSchema } from '@estudio/shared';
import { type SubmitEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { EmptyState } from '@/ui/EmptyState';
import { deleteTopic, updateTopic } from './commands';
import { useTopic } from './queries';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `w-full rounded-(--radius-card) border-2 border-line-strong bg-bg px-4 py-2 text-text ${focus}`;
// UX2: como en el editor de notas, guardar va al final del formulario y no en una barra fija,
// para que con el teclado abierto en iOS no quede tapado.
const primary = `min-h-14 w-full rounded-(--radius-card) bg-primary px-4 font-bold text-primary-contrast candy disabled:opacity-60 ${focus}`;

/** LD5, R5: el tema y la explicación que se muestra antes de su primera tarjeta nueva. */
export function TopicScreen() {
  const { t } = useTranslation();
  const { topicId } = useParams();
  const topic = useTopic(topicId);
  if (topic === undefined) return null;
  if (topic === null) {
    return (
      <>
        <Link
          className={`-ml-2 inline-flex min-h-11 items-center self-start px-2 text-primary ${focus}`}
          to="/decks"
        >
          {t('decks.back')}
        </Link>
        <EmptyState message={t('topics.missing')} />
      </>
    );
  }
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
  const [confirming, setConfirming] = useState(false);
  // El tema es de un mazo: "Volver" y borrar regresan a él, venga de donde venga.
  const deckPath = `/decks/${topic.deckId}`;

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
          to={deckPath}
        >
          {t('notes.backToDeck')}
        </Link>
        <h1 className="m-0 text-title font-extrabold">{t('topics.title')}</h1>
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
      {/* STUDY-METHODS §1: modo opcional, cuando ella quiera. */}
      <section className="flex flex-col gap-1">
        <Link
          className={`-ml-2 inline-flex min-h-11 items-center self-start px-2 font-bold text-primary ${focus}`}
          to={`/topics/${topic.id}/explicar`}
        >
          {t('topics.teach')}
        </Link>
        <p className="m-0 text-caption text-muted">{t('topics.teachHint')}</p>
      </section>
      {confirming ? (
        <div role="alertdialog" aria-labelledby={`${ids}-confirm`} className="flex flex-col gap-2">
          <p id={`${ids}-confirm`} className="m-0">
            {t('topics.deleteConfirm')}
          </p>
          <button
            type="button"
            className={`min-h-11 w-full rounded-(--radius-card) border-2 border-danger px-4 font-bold text-danger disabled:opacity-60 ${focus}`}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              deleteTopic(topic.id)
                .then(() => navigate(deckPath))
                .catch(() => {
                  setStatus('failed');
                  setBusy(false);
                });
            }}
          >
            {t('topics.deleteYes')}
          </button>
          <button
            type="button"
            className={`min-h-11 w-full rounded-(--radius-card) px-4 text-primary ${focus}`}
            onClick={() => {
              setConfirming(false);
            }}
          >
            {t('decks.cancel')}
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className={`min-h-11 w-full rounded-(--radius-card) px-4 text-danger ${focus}`}
            onClick={() => {
              setConfirming(true);
            }}
          >
            {t('topics.delete')}
          </button>
          <p className="m-0 text-center text-caption text-muted">{t('topics.deleteHint')}</p>
        </>
      )}
    </>
  );
}
