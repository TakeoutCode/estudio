import { DeckSchema } from '@estudio/shared';
import { type SubmitEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { EmptyState } from '@/ui/EmptyState';
import { CardsIcon, PlayIcon, TagIcon, TwinsIcon } from '@/ui/icons';
import { LinkRow } from '@/ui/LinkRow';
import { Loading } from '@/ui/Loading';
import { PageHeader } from '@/ui/PageHeader';
import { createDeck } from './commands';
import { type DeckOverview, useDeckOverview } from './queries';
import { deckSummary } from './summary';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `min-h-11 w-full min-w-0 rounded-(--radius-card) border-2 border-line-strong bg-bg px-4 text-text ${focus}`;

/**
 * Tus mazos, cada uno con lo pendiente de hoy (§5: "pendientes", sin atraso ni rojo). Desde
 * aquí se elige qué mazo estudiar o se abre para editarlo; Hoy sigue mezclándolos (R9, P4).
 */
export function DecksScreen() {
  const { t } = useTranslation();
  const overview = useDeckOverview();
  return (
    <>
      <PageHeader title={t('decks.title')} />
      {overview === undefined ? (
        <Loading />
      ) : overview.length === 0 ? (
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
      {/* Las etiquetas y los grupos de contraste (R9, LD10) pueden mezclar mazos. */}
      <div className="flex flex-col gap-2">
        <LinkRow to="/tags" icon={<TagIcon className="size-5" />}>
          {t('decks.tagsLink')}
        </LinkRow>
        <LinkRow to="/contrast" icon={<TwinsIcon className="size-5" />}>
          {t('decks.contrastLink')}
        </LinkRow>
      </div>
    </>
  );
}

function DeckRow({ item: { deck, load, notes } }: { readonly item: DeckOverview }) {
  const { t } = useTranslation();
  const summary = deckSummary(t, notes, load, deck.pausedAt !== null);
  return (
    <li className="flex items-center gap-3 rounded-(--radius-card) bg-surface py-2 pr-2 pl-2 shadow-card">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-blush text-primary">
        <CardsIcon className="size-6" />
      </div>
      <Link
        className={`flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-(--radius-card) ${focus}`}
        to={`/decks/${deck.id}`}
      >
        <span className="font-bold wrap-break-word">{deck.name}</span>
        <span className="text-caption text-muted">{summary}</span>
      </Link>
      {load.due + load.fresh > 0 ? (
        <Link
          className={`press inline-flex min-h-11 shrink-0 items-center gap-1 rounded-(--radius-card) bg-blush pr-4 pl-3 font-bold text-primary ${focus}`}
          to={`/study?mazo=${deck.id}`}
          aria-label={t('decks.studyNamed', { name: deck.name })}
        >
          <PlayIcon className="size-4" />
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
    <form
      className="flex flex-col gap-2 rounded-(--radius-card) bg-surface p-4 shadow-card"
      onSubmit={submit}
      noValidate
    >
      <label htmlFor={`${id}-name`} className="font-extrabold">
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
          className={`min-h-11 shrink-0 rounded-(--radius-card) bg-primary px-4 font-bold text-primary-contrast candy disabled:opacity-60 ${focus}`}
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
