import {
  BasicContentSchema,
  type Deck,
  EXPLANATION_MAX_LENGTH,
  type Note,
  TOPIC_EXPLANATION_MAX_LENGTH,
} from '@estudio/shared';
import { type SubmitEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { createNote, type DeckChoice, deleteNote, type TopicChoice, updateNote } from './commands';
import { useDecks, useNote, useTopics } from './queries';

const NEW_DECK = 'new';
const NO_TOPIC = '';
const NEW_TOPIC = 'new';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `w-full rounded-(--radius-card) border border-muted/40 bg-bg px-4 py-2 text-text ${focus}`;
// UX2: el campo de texto queda visible con el teclado abierto, así que guardar va al final del
// formulario y no en una barra fija (en iOS quedaría bajo el teclado).
const primary = `min-h-14 w-full rounded-(--radius-card) bg-primary px-4 font-medium text-primary-contrast disabled:opacity-60 ${focus}`;

/** Crear o editar una nota básica (LEARNING-DESIGN §1). La ruta de estudio no carga esto (FE9). */
export function NoteEditorScreen() {
  const { noteId } = useParams();
  const decks = useDecks();
  const note = useNote(noteId);
  if (decks === undefined || note === undefined) return null;
  // `key`: al pasar de una nota a otra, el formulario arranca de cero.
  return <NoteForm key={note?.id ?? 'new'} decks={decks} note={note} />;
}

type Status = 'idle' | 'saved' | 'updated' | 'invalid' | 'deckMissing' | 'topicMissing' | 'failed';

function NoteForm({ decks, note }: { readonly decks: readonly Deck[]; readonly note: Note | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ids = useId();
  const frontRef = useRef<HTMLTextAreaElement>(null);
  const [deckId, setDeckId] = useState(note?.deckId ?? decks[0]?.id ?? NEW_DECK);
  const [deckName, setDeckName] = useState('');
  const [front, setFront] = useState(note?.content.front ?? '');
  const [back, setBack] = useState(note?.content.back ?? '');
  const [explanation, setExplanation] = useState(note?.content.explanation ?? '');
  const [reverse, setReverse] = useState(note?.content.reverse ?? false);
  // LD5, P4: el tema es opcional y pertenece al mazo.
  const [topicId, setTopicId] = useState(note?.topicId ?? NO_TOPIC);
  const [topicName, setTopicName] = useState('');
  const [topicExplanation, setTopicExplanation] = useState('');
  const topics = useTopics(note?.deckId ?? (deckId === NEW_DECK ? null : deckId));
  const [status, setStatus] = useState<Status>('idle');
  const [busy, setBusy] = useState(false);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = BasicContentSchema.safeParse({ kind: 'basic', front, back, explanation, reverse });
    if (!content.success) {
      setStatus('invalid');
      return;
    }
    const deck: DeckChoice = deckId === NEW_DECK ? { name: deckName.trim() } : { id: deckId };
    if ('name' in deck && deck.name === '') {
      setStatus('deckMissing');
      return;
    }
    const topic: TopicChoice =
      topicId === NO_TOPIC
        ? null
        : topicId === NEW_TOPIC
          ? { name: topicName.trim(), explanation: topicExplanation }
          : { id: topicId };
    if (topic && 'name' in topic && topic.name === '') {
      setStatus('topicMissing');
      return;
    }
    setBusy(true);
    try {
      if (note) {
        const updated = await updateNote(note.id, { content: content.data, topic });
        setTopicId(updated.topicId ?? NO_TOPIC);
        setStatus('updated');
      } else {
        const created = await createNote({ deck, content: content.data, topic });
        // La siguiente nota va al mismo mazo y tema; el texto se limpia para escribirla.
        setDeckId(created.deckId);
        setTopicId(created.topicId ?? NO_TOPIC);
        setTopicName('');
        setTopicExplanation('');
        setFront('');
        setBack('');
        setExplanation('');
        setStatus('saved');
        frontRef.current?.focus();
      }
    } catch {
      setStatus('failed');
    } finally {
      setBusy(false);
    }
  };

  const message = {
    idle: null,
    saved: t('notes.saved'),
    updated: t('notes.updated'),
    invalid: t('notes.error.required'),
    deckMissing: t('notes.error.deck'),
    topicMissing: t('notes.error.topic'),
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
        <h1 className="m-0 text-title font-semibold">{t(note ? 'notes.edit' : 'notes.new')}</h1>
      </header>
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
        {note ? null : (
          <label className="flex flex-col gap-1">
            <span>{t('notes.deck')}</span>
            <select
              className={field + ' min-h-11'}
              value={deckId}
              onChange={(event) => {
                setDeckId(event.target.value);
                setTopicId(NO_TOPIC); // los temas son de cada mazo
              }}
            >
              {decks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.name}
                </option>
              ))}
              <option value={NEW_DECK}>{t('notes.newDeckOption')}</option>
            </select>
          </label>
        )}
        {!note && deckId === NEW_DECK ? (
          <label className="flex flex-col gap-1">
            <span>{t('notes.deckName')}</span>
            <input
              className={field + ' min-h-11'}
              value={deckName}
              maxLength={120}
              onChange={(event) => {
                setDeckName(event.target.value);
              }}
            />
          </label>
        ) : null}
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1">
            <span>{t('notes.topic')}</span>
            <select
              className={field + ' min-h-11'}
              value={topicId}
              onChange={(event) => {
                setTopicId(event.target.value);
              }}
            >
              <option value={NO_TOPIC}>{t('notes.noTopic')}</option>
              {(topics ?? []).map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.name}
                </option>
              ))}
              <option value={NEW_TOPIC}>{t('notes.newTopicOption')}</option>
            </select>
          </label>
          {topicId !== NO_TOPIC && topicId !== NEW_TOPIC ? (
            <Link
              className={`-ml-2 inline-flex min-h-11 items-center self-start px-2 text-primary ${focus}`}
              to={`/topics/${topicId}`}
            >
              {t('notes.editTopic')}
            </Link>
          ) : null}
        </div>
        {topicId === NEW_TOPIC ? (
          <>
            <label className="flex flex-col gap-1">
              <span>{t('notes.topicName')}</span>
              <input
                className={field + ' min-h-11'}
                value={topicName}
                maxLength={120}
                onChange={(event) => {
                  setTopicName(event.target.value);
                }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span>{t('notes.topicExplanation')}</span>
              <textarea
                className={field}
                rows={3}
                maxLength={TOPIC_EXPLANATION_MAX_LENGTH}
                aria-describedby={`${ids}-topic-hint`}
                value={topicExplanation}
                onChange={(event) => {
                  setTopicExplanation(event.target.value);
                }}
              />
              <span id={`${ids}-topic-hint`} className="text-caption text-muted">
                {t('notes.topicExplanationHint')}
              </span>
            </label>
          </>
        ) : null}
        <label className="flex flex-col gap-1">
          <span>{t('notes.front')}</span>
          <textarea
            ref={frontRef}
            className={field}
            rows={3}
            value={front}
            onChange={(event) => {
              setFront(event.target.value);
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t('notes.back')}</span>
          <textarea
            className={field}
            rows={3}
            value={back}
            onChange={(event) => {
              setBack(event.target.value);
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t('notes.explanation')}</span>
          <textarea
            className={field}
            rows={2}
            maxLength={EXPLANATION_MAX_LENGTH}
            aria-describedby={`${ids}-count`}
            value={explanation}
            onChange={(event) => {
              setExplanation(event.target.value);
            }}
          />
          <span id={`${ids}-count`} className="text-caption text-muted">
            {t('notes.explanationCount', { count: explanation.length, max: EXPLANATION_MAX_LENGTH })}
          </span>
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="size-5 shrink-0"
            checked={reverse}
            onChange={(event) => {
              setReverse(event.target.checked);
            }}
          />
          <span>{t('notes.reverse')}</span>
        </label>
        {message ? (
          <p role="status" className="m-0 text-caption">
            {message}
          </p>
        ) : null}
        <button type="submit" className={primary} disabled={busy}>
          {t('notes.save')}
        </button>
      </form>
      {note ? (
        <button
          type="button"
          className={`min-h-11 w-full rounded-(--radius-card) px-4 text-danger ${focus}`}
          onClick={() => {
            void deleteNote(note.id).then(() => navigate('/'));
          }}
        >
          {t('notes.delete')}
        </button>
      ) : null}
    </>
  );
}
