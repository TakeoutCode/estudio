import { SELF_EXPLANATION_MAX_LENGTH } from '@estudio/shared';
import { type SubmitEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { saveSelfExplanation } from '@/features/study';
import { EmptyState } from '@/ui/EmptyState';
import { type TeachView, useTeachView } from './queries';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `w-full rounded-(--radius-card) border-2 border-line-strong bg-bg px-4 py-2 text-text ${focus}`;
const textLink = `-ml-2 inline-flex min-h-11 items-center self-start px-2 text-primary ${focus}`;
// UX2: como en el editor, la acción va al final del formulario y no en una barra fija.
const primary = `min-h-14 w-full rounded-(--radius-card) bg-primary px-4 font-bold text-primary-contrast candy disabled:opacity-60 ${focus}`;
const card = 'flex flex-col gap-2 rounded-(--radius-card) bg-surface p-4 shadow-card';
/** Cuántas preguntas del tema se listan para comparar; las demás se cuentan. Límite de diseño. */
const PROMPTS_SHOWN = 20;

/**
 * STUDY-METHODS §1 (técnica Feynman, [11]): "Explícaselo a alguien". Primero lo explica sin
 * mirar sus apuntes; después lo compara con la explicación del tema y las preguntas de sus
 * tarjetas (sin respuestas, R1) y anota lo que le faltó. Se guarda como autoexplicación
 * `teach`; no es un repaso (R15): no escribe ReviewLog ni cambia FSRS.
 */
export function TeachScreen() {
  const { t } = useTranslation();
  const { topicId } = useParams();
  const view = useTeachView(topicId);
  if (view === undefined) return null;
  if (view === null) {
    return (
      <>
        <Link className={textLink} to="/decks">
          {t('decks.back')}
        </Link>
        <EmptyState message={t('topics.missing')} />
      </>
    );
  }
  return <TeachForm key={view.topic.id} view={view} />;
}

type Phase = 'write' | 'compare' | 'saved';

function TeachForm({ view }: { readonly view: TeachView }) {
  const { t, i18n } = useTranslation();
  const ids = useId();
  const { topic, prompts } = view;
  const [phase, setPhase] = useState<Phase>('write');
  const [text, setText] = useState('');
  const [gaps, setGaps] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const date = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long' });

  const save = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailed(false);
    saveSelfExplanation({ topicId: topic.id, text, kind: 'teach', gaps })
      .then(() => {
        setPhase('saved');
      })
      .catch(() => {
        setFailed(true);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link className={textLink} to={`/topics/${topic.id}`}>
          {t('teach.back')}
        </Link>
        <h1 className="m-0 text-title font-extrabold">{t('teach.title')}</h1>
        <p className="m-0 text-caption text-muted wrap-break-word">{topic.name}</p>
      </header>
      {phase === 'write' ? (
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim() !== '') setPhase('compare');
          }}
        >
          <p className="m-0">{t('teach.intro')}</p>
          <p className="m-0 text-caption text-muted">
            {view.lastTaughtAt === null
              ? t('teach.notReview')
              : t('teach.last', { date: date.format(view.lastTaughtAt) })}
          </p>
          <label className="flex flex-col gap-1">
            <span className="font-bold">{t('teach.yours')}</span>
            <textarea
              className={field}
              rows={8}
              maxLength={SELF_EXPLANATION_MAX_LENGTH}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          </label>
          <button type="submit" className={primary} disabled={text.trim() === ''}>
            {t('teach.compare')}
          </button>
        </form>
      ) : null}
      {phase === 'compare' ? (
        <form className="flex flex-col gap-3" noValidate onSubmit={save}>
          <section className={card} aria-labelledby={`${ids}-yours`}>
            <h2 id={`${ids}-yours`} className="m-0 text-caption font-normal text-muted">
              {t('teach.yours')}
            </h2>
            <p className="m-0 whitespace-pre-wrap wrap-break-word">{text.trim()}</p>
          </section>
          <section className={card} aria-labelledby={`${ids}-notes`}>
            <h2 id={`${ids}-notes`} className="m-0 text-caption font-normal text-muted">
              {t('teach.notesTitle')}
            </h2>
            {topic.explanation === '' ? (
              <p className="m-0 text-muted">{t('teach.noExplanation')}</p>
            ) : (
              <p className="m-0 whitespace-pre-wrap wrap-break-word">{topic.explanation}</p>
            )}
            {prompts.length > 0 ? (
              <>
                <p className="m-0 mt-2 font-bold">{t('teach.prompts', { count: prompts.length })}</p>
                <ul className="m-0 flex flex-col gap-1 pl-5">
                  {prompts.slice(0, PROMPTS_SHOWN).map((prompt, i) => (
                    // Las preguntas pueden repetirse; su posición no cambia mientras compara.
                    <li key={i} className="whitespace-pre-wrap wrap-break-word">
                      {prompt}
                    </li>
                  ))}
                </ul>
                {prompts.length > PROMPTS_SHOWN ? (
                  <p className="m-0 text-caption text-muted">
                    {t('teach.more', { count: prompts.length - PROMPTS_SHOWN })}
                  </p>
                ) : null}
              </>
            ) : null}
          </section>
          <label className="flex flex-col gap-1">
            <span className="font-bold">{t('teach.gaps')}</span>
            <span id={`${ids}-gaps`} className="text-caption text-muted">
              {t('teach.gapsHint')}
            </span>
            <textarea
              className={field}
              rows={4}
              maxLength={SELF_EXPLANATION_MAX_LENGTH}
              aria-describedby={`${ids}-gaps`}
              value={gaps}
              onChange={(event) => {
                setGaps(event.target.value);
              }}
            />
          </label>
          {failed ? (
            <p role="alert" className="m-0 text-caption">
              {t('error.generic')}
            </p>
          ) : null}
          <button type="submit" className={primary} disabled={busy}>
            {t('teach.save')}
          </button>
        </form>
      ) : null}
      {phase === 'saved' ? (
        <div role="status" className="flex flex-col gap-2">
          <p className="m-0">{t(gaps.trim() === '' ? 'teach.saved' : 'teach.savedGaps')}</p>
          <Link className={textLink} to={`/topics/${topic.id}`}>
            {t('teach.back')}
          </Link>
        </div>
      ) : null}
    </>
  );
}
