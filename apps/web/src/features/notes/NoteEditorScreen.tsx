import {
  clozeNumbers,
  type Deck,
  EXPLANATION_MAX_LENGTH,
  type Note,
  NoteContentSchema,
  TOPIC_EXPLANATION_MAX_LENGTH,
} from '@estudio/shared';
import { type RefObject, type SubmitEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { createNote, type DeckChoice, deleteNote, type TopicChoice, updateNote } from './commands';
import { useDecks, useNote, useTopics } from './queries';

const NEW_DECK = 'new';
const NO_TOPIC = '';
const NEW_TOPIC = 'new';

/** LD §1: los tipos que se crean aquí (la oclusión de imagen necesita subir media). */
const KINDS = ['basic', 'cloze', 'type_answer', 'multiple_choice'] as const;
type Kind = (typeof KINDS)[number];
const MIN_OPTIONS = 3;
const MAX_OPTIONS = 5;

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `w-full rounded-(--radius-card) border border-muted/40 bg-bg px-4 py-2 text-text ${focus}`;
// UX2: el campo de texto queda visible con el teclado abierto, así que guardar va al final del
// formulario y no en una barra fija (en iOS quedaría bajo el teclado).
const primary = `min-h-14 w-full rounded-(--radius-card) bg-primary px-4 font-medium text-primary-contrast disabled:opacity-60 ${focus}`;
const choiceButton = `min-h-12 rounded-(--radius-card) border px-3 text-text ${focus}`;
const textLink = `-ml-2 inline-flex min-h-11 items-center self-start px-2 text-primary ${focus}`;

/** Crear o editar una nota (LEARNING-DESIGN §1). La ruta de estudio no carga esto (FE9). */
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
  const firstRef = useRef<HTMLTextAreaElement>(null);
  const initial = note?.content;
  const [kind, setKind] = useState<Kind>(initial?.kind ?? 'basic');
  const [deckId, setDeckId] = useState(note?.deckId ?? decks[0]?.id ?? NEW_DECK);
  const [deckName, setDeckName] = useState('');
  const [front, setFront] = useState(initial && 'front' in initial ? initial.front : '');
  const [back, setBack] = useState(initial && 'back' in initial ? initial.back : '');
  const [reverse, setReverse] = useState(initial?.kind === 'basic' ? initial.reverse : false);
  const [clozeText, setClozeText] = useState(initial?.kind === 'cloze' ? initial.text : '');
  const [question, setQuestion] = useState(initial?.kind === 'multiple_choice' ? initial.question : '');
  const [options, setOptions] = useState<string[]>(
    initial?.kind === 'multiple_choice'
      ? [...initial.options]
      : Array.from({ length: MIN_OPTIONS }, () => ''),
  );
  const [correct, setCorrect] = useState<number | null>(
    initial?.kind === 'multiple_choice' ? initial.correct : null,
  );
  const [explanation, setExplanation] = useState(initial?.explanation ?? '');
  // LD5, P4: el tema es opcional y pertenece al mazo.
  const [topicId, setTopicId] = useState(note?.topicId ?? NO_TOPIC);
  const [topicName, setTopicName] = useState('');
  const [topicExplanation, setTopicExplanation] = useState('');
  const topics = useTopics(note?.deckId ?? (deckId === NEW_DECK ? null : deckId));
  const [status, setStatus] = useState<Status>('idle');
  const [busy, setBusy] = useState(false);

  const buildContent = (): unknown => {
    switch (kind) {
      case 'basic':
        return { kind, front, back, explanation, reverse };
      case 'cloze':
        return { kind, text: clozeText, explanation };
      case 'type_answer':
        return { kind, front, back, explanation };
      case 'multiple_choice': {
        // Las opciones vacías no cuentan; la correcta conserva su lugar entre las que quedan.
        const kept = options.map((text, i) => ({ text: text.trim(), i })).filter((o) => o.text !== '');
        return {
          kind,
          question,
          options: kept.map((o) => o.text),
          correct: kept.findIndex((o) => o.i === correct),
          explanation,
        };
      }
    }
  };

  const clearFields = () => {
    setFront('');
    setBack('');
    setClozeText('');
    setQuestion('');
    setOptions(Array.from({ length: MIN_OPTIONS }, () => ''));
    setCorrect(null);
    setExplanation('');
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = NoteContentSchema.safeParse(buildContent());
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
        // La siguiente nota va al mismo mazo, tema y tipo; el texto se limpia para escribirla.
        setDeckId(created.deckId);
        setTopicId(created.topicId ?? NO_TOPIC);
        setTopicName('');
        setTopicExplanation('');
        clearFields();
        setStatus('saved');
        firstRef.current?.focus();
      }
    } catch {
      setStatus('failed');
    } finally {
      setBusy(false);
    }
  };

  const invalidMessage = {
    basic: t('notes.error.required'),
    type_answer: t('notes.error.required'),
    cloze: t('notes.error.cloze'),
    multiple_choice: t('notes.error.choice'),
  }[kind];
  const message = {
    idle: null,
    saved: t('notes.saved'),
    updated: t('notes.updated'),
    invalid: invalidMessage,
    deckMissing: t('notes.error.deck'),
    topicMissing: t('notes.error.topic'),
    failed: t('error.generic'),
  }[status];

  return (
    <>
      <header className="flex flex-col">
        <Link className={textLink} to="/">
          {t('notes.backToToday')}
        </Link>
        <h1 className="m-0 text-title font-semibold">{t(note ? 'notes.edit' : 'notes.new')}</h1>
      </header>
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
        {note ? (
          <p className="m-0 text-caption text-muted">
            {t('notes.kindLabel')}: {t(`notes.kind.${kind}`)}
          </p>
        ) : (
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1">{t('notes.kindLabel')}</legend>
            <div className="grid grid-cols-2 gap-2">
              {KINDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={kind === value}
                  className={`${choiceButton} ${kind === value ? 'border-primary bg-primary/20' : 'border-muted/40'}`}
                  onClick={() => {
                    setKind(value);
                    setStatus('idle');
                  }}
                >
                  {t(`notes.kind.${value}`)}
                </button>
              ))}
            </div>
            <p className="m-0 text-caption text-muted">{t(`notes.kindHint.${kind}`)}</p>
          </fieldset>
        )}
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
            <Link className={textLink} to={`/topics/${topicId}`}>
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

        {kind === 'basic' || kind === 'type_answer' ? (
          <>
            <label className="flex flex-col gap-1">
              <span>{t('notes.front')}</span>
              <textarea
                ref={firstRef}
                className={field}
                rows={3}
                value={front}
                onChange={(event) => {
                  setFront(event.target.value);
                }}
              />
            </label>
            {kind === 'basic' ? (
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
            ) : (
              <div className="flex flex-col gap-1">
                <label htmlFor={`${ids}-exact`}>{t('notes.exactAnswer')}</label>
                <input
                  id={`${ids}-exact`}
                  className={field + ' min-h-11'}
                  maxLength={200}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-describedby={`${ids}-exact-hint`}
                  value={back}
                  onChange={(event) => {
                    setBack(event.target.value);
                  }}
                />
                <span id={`${ids}-exact-hint`} className="text-caption text-muted">
                  {t('notes.exactAnswerHint')}
                </span>
              </div>
            )}
          </>
        ) : null}
        {kind === 'cloze' ? (
          <ClozeField ids={ids} value={clozeText} onChange={setClozeText} inputRef={firstRef} />
        ) : null}
        {kind === 'multiple_choice' ? (
          <>
            <label className="flex flex-col gap-1">
              <span>{t('notes.question')}</span>
              <textarea
                ref={firstRef}
                className={field}
                rows={3}
                value={question}
                onChange={(event) => {
                  setQuestion(event.target.value);
                }}
              />
            </label>
            <OptionsField options={options} correct={correct} onChange={setOptions} onCorrect={setCorrect} />
          </>
        ) : null}

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
        {kind === 'basic' ? (
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
        ) : null}
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

