import { DeckSchema } from '@estudio/shared';
import { type SubmitEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { EmptyState } from '@/ui/EmptyState';
import { createDeck } from './commands';
import { type DeckOverview, useDeckOverview } from './queries';
import { deckSummary } from './summary';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `min-h-11 w-full min-w-0 rounded-(--radius-card) border border-muted/40 bg-bg px-4 text-text ${focus}`;
const textLink = `-ml-2 inline-flex min-h-11 items-center self-start px-2 text-primary ${focus}`;

/**
 * Tus mazos, cada uno con lo pendiente de hoy (§5: "pendientes", sin atraso ni rojo). Desde
 * aquí se elige qué mazo estudiar o se abre para editarlo; Hoy sigue mezclándolos (R9, P4).
 */
export function DecksScreen() {
  const { t } = useTranslation();
  const overview = useDeckOverview();
  return (
    <>
      <header className="flex flex-col">
        <Link className={textLink} to="/">
          {t('notes.backToToday')}
        </Link>
        <h1 className="m-0 text-title font-semibold">{t('decks.title')}</h1>
      </header>
      {overview === undefined ? null : overview.length === 0 ? (
        <EmptyState message={t('decks.empty')} />
      ) : (
        <>
          <p className="m-0 text-caption text-muted">{t('decks.hint')}</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {overview.map((item) => (
              <DeckRow key={item.deck.id} item={item} />
            ))}
          </ul>
        </>
      )}
      <NewDeckForm />
    </>
  );
}

function DeckRow({ item: { deck, load, notes } }: { readonly item: DeckOverview }) {
  const { t } = useTranslation();
  const summary = deckSummary(t, notes, load);
  return (
    <li className="flex items-center gap-2 rounded-(--radius-card) bg-surface py-2 pr-2 pl-4">
      <Link
        className={`flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-(--radius-card) ${focus}`}
        to={`/decks/${deck.id}`}
      >
        <span className="font-medium wrap-break-word">{deck.name}</span>
        <span className="text-caption text-muted">{summary}</span>
      </Link>
      {load.due + load.fresh > 0 ? (
        <Link
          className={`inline-flex min-h-11 shrink-0 items-center rounded-(--radius-card) border border-primary px-3 font-medium text-primary ${focus}`}
          to={`/study?mazo=${deck.id}`}
          aria-label={t('decks.studyNamed', { name: deck.name })}
        >
          {t('decks.study')}
        </Link>
      ) : null}
    </li>
  );
}

type Status = 'idle' | 'invalid' | 'failed';

/** Un mazo nuevo y vacío; se abre para añadirle tarjetas. */
function NewDeckForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const id = useId();
  const [name, setName] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [busy, setBusy] = useState(false);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!DeckSchema.shape.name.safeParse(name).success) {
      setStatus('invalid');
      return;
    }
    setBusy(true);
    createDeck({ name })
      .then((deck) => navigate(`/decks/${deck.id}`))
      .catch(() => {
        setStatus('failed');
        setBusy(false);
      });
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={submit} noValidate>
      <label htmlFor={`${id}-name`} className="font-semibold">
        {t('decks.new')}
      </label>
      <div className="flex gap-2">
        <input
          id={`${id}-name`}
          className={field}
          value={name}
          maxLength={120}
          aria-invalid={status === 'invalid'}
          aria-describedby={status === 'idle' ? undefined : `${id}-error`}
          onChange={(event) => {
            setName(event.target.value);
            setStatus('idle');
          }}
        />
        <button
          type="submit"
          className={`min-h-11 shrink-0 rounded-(--radius-card) bg-primary px-4 font-medium text-primary-contrast disabled:opacity-60 ${focus}`}
          disabled={busy}
        >
          {t('decks.create')}
        </button>
      </div>
      {status === 'idle' ? null : (
        <p id={`${id}-error`} role="alert" className="m-0 text-caption">
          {t(status === 'invalid' ? 'notes.error.deck' : 'error.generic')}
        </p>
      )}
    </form>
  );
}
