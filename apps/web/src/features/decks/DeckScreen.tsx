import { type Deck, DeckSchema, type Topic } from '@estudio/shared';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { type SubmitEvent, useCallback, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { ActionBar } from '@/ui/ActionBar';
import { EmptyState } from '@/ui/EmptyState';
import { Toggle } from '@/ui/Toggle';
import { deleteDeck, setDeckPaused, updateDeck } from './commands';
import { type DeckDetail, type DeckNoteRow, matchesSearch, useDeckDetail } from './queries';
import { deckSummary } from './summary';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `w-full rounded-(--radius-card) border border-muted/40 bg-bg px-4 py-2 text-text ${focus}`;
const textLink = `-ml-2 inline-flex min-h-11 items-center self-start px-2 text-primary ${focus}`;
const primary = `inline-flex min-h-14 w-full items-center justify-center rounded-(--radius-card) bg-primary px-4 font-medium text-primary-contrast disabled:opacity-60 ${focus}`;
const secondary = `inline-flex min-h-11 w-full items-center justify-center rounded-(--radius-card) px-4 text-primary ${focus}`;

/** Alto de cada fila y separación, en rem: con el texto al 200 % (UX4) crecen con él. */
const ROW_REM = 4.5;
const GAP_REM = 0.5;

/**
 * Un mazo: estudiarlo solo a él, añadirle tarjetas, ver sus temas y sus tarjetas, y editar su
 * nombre o borrarlo. La lista se virtualiza (FE9): el mazo de huesos tiene 206.
 */
export function DeckScreen() {
  const { t } = useTranslation();
  const { deckId } = useParams();
  const detail = useDeckDetail(deckId);
  if (detail === undefined) return null;
  if (detail === null) {
    return (
      <>
        <Link className={textLink} to="/decks">
          {t('decks.back')}
        </Link>
        <EmptyState message={t('decks.missing')} />
      </>
    );
  }
  return <DeckView key={detail.deck.id} detail={detail} />;
}

function DeckView({ detail: { deck, load, topics, notes } }: { readonly detail: DeckDetail }) {
  const { t } = useTranslation();
  const editId = useId();
  const [editing, setEditing] = useState(false);
  const paused = deck.pausedAt !== null;
  const summary = deckSummary(t, notes.length, load, paused);
  return (
    <>
      <header className="flex flex-col gap-1">
        <Link className={textLink} to="/decks">
          {t('decks.back')}
        </Link>
        <h1 className="m-0 text-title font-semibold wrap-break-word">{deck.name}</h1>
        {deck.description ? <p className="m-0 whitespace-pre-wrap text-muted">{deck.description}</p> : null}
        <p className="m-0 text-caption text-muted">{summary}</p>
      </header>
      <PauseToggle deckId={deck.id} paused={paused} />
      <div className="flex flex-col">
        <button
          type="button"
          className={textLink}
          aria-expanded={editing}
          aria-controls={editId}
          onClick={() => {
            setEditing(!editing);
          }}
        >
          {t('decks.edit')}
        </button>
        {editing ? <DeckEditForm id={editId} deck={deck} noteCount={notes.length} /> : null}
      </div>
      <TopicList topics={topics} />
      <NoteList deckId={deck.id} notes={notes} />
      <ActionBar>
        {load.due + load.fresh > 0 ? (
          <Link className={primary} to={`/study?mazo=${deck.id}`}>
            {t('decks.studyThis')}
          </Link>
        ) : null}
        <Link className={load.due + load.fresh > 0 ? secondary : primary} to={`/notes/new?mazo=${deck.id}`}>
          {t('today.addCard')}
        </Link>
      </ActionBar>
    </>
  );
}

/**
 * Pausar (*diseño*): el mazo sale de Hoy, de la carga y de los recordatorios, sin tocar FSRS
 * (LD9). Se guarda al tocarlo, como el tema; la consulta en vivo trae el estado nuevo.
 */
function PauseToggle({ deckId, paused }: { readonly deckId: string; readonly paused: boolean }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  // Lo elegido se ve al instante; cuando llega el valor guardado (o de otro dispositivo), manda ese.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [stored, setStored] = useState(paused);
  if (stored !== paused) {
    setStored(paused);
    setChosen(null);
  }
  const shown = chosen ?? paused;
  return (
    <div className="flex flex-col gap-1 rounded-(--radius-card) bg-surface px-4 py-2">
      <Toggle
        label={t('decks.pause')}
        hint={t(shown ? 'decks.pausedHint' : 'decks.pauseHint')}
        checked={shown}
        onChange={(next) => {
          setFailed(false);
          setChosen(next);
          setDeckPaused(deckId, next).catch(() => {
            setChosen(null);
            setFailed(true);
          });
        }}
      />
      {failed ? (
        <p role="alert" className="m-0 text-caption">
          {t('error.generic')}
        </p>
      ) : null}
    </div>
  );
}

type Status = 'idle' | 'saved' | 'invalid' | 'failed';

/** Nombre y descripción; borrar pide confirmación porque se lleva sus tarjetas (SY5). */
function DeckEditForm({
  id,
  deck,
  noteCount,
}: {
  readonly id: string;
  readonly deck: Deck;
  readonly noteCount: number;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState(deck.name);
  const [description, setDescription] = useState(deck.description ?? '');
  const [status, setStatus] = useState<Status>('idle');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!DeckSchema.shape.name.safeParse(name).success) {
      setStatus('invalid');
      return;
    }
    setBusy(true);
    updateDeck(deck.id, { name, description })
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
  const remove = () => {
    setBusy(true);
    deleteDeck(deck.id)
      .then(() => navigate('/decks'))
      .catch(() => {
        setStatus('failed');
        setBusy(false);
      });
  };

  const message = {
    idle: null,
    saved: t('decks.saved'),
    invalid: t('decks.error.name'),
    failed: t('error.generic'),
  }[status];

  return (
    <div id={id} className="flex flex-col gap-4 rounded-(--radius-card) bg-surface p-4">
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <label className="flex flex-col gap-1">
          <span>{t('decks.name')}</span>
          <input
            className={`${field} min-h-11`}
            value={name}
            maxLength={120}
            onChange={(event) => {
              setName(event.target.value);
              setStatus('idle');
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t('decks.description')}</span>
          <textarea
            className={field}
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              setStatus('idle');
            }}
          />
        </label>
        {message ? (
          <p role="status" className="m-0 text-caption">
            {message}
          </p>
        ) : null}
        <button type="submit" className={primary} disabled={busy}>
          {t('decks.save')}
        </button>
      </form>
      {confirming ? (
        <div role="alertdialog" aria-labelledby={`${id}-confirm`} className="flex flex-col gap-2">
          <p id={`${id}-confirm`} className="m-0">
            {t('decks.deleteConfirm', { count: noteCount })}
          </p>
          <button
            type="button"
            className={`min-h-11 w-full rounded-(--radius-card) border border-danger px-4 font-medium text-danger disabled:opacity-60 ${focus}`}
            disabled={busy}
            onClick={remove}
          >
            {t('decks.deleteYes')}
          </button>
          <button
            type="button"
            className={secondary}
            onClick={() => {
              setConfirming(false);
            }}
          >
            {t('decks.cancel')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`min-h-11 w-full rounded-(--radius-card) px-4 text-danger ${focus}`}
          onClick={() => {
            setConfirming(true);
          }}
        >
          {t('decks.delete')}
        </button>
      )}
    </div>
  );
}

