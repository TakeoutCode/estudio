import {
  clozeNumbers,
  type Deck,
  EXPLANATION_MAX_LENGTH,
  isExerciseKind,
  noteImageAssetId,
  type ImageMime,
  MNEMONIC_MAX_LENGTH,
  newId,
  type Note,
  NoteContentSchema,
  type OcclusionGroup,
  TOPIC_EXPLANATION_MAX_LENGTH,
} from '@estudio/shared';
import {
  type ChangeEvent,
  type RefObject,
  type SubmitEvent,
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  emptyExerciseDraft,
  type EditableExerciseKind,
  EXERCISE_KINDS,
  exerciseContent,
  type ExerciseDraft,
  exerciseDraftOf,
  ExerciseFields,
  isDraftExerciseKind,
  isEditableExerciseKind,
} from '@/features/exercises';
import { checkImageFile, isImageMime, readImageSize } from '@/lib/media';
import { useOnline } from '@/lib/use-online';
import {
  createNote,
  type DeckChoice,
  deleteNote,
  type TagChoice,
  type TopicChoice,
  updateNote,
} from './commands';
import { type EditorPicture, OcclusionEditor } from './OcclusionEditor';
import { useDecks, useMnemonicOffer, useNote, useTags, useTopics } from './queries';
import { TagsField } from './TagsField';
import { Loading } from '@/ui/Loading';

const NEW_DECK = 'new';
const NO_TOPIC = '';
const NEW_TOPIC = 'new';

// LD14: los distractores con IA se cargan aparte, como la retroalimentación en el estudio.
const AiDistractors = lazy(async () => ({ default: (await import('@/features/ai-drafts')).AiDistractors }));

/** LD §1: los tipos de tarjeta que se crean aquí; los ejercicios (LD §2), con `?tipo=ejercicio`. */
const KINDS = ['basic', 'cloze', 'type_answer', 'multiple_choice', 'image_occlusion'] as const;
type CardKind = (typeof KINDS)[number];
type Kind = CardKind | EditableExerciseKind;
type Mode = 'card' | 'exercise';

const isEditableKind = (kind: string | undefined): kind is Kind =>
  kind !== undefined && ((KINDS as readonly string[]).includes(kind) || isEditableExerciseKind(kind));
const MIN_OPTIONS = 3;
const MAX_OPTIONS = 5;

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `w-full rounded-(--radius-card) border-2 border-line-strong bg-bg px-4 py-2 text-text ${focus}`;
// UX2: el campo de texto queda visible con el teclado abierto, así que guardar va al final del
// formulario y no en una barra fija (en iOS quedaría bajo el teclado).
const primary = `min-h-14 w-full rounded-(--radius-card) bg-primary px-4 font-bold text-primary-contrast candy disabled:opacity-60 ${focus}`;
const choiceButton = `min-h-12 rounded-(--radius-card) border-2 px-3 text-text ${focus}`;
const textLink = `-ml-2 inline-flex min-h-11 items-center self-start px-2 text-primary ${focus}`;

/**
 * Crear o editar una nota (LEARNING-DESIGN §1) o un ejercicio (§2), que también es una nota. La
 * ruta de estudio no carga esto (FE9). `?mazo=<id>`: viene de ese mazo; lo preselecciona y
 * "Volver" regresa a él. `?tipo=ejercicio`: una nota nueva de los tipos de §2.
 */
export function NoteEditorScreen() {
  const { noteId } = useParams();
  const [params] = useSearchParams();
  const decks = useDecks();
  const note = useNote(noteId);
  if (decks === undefined || note === undefined) return <Loading />;
  const fromDeck = decks.find((deck) => deck.id === params.get('mazo'))?.id ?? null;
  const editorMode: Mode = note
    ? isExerciseKind(note.content.kind)
      ? 'exercise'
      : 'card'
    : params.get('tipo') === 'ejercicio'
      ? 'exercise'
      : 'card';
  // `key`: al pasar de una nota a otra, el formulario arranca de cero.
  return (
    <NoteForm
      key={`${note?.id ?? 'new'}:${editorMode}`}
      decks={decks}
      note={note}
      fromDeck={fromDeck}
      editorMode={editorMode}
    />
  );
}

type Status = 'idle' | 'saved' | 'updated' | 'invalid' | 'deckMissing' | 'topicMissing' | 'failed';

