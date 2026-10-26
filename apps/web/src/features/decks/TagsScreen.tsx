import { TagSchema } from '@estudio/shared';
import { type SubmitEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { EmptyState } from '@/ui/EmptyState';
import { Loading } from '@/ui/Loading';
import { deleteTag, renameTag } from './commands';
import { type TagOverview, useTagOverview } from './queries';
import { deckSummary } from './summary';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `min-h-11 w-full min-w-0 rounded-(--radius-card) border-2 border-line-strong bg-bg px-4 text-text ${focus}`;
const textLink = `-ml-2 inline-flex min-h-11 items-center self-start px-2 text-primary ${focus}`;
const outline = `inline-flex min-h-11 shrink-0 items-center rounded-(--radius-card) border-2 border-primary px-3 font-bold text-primary ${focus}`;
const quiet = `inline-flex min-h-11 shrink-0 items-center px-3 text-primary ${focus}`;

/**
 * Etiquetas (diseño): juntan tarjetas de varios mazos. Se agregan al editar una tarjeta; aquí
 * se estudia una sola (como un mazo, P1-P8 solo sobre ellas), se renombra o se borra.
 */
export function TagsScreen() {
  const { t } = useTranslation();
  const overview = useTagOverview();
  return (
    <>
      <header className="flex flex-col">
        <Link className={textLink} to="/decks">
          {t('tags.back')}
        </Link>
        <h1 className="m-0 text-title font-extrabold">{t('tags.title')}</h1>
      </header>
      {overview === undefined ? (
        <Loading />
      ) : overview.length === 0 ? (
        <EmptyState
          message={t('tags.empty')}
          action={
            <Link className={quiet} to="/notes/new">
              {t('today.addCard')}
            </Link>
          }
        />
      ) : (
        <>
          <p className="m-0 text-caption text-muted">{t('tags.hint')}</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {overview.map((item) => (
              <TagRow key={item.tag.id} item={item} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

type Status = 'idle' | 'invalid' | 'taken' | 'failed';

function TagRow({ item: { tag, load, notes } }: { readonly item: TagOverview }) {
  const { t } = useTranslation();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [busy, setBusy] = useState(false);

  const close = () => {
    setEditing(false);
    setConfirming(false);
    setStatus('idle');
    setName(tag.name);
  };
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!TagSchema.shape.name.safeParse(name).success) {
      setStatus('invalid');
      return;
    }
    setBusy(true);
    renameTag(tag.id, name)
      .then(() => {
        setEditing(false);
        setStatus('idle');
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error && error.message === 'tag_name_taken' ? 'taken' : 'failed');
      })
      .finally(() => {
        setBusy(false);
      });
  };
  const remove = () => {
    setBusy(true);
    deleteTag(tag.id).catch(() => {
      setStatus('failed');
      setBusy(false);
    });
  };

  return (
    <li className="flex flex-col gap-2 rounded-(--radius-card) bg-surface shadow-card py-2 pr-2 pl-4">
      <div className="flex items-center gap-2">
        <div className="flex min-h-11 min-w-0 flex-1 flex-col justify-center">
          <span className="font-bold wrap-break-word">{tag.name}</span>
          <span className="text-caption text-muted">{deckSummary(t, notes, load, false)}</span>
        </div>
        {load.due + load.fresh > 0 ? (
          <Link
            className={outline}
            to={`/study?etiqueta=${tag.id}`}
            aria-label={t('tags.studyNamed', { name: tag.name })}
          >
            {t('decks.study')}
          </Link>
        ) : null}
        <button
          type="button"
          className={quiet}
          aria-expanded={editing}
          aria-controls={`${id}-edit`}
          aria-label={t('tags.editNamed', { name: tag.name })}
          onClick={() => {
            if (editing) close();
            else setEditing(true);
          }}
        >
          {t(editing ? 'tags.close' : 'tags.edit')}
        </button>
      </div>
      {editing ? (
        <div id={`${id}-edit`} className="flex flex-col gap-2 pb-2">
          <form className="flex gap-2" onSubmit={submit} noValidate>
            <input
              className={field}
              value={name}
              maxLength={60}
              aria-label={t('tags.name')}
              aria-invalid={status === 'invalid' || status === 'taken'}
              onChange={(event) => {
                setName(event.target.value);
                setStatus('idle');
              }}
            />
            <button
              type="submit"
              className={`min-h-11 shrink-0 rounded-(--radius-card) bg-primary px-4 font-bold text-primary-contrast candy disabled:opacity-60 ${focus}`}
              disabled={busy}
            >
              {t('tags.save')}
            </button>
          </form>
          {confirming ? (
            <div role="alertdialog" aria-labelledby={`${id}-confirm`} className="flex flex-col gap-2">
              <p id={`${id}-confirm`} className="m-0">
                {t('tags.confirmDelete', { name: tag.name, count: notes })}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`min-h-11 rounded-(--radius-card) border-2 border-danger px-4 font-bold text-danger disabled:opacity-60 ${focus}`}
                  disabled={busy}
                  onClick={remove}
                >
                  {t('tags.delete')}
                </button>
                <button
                  type="button"
                  className={quiet}
                  onClick={() => {
                    setConfirming(false);
                  }}
                >
                  {t('tags.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`-ml-3 inline-flex min-h-11 items-center self-start px-3 text-danger ${focus}`}
              onClick={() => {
                setConfirming(true);
              }}
            >
              {t('tags.delete')}
            </button>
          )}
          {status === 'idle' ? null : (
            <p role="alert" className="m-0 text-caption">
              {t(`tags.error.${status}`)}
            </p>
          )}
        </div>
      ) : null}
    </li>
  );
}
