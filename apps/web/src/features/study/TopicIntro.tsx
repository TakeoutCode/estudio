import { SELF_EXPLANATION_MAX_LENGTH } from '@estudio/shared';
import { type SubmitEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { saveSelfExplanation } from './commands';
import { useTopicView } from './queries';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `w-full rounded-(--radius-card) border-2 border-line-strong bg-bg px-4 py-2 text-text ${focus}`;
const primary = `inline-flex min-h-14 w-full items-center justify-center rounded-(--radius-card) bg-primary px-4 font-bold text-primary-contrast candy disabled:opacity-60 ${focus}`;
const secondary = `inline-flex min-h-11 w-full items-center justify-center rounded-(--radius-card) px-4 text-primary ${focus}`;

/**
 * LD5 y R5: separar entender de recordar. Antes de la primera tarjeta nueva de un tema, su
 * explicación y "Explícalo con tus palabras". No es un repaso (R15) y se puede dejar para
 * después. Los botones van al final y no en una barra fija: con el teclado abierto en iOS,
 * una barra fija quedaría tapada (UX2).
 */
export function TopicIntro({
  topicId,
  onDone,
  onPostpone,
}: {
  readonly topicId: string;
  readonly onDone: () => void;
  readonly onPostpone: () => void;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const topic = useTopicView(topicId);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // Borrado mientras tanto (p. ej. desde otro dispositivo): no hay nada que explicar.
  useEffect(() => {
    if (topic === null) onPostpone();
  }, [topic, onPostpone]);

  if (!topic) return null;

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (text.trim() === '' || busy) return;
    setBusy(true);
    setFailed(false);
    saveSelfExplanation({ topicId, text })
      .then(onDone)
      .catch(() => {
        setFailed(true); // su texto sigue en el campo
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <section
        aria-labelledby={`${ids}-name`}
        className="flex flex-col gap-2 rounded-(--radius-card) bg-surface shadow-card p-5"
      >
        <p className="m-0 text-caption text-muted">{t('study.topicIntro.label')}</p>
        <h2 id={`${ids}-name`} className="m-0 text-title font-extrabold">
          {topic.name}
        </h2>
        {topic.explanation ? <p className="m-0 whitespace-pre-wrap">{topic.explanation}</p> : null}
      </section>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-text`} className="font-semibold">
          {t('study.topicIntro.prompt')}
        </label>
        <textarea
          id={`${ids}-text`}
          className={field}
          rows={4}
          maxLength={SELF_EXPLANATION_MAX_LENGTH}
          aria-describedby={`${ids}-hint`}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <span id={`${ids}-hint`} className="text-caption text-muted">
          {t('study.topicIntro.hint')}
        </span>
      </div>
      {failed ? (
        <p role="alert" className="m-0 text-caption">
          {t('study.topicIntro.failed')}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <button type="submit" className={primary} disabled={busy || text.trim() === ''}>
          {t('study.topicIntro.save')}
        </button>
        <button type="button" className={secondary} onClick={onPostpone}>
          {t('study.topicIntro.later')}
        </button>
      </div>
    </form>
  );
}