/** La imagen que ella acaba de elegir para una oclusión: se guarda con la nota (FE8). */
interface PickedImage {
  readonly assetId: string;
  readonly file: File;
  readonly mime: ImageMime;
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

function NoteForm({
  decks,
  note,
  fromDeck,
  editorMode,
}: {
  readonly decks: readonly Deck[];
  readonly note: Note | null;
  readonly fromDeck: string | null;
  readonly editorMode: Mode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ids = useId();
  const firstRef = useRef<HTMLTextAreaElement>(null);
  const initial = note?.content;
  const returnTo = fromDeck ? { to: `/decks/${fromDeck}`, label: t('notes.backToDeck') } : null;
  const kinds: readonly Kind[] = editorMode === 'exercise' ? EXERCISE_KINDS : KINDS;
  const initialKind = initial?.kind;
  const [kind, setKind] = useState<Kind>(isEditableKind(initialKind) ? initialKind : (kinds[0] ?? 'basic'));
  const [exerciseDraft, setExerciseDraft] = useState<ExerciseDraft>(() => exerciseDraftOf(initial));
  const [deckId, setDeckId] = useState(note?.deckId ?? fromDeck ?? decks[0]?.id ?? NEW_DECK);
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
  // R10: oclusión y etiquetar una imagen comparten imagen, texto, descripción y recuadros.
  const occlusion =
    initial?.kind === 'image_occlusion'
      ? initial
      : initial?.kind === 'label_image'
        ? { ...initial, mode: 'hide_all' as const, groups: initial.labels }
        : null;
  const [prompt, setPrompt] = useState(occlusion?.prompt ?? '');
  const [alt, setAlt] = useState(occlusion?.alt ?? '');
  const [mode, setMode] = useState(occlusion?.mode ?? 'hide_all');
  const [groups, setGroups] = useState<OcclusionGroup[]>(occlusion ? [...occlusion.groups] : []);
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [explanation, setExplanation] = useState(initial?.explanation ?? '');
  // R14: solo al editar, después del primer acierto (useMnemonicOffer).
  const [mnemonic, setMnemonic] = useState(note?.mnemonic ?? '');
  const mnemonicOffer = useMnemonicOffer(note);
  // LD5, P4: el tema es opcional y pertenece al mazo.
  const [topicId, setTopicId] = useState(note?.topicId ?? NO_TOPIC);
  const [topicName, setTopicName] = useState('');
  const [topicExplanation, setTopicExplanation] = useState('');
  const topics = useTopics(deckId === NEW_DECK ? null : deckId);
  const tags = useTags();
  const [tagChoices, setTagChoices] = useState<TagChoice[]>(() => (note?.tagIds ?? []).map((id) => ({ id })));
  const moving = note !== null && deckId !== note.deckId;
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
      case 'image_occlusion':
        return {
          kind,
          imageAssetId: occlusion?.imageAssetId ?? picked?.assetId ?? '',
          prompt,
          alt,
          mode,
          groups,
          explanation,
        };
      case 'label_image':
        return {
          kind,
          imageAssetId: occlusion?.imageAssetId ?? picked?.assetId ?? '',
          prompt,
          alt,
          labels: groups,
          explanation,
        };
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
      case 'true_false_justify':
      case 'open_question':
      case 'sequence':
      case 'matching':
      case 'clinical_case':
        return exerciseContent(kind, exerciseDraft, explanation);
    }
  };