/** LD5, P4: los temas del mazo; cada uno abre su explicación. */
function TopicList({ topics }: { readonly topics: readonly Topic[] }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="m-0 text-body font-semibold">
        {t('decks.topics')}
      </h2>
      {topics.length === 0 ? (
        <p className="m-0 text-caption text-muted">{t('decks.noTopics')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {topics.map((topic) => (
            <li key={topic.id}>
              <Link
                className={`inline-flex min-h-11 items-center rounded-(--radius-card) border border-muted/40 px-3 text-text ${focus}`}
                to={`/topics/${topic.id}`}
              >
                {topic.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * FE9: lista virtualizada contra el scroll de la ventana. `top` es dónde empieza la lista en
 * la página; se mide al montarla y cada vez que cambia el alto de lo que hay arriba.
 */
function NoteList({ deckId, notes }: { readonly deckId: string; readonly notes: readonly DeckNoteRow[] }) {
  const { t } = useTranslation();
  const id = useId();
  const [query, setQuery] = useState('');
  const shown = useMemo(
    () => (query.trim() === '' ? notes : notes.filter((note) => matchesSearch(note, query))),
    [notes, query],
  );
  const [layout, setLayout] = useState({ top: 0, rem: 16 });
  const measure = useCallback((list: HTMLUListElement | null) => {
    if (!list) return;
    const update = () => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const top = list.getBoundingClientRect().top + window.scrollY;
      setLayout((prev) => (prev.top === top && prev.rem === rem ? prev : { top, rem }));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(document.body);
    return () => {
      observer.disconnect();
    };
  }, []);
  const rowPx = ROW_REM * layout.rem;
  const virtualizer = useWindowVirtualizer({
    count: shown.length,
    estimateSize: () => rowPx + GAP_REM * layout.rem,
    overscan: 8,
    scrollMargin: layout.top,
  });

  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="m-0 text-body font-semibold">
        {t('decks.notes')}
      </h2>
      {notes.length === 0 ? (
        <p className="m-0 text-caption text-muted">{t('decks.noNotes')}</p>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-caption text-muted">{t('decks.search')}</span>
            <input
              type="search"
              className={`${field} min-h-11`}
              value={query}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </label>
          {query.trim() === '' ? null : (
            <p role="status" className="m-0 text-caption text-muted">
              {shown.length === 0
                ? t('decks.noMatches')
                : t('decks.matches', { count: shown.length, total: notes.length })}
            </p>
          )}
          <ul
            ref={measure}
            className="relative m-0 list-none p-0"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const note = shown[row.index];
              if (!note) return null;
              const caption = [t(`notes.kind.${note.kind}`), note.topicName].filter(Boolean).join(' · ');
              return (
                <li
                  key={note.id}
                  aria-setsize={shown.length}
                  aria-posinset={row.index + 1}
                  className="absolute inset-x-0 top-0"
                  style={{ height: rowPx, transform: `translateY(${String(row.start - layout.top)}px)` }}
                >
                  <Link
                    className={`flex h-full min-w-0 flex-col justify-center rounded-(--radius-card) bg-surface px-4 ${focus}`}
                    to={`/notes/${note.id}?mazo=${deckId}`}
                  >
                    <span className="truncate">{note.label}</span>
                    <span className="truncate text-caption text-muted">{caption}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