/**
 * `cloze`: el texto con sus huecos. "Ocultar lo seleccionado" envuelve la selección en el
 * siguiente `{{cN::…}}`, para no tener que escribir la sintaxis a mano en el teléfono.
 */
function ClozeField({
  ids,
  value,
  onChange,
  inputRef,
}: {
  readonly ids: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useTranslation();
  const count = clozeNumbers(value).length;
  const hideSelection = () => {
    const area = inputRef.current;
    if (!area) return;
    const { selectionStart: start, selectionEnd: end } = area;
    if (start === end) return;
    const next = Math.max(0, ...clozeNumbers(value)) + 1;
    onChange(`${value.slice(0, start)}{{c${String(next)}::${value.slice(start, end)}}}${value.slice(end)}`);
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${ids}-cloze`}>{t('notes.clozeText')}</label>
      <textarea
        id={`${ids}-cloze`}
        ref={inputRef}
        className={field}
        rows={5}
        maxLength={4000}
        aria-describedby={`${ids}-cloze-hint`}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      <span id={`${ids}-cloze-hint`} className="text-caption text-muted">
        {t('notes.clozeHint', { count, example: `{{c1::${t('notes.clozeExampleWord')}}}` })}
      </span>
      <button
        type="button"
        className={`${choiceButton} self-start border-muted/40`}
        // Evita que el textarea pierda la selección antes del clic.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={hideSelection}
      >
        {t('notes.clozeHide')}
      </button>
    </div>
  );
}

/** `multiple_choice`: 3 a 5 opciones; la correcta se marca con un radio (LD §1). */
function OptionsField({
  options,
  correct,
  onChange,
  onCorrect,
}: {
  readonly options: readonly string[];
  readonly correct: number | null;
  readonly onChange: (options: string[]) => void;
  readonly onCorrect: (index: number | null) => void;
}) {
  const { t } = useTranslation();
  const name = useId();
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1">{t('notes.options')}</legend>
      {options.map((option, i) => (
        <div key={i} className="flex items-center gap-2">
          <label className="flex min-h-11 shrink-0 items-center gap-2">
            <input
              type="radio"
              name={name}
              className="size-5 shrink-0 accent-primary"
              checked={correct === i}
              onChange={() => {
                onCorrect(i);
              }}
            />
            <span className="sr-only">{t('notes.correctOption', { n: i + 1 })}</span>
          </label>
          <input
            aria-label={t('notes.optionLabel', { n: i + 1 })}
            className={field + ' min-h-11'}
            maxLength={200}
            value={option}
            onChange={(event) => {
              onChange(options.map((o, j) => (j === i ? event.target.value : o)));
            }}
          />
          {options.length > MIN_OPTIONS ? (
            <button
              type="button"
              className={`min-h-11 min-w-11 shrink-0 text-primary ${focus}`}
              aria-label={t('notes.removeOption', { n: i + 1 })}
              onClick={() => {
                onChange(options.filter((_, j) => j !== i));
                if (correct === i) onCorrect(null);
                else if (correct !== null && correct > i) onCorrect(correct - 1);
              }}
            >
              ×
            </button>
          ) : null}
        </div>
      ))}
      <p className="m-0 text-caption text-muted">{t('notes.optionsHint')}</p>
      {options.length < MAX_OPTIONS ? (
        <button
          type="button"
          className={textLink}
          onClick={() => {
            onChange([...options, '']);
          }}
        >
          {t('notes.addOption')}
        </button>
      ) : null}
    </fieldset>
  );
}