  const clearFields = () => {
    setFront('');
    setBack('');
    setClozeText('');
    setQuestion('');
    setOptions(Array.from({ length: MIN_OPTIONS }, () => ''));
    setCorrect(null);
    setPrompt('');
    setAlt('');
    setGroups([]);
    setPicked(null);
    setExerciseDraft(emptyExerciseDraft());
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
        const updated = await updateNote(note.id, {
          content: content.data,
          topic,
          deck: moving ? deck : undefined,
          tags: tagChoices,
          mnemonic: mnemonicOffer?.ready ? mnemonic.trim() || null : undefined,
        });
        setDeckId(updated.deckId);
        setTopicId(updated.topicId ?? NO_TOPIC);
        setTagChoices(updated.tagIds.map((id) => ({ id })));
        setTopicName('');
        setTopicExplanation('');
        setStatus('updated');
      } else {
        // Los bytes se leen antes de la transacción: dentro de ella, esperar al archivo la cerraría.
        const image =
          noteImageAssetId(content.data) !== null && picked
            ? {
                assetId: picked.assetId,
                data: await picked.file.arrayBuffer(),
                mime: picked.mime,
                width: picked.width,
                height: picked.height,
              }
            : undefined;
        const created = await createNote({ deck, content: content.data, topic, tags: tagChoices, image });
        // La siguiente nota va al mismo mazo, tema, tipo y etiquetas; el texto se limpia para escribirla.
        setDeckId(created.deckId);
        setTopicId(created.topicId ?? NO_TOPIC);
        setTagChoices(created.tagIds.map((id) => ({ id })));
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
    image_occlusion: t('notes.error.occlusion'),
    label_image: t('exercises.error.label_image'),
    true_false_justify: t('exercises.error.true_false_justify'),
    open_question: t('exercises.error.open_question'),
    sequence: t('exercises.error.sequence'),
    matching: t('exercises.error.matching'),
    clinical_case: t('exercises.error.clinical_case'),
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
        <Link className={textLink} to={returnTo?.to ?? '/'}>
          {returnTo?.label ?? t('notes.backToToday')}
        </Link>
        <h1 className="m-0 text-title font-extrabold">
          {editorMode === 'exercise'
            ? t(note ? 'exercises.edit' : 'exercises.new')
            : t(note ? 'notes.edit' : 'notes.new')}
        </h1>
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
              {kinds.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={kind === value}
                  className={`${choiceButton} ${kind === value ? 'border-primary bg-primary/20' : 'border-line-strong'}`}
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
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1">
            <span>{t('notes.deck')}</span>
            <select
              className={field + ' min-h-11'}
              value={deckId}
              aria-describedby={moving ? `${ids}-move-hint` : undefined}
              onChange={(event) => {
                setDeckId(event.target.value);
                setTopicId(NO_TOPIC); // los temas son de cada mazo
                setStatus('idle');
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
          {moving ? (
            <span id={`${ids}-move-hint`} className="text-caption text-muted">
              {t('notes.moveHint')}
            </span>
          ) : null}
        </div>
        {deckId === NEW_DECK ? (
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
        {kind === 'image_occlusion' || kind === 'label_image' ? (
          <>
            <ImageField
              picked={picked}
              locked={occlusion !== null}
              onPick={(image) => {
                setPicked(image);
                setGroups([]); // otra imagen: los recuadros anteriores ya no corresponden
                setStatus('idle');
              }}
            />
            <label className="flex flex-col gap-1">
              <span>{t('notes.occlusion.prompt')}</span>
              <textarea
                ref={firstRef}
                className={field}
                rows={2}
                maxLength={500}
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                }}
              />
            </label>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-alt`}>{t('notes.occlusion.alt')}</label>
              <textarea
                id={`${ids}-alt`}
                className={field}
                rows={2}
                maxLength={300}
                aria-describedby={`${ids}-alt-hint`}
                value={alt}
                onChange={(event) => {
                  setAlt(event.target.value);
                }}
              />
              <span id={`${ids}-alt-hint`} className="text-caption text-muted">
                {t('notes.occlusion.altHint')}
              </span>
            </div>
            {occlusion || picked ? (
              <OcclusionEditor
                picture={editorPicture(occlusion?.imageAssetId ?? null, alt, picked)}
                groups={groups}
                onGroups={setGroups}
              />
            ) : null}
            {kind === 'image_occlusion' ? (
              <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
                <legend className="mb-1">{t('notes.occlusion.mode')}</legend>
                {(['hide_all', 'hide_one'] as const).map((value) => (
                  <label key={value} className="flex min-h-11 items-center gap-3">
                    <input
                      type="radio"
                      name={`${ids}-mode`}
                      className="size-5 shrink-0 accent-primary"
                      checked={mode === value}
                      onChange={() => {
                        setMode(value);
                      }}
                    />
                    <span>{t(`notes.occlusion.${value}`)}</span>
                  </label>
                ))}
              </fieldset>
            ) : (
              // LD §2: al estudiar se tapan todas y ella escribe el nombre de cada número.
              <p className="m-0 text-caption text-muted">{t('exercises.labelImage.hint')}</p>
            )}
          </>
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
            {deckId === NEW_DECK ? null : (
              <Suspense fallback={null}>
                <AiDistractors
                  deckId={deckId}
                  question={question}
                  options={options}
                  correct={correct}
                  onOptions={setOptions}
                />
              </Suspense>
            )}
          </>
        ) : null}
        {isDraftExerciseKind(kind) ? (
          <ExerciseFields
            kind={kind}
            draft={exerciseDraft}
            firstRef={firstRef}
            aiDeckId={deckId === NEW_DECK ? null : deckId}
            onDraft={(next) => {
              setExerciseDraft(next);
              setStatus('idle');
            }}
          />
        ) : null}

        {mnemonicOffer?.reformulate ? (
          <p className="m-0 rounded-(--radius-card) bg-blush px-4 py-3 text-caption">
            {t('mnemonic.reformulate')}
          </p>
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
        {mnemonicOffer?.ready ? (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-mnemonic`}>{t('mnemonic.label')}</label>
            <textarea
              id={`${ids}-mnemonic`}
              className={field}
              rows={2}
              maxLength={MNEMONIC_MAX_LENGTH}
              aria-describedby={`${ids}-mnemonic-hint`}
              value={mnemonic}
              onChange={(event) => {
                setMnemonic(event.target.value);
              }}
            />
            <span id={`${ids}-mnemonic-hint`} className="text-caption text-muted">
              {t('mnemonic.hint')}
            </span>
          </div>
        ) : null}
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
        {tags ? (
          <TagsField
            tags={tags}
            chosen={tagChoices}
            onChange={(next) => {
              setTagChoices(next);
              setStatus('idle');
            }}
          />
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
        <DeleteNote onDelete={() => deleteNote(note.id).then(() => navigate(returnTo?.to ?? '/'))} />
      ) : null}
    </>
  );
}

/** La imagen ya guardada de la nota o, en una nueva, la que ella acaba de elegir. */
function editorPicture(assetId: string | null, alt: string, picked: PickedImage | null): EditorPicture {
  if (assetId) return { kind: 'asset', assetId, alt };
  return { kind: 'file', url: picked?.url ?? '', width: picked?.width ?? 1, height: picked?.height ?? 1 };
}

/**
 * R10, LD1: la imagen de una oclusión, propia de ella (sin imágenes de stock ni plantillas). Se
 * revisa formato y tamaño aquí (FE §5) y se guarda con la nota; sin red se sube después (FE7).
 * Al editar no se cambia: los recuadros y el historial son de esa imagen.
 */
function ImageField({
  picked,
  locked,
  onPick,
}: {
  readonly picked: PickedImage | null;
  readonly locked: boolean;
  readonly onPick: (image: PickedImage) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const online = useOnline();
  const [problem, setProblem] = useState<'type' | 'size' | 'read' | null>(null);
  const url = picked?.url ?? null;
  // La vista previa es una URL `blob:`: se libera al cambiar de imagen o salir.
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  if (locked) return <p className="m-0 text-caption text-muted">{t('notes.occlusion.imageLocked')}</p>;

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = ''; // elegir la misma de nuevo vuelve a revisarla
    if (!file) return;
    const check = checkImageFile(file);
    if (check || !isImageMime(file.type)) {
      setProblem(check ?? 'type');
      return;
    }
    try {
      const size = await readImageSize(file);
      setProblem(null);
      onPick({ assetId: newId(), file, mime: file.type, url: URL.createObjectURL(file), ...size });
    } catch {
      setProblem('read'); // p. ej. HEIC en un navegador que no lo abre
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <span>{t('notes.occlusion.image')}</span>
      <label
        htmlFor={id}
        className={`${choiceButton} inline-flex cursor-pointer items-center self-start border-line-strong focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary`}
      >
        {t(picked ? 'notes.occlusion.pickAnother' : 'notes.occlusion.pick')}
      </label>
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/heic"
        className="sr-only"
        aria-describedby={`${id}-hint`}
        onChange={(event) => {
          void choose(event);
        }}
      />
      <span id={`${id}-hint`} className="text-caption text-muted">
        {t('notes.occlusion.pickHint')}
      </span>
      {problem ? (
        <p role="alert" className="m-0 text-caption">
          {t(`notes.occlusion.problem.${problem}`)}
        </p>
      ) : null}
      {picked && !online ? (
        <p role="status" className="m-0 text-caption text-muted">
          {t('notes.occlusion.offline')}
        </p>
      ) : null}
    </div>
  );
}

/** Borrar pide confirmación: desde la lista de un mazo es fácil tocarlo sin querer. */
function DeleteNote({ onDelete }: { readonly onDelete: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        className={`min-h-11 w-full rounded-(--radius-card) px-4 text-danger ${focus}`}
        onClick={() => {
          setConfirming(true);
        }}
      >
        {t('notes.delete')}
      </button>
    );
  }
  return (
    <div role="alertdialog" aria-labelledby={`${id}-confirm`} className="flex flex-col gap-2">
      <p id={`${id}-confirm`} className="m-0">
        {t('notes.deleteConfirm')}
      </p>
      {failed ? (
        <p role="alert" className="m-0 text-caption">
          {t('error.generic')}
        </p>
      ) : null}
      <button
        type="button"
        className={`min-h-11 w-full rounded-(--radius-card) border-2 border-danger px-4 font-bold text-danger disabled:opacity-60 ${focus}`}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailed(false);
          onDelete().catch(() => {
            setFailed(true);
            setBusy(false);
          });
        }}
      >
        {t('notes.deleteYes')}
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
        className={`${choiceButton} self-start border-line-strong`}
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
