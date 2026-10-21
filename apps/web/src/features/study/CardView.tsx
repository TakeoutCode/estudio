import {
  type ClinicalQuestion,
  clinicalQuestion,
  clozeSegments,
  type Confidence,
  type LabelImageContent,
  numberedLabels,
  Rating,
} from '@estudio/shared';
import { isTypedAnswerCorrect, sequenceInversions, shuffledSequence, toRating } from '@estudio/srs';
import { type SubmitEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AiFeedbackPanel } from '@/features/ai-drafts';
import { moved, OrderList } from '@/features/exercises';
import { LabelFigure, OcclusionFigure } from '@/features/media';
import { RatingButton } from '@/ui/RatingButton';
import type { StudyCardView } from './queries';
import { type Attempt, type CardPhase, type ExerciseWork, useStudy } from './store';

// Cómo se ve y se intenta cada tipo de LEARNING-DESIGN §1. Antes del intento la respuesta no
// está en el DOM (R1, FE10); después, siempre con su explicación (R4).

const CONFIDENCES = [1, 2, 3] as const;
const SELF_RATINGS = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const;
/** LD2: con acierto en una objetiva se elige entre estas, con Good por defecto. */
const CORRECT_RATINGS = [Rating.Hard, Rating.Good, Rating.Easy] as const;
/** LD2: V/F acertado; la justificación suficiente es Good y la débil, Hard. */
const JUSTIFIED_RATINGS = [Rating.Hard, Rating.Good] as const;
const LETTERS = 'abcde';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const primary = `inline-flex min-h-14 w-full items-center justify-center rounded-(--radius-card) bg-primary px-4 font-medium text-primary-contrast disabled:opacity-60 ${focus}`;

/** R1: en estas el intento es recordar y "Mostrar" (o tocar la etiqueta oculta). */
export const revealsDirectly = (card: StudyCardView): boolean =>
  card.content.kind === 'basic' || card.content.kind === 'cloze' || card.content.kind === 'image_occlusion';

/** Las que ella califica eligiendo entre los 4 botones (LD2); la abierta, tras ver la clave. */
export const isSelfGraded = (card: StudyCardView): boolean =>
  revealsDirectly(card) || card.content.kind === 'open_question';

/**
 * La calificación por defecto de Enter tras revelar: Again si falló, Good si acertó. `null` en la
 * respuesta abierta, que ella califica.
 */
export const defaultObjectiveRating = (attempt: Attempt): Rating | null =>
  attempt.kind === 'written'
    ? null
    : attempt.kind === 'scored'
      ? attempt.rating
      : attempt.correct
        ? Rating.Good
        : Rating.Again;

/** R1: el orden en pantalla; mezclado con semilla hasta que ella mueve algo. */
export function sequenceOrder(
  card: StudyCardView,
  work: ExerciseWork | null,
  sessionId: string,
): readonly string[] {
  if (card.content.kind !== 'sequence') return [];
  return work?.kind === 'sequence'
    ? work.order
    : shuffledSequence(card.content.items, `${card.cardId}:${sessionId}`);
}

/** Relacionar: lo elegido para cada elemento de la columna A, en su orden (`null` sin elegir). */
export function matchingPicks(card: StudyCardView, work: ExerciseWork | null): readonly (string | null)[] {
  if (card.content.kind !== 'matching') return [];
  const pairs = card.content.pairs;
  return work?.kind === 'matching' && work.picks.length === pairs.length ? work.picks : pairs.map(() => null);
}

/** Caso clínico: la subpregunta de esta Card; `null` en otros tipos o si ya no existe. */
export function caseQuestion(card: StudyCardView): ClinicalQuestion | null {
  return card.content.kind === 'clinical_case'
    ? (clinicalQuestion(card.content, card.ordinal)?.question ?? null)
    : null;
}

/** Etiquetar: lo escrito para cada número (vacío si todavía no). */
export function labelAnswers(card: StudyCardView, work: ExerciseWork | null): readonly string[] {
  if (card.content.kind !== 'label_image') return [];
  const total = card.content.labels.length;
  return work?.kind === 'label_image' && work.answers.length === total
    ? work.answers
    : Array.from({ length: total }, () => '');
}

/** LD2: las calificaciones que se pueden elegir después del intento. */
export function allowedRatings(card: StudyCardView, attempt: Attempt | null): readonly Rating[] {
  // Con puntaje: lo que da `toRating`; con el puntaje completo también puede subir a Fácil.
  if (attempt?.kind === 'scored') {
    return attempt.rating === Rating.Good ? [Rating.Good, Rating.Easy] : [attempt.rating];
  }
  if (isSelfGraded(card) || !attempt || attempt.kind === 'written') return SELF_RATINGS;
  // V/F con justificación: acertar el V/F deja juzgar la justificación (Good o Hard).
  if (attempt.kind === 'verdict') return attempt.correct ? JUSTIFIED_RATINGS : [Rating.Again];
  return attempt.correct ? CORRECT_RATINGS : [Rating.Again];
}

/** El cuerpo de la tarjeta: pregunta y, tras el intento, respuesta y explicación. */
export function CardBody({
  card,
  phase,
  attempt,
  canChoose,
  onChoose,
  onRevealFromImage = null,
}: {
  readonly card: StudyCardView;
  readonly phase: CardPhase;
  readonly attempt: Attempt | null;
  /** Opción múltiple: elegir es el intento; con `askConfidence`, después de la confianza. */
  readonly canChoose: boolean;
  readonly onChoose: (option: number) => void;
  /** Oclusión: tocar la etiqueta oculta es como "Mostrar"; `null` si hace falta la confianza. */
  readonly onRevealFromImage?: (() => void) | null;
}) {
  const { t } = useTranslation();
  const revealed = phase === 'revealed';
  const { content } = card;
  return (
    <article className="flex flex-col gap-4 rounded-(--radius-card) bg-surface p-5">
      {content.kind === 'image_occlusion' ? (
        <>
          <p className="m-0 text-card whitespace-pre-wrap">{content.prompt}</p>
          <OcclusionFigure
            content={content}
            ordinal={card.ordinal}
            revealed={revealed}
            onReveal={revealed ? null : onRevealFromImage}
            eager
          />
        </>
      ) : content.kind === 'cloze' ? (
        <p className="m-0 text-card whitespace-pre-wrap">
          {clozeSegments(content.text, card.ordinal).map((segment, i) =>
            segment.kind === 'text' ? (
              <span key={i}>{segment.text}</span>
            ) : revealed ? (
              <mark key={i} className="bg-primary/20 px-1 font-semibold text-text">
                {segment.answer}
              </mark>
            ) : (
              <span key={i} className="border border-dashed border-muted px-1 text-muted">
                {segment.hint ?? '…'}
              </span>
            ),
          )}
        </p>
      ) : content.kind === 'clinical_case' ? (
        <CaseHeader card={card} />
      ) : (
        <p className="m-0 text-card whitespace-pre-wrap">
          {content.kind === 'multiple_choice' ? content.question : card.prompt}
        </p>
      )}
      {content.kind === 'multiple_choice' ? (
        <Options
          options={content.options}
          correct={revealed ? content.correct : null}
          chosen={attempt?.kind === 'choice' ? attempt.option : null}
          disabled={!canChoose || revealed}
          onChoose={onChoose}
        />
      ) : null}
      {caseQuestion(card)?.type === 'multiple_choice' ? (
        <CaseOptions
          card={card}
          attempt={attempt}
          revealed={revealed}
          disabled={!canChoose || revealed}
          onChoose={onChoose}
        />
      ) : null}
      {content.kind === 'sequence' && !revealed ? <SequenceBoard card={card} disabled={!canChoose} /> : null}
      {content.kind === 'matching' && !revealed ? <MatchingBoard card={card} disabled={!canChoose} /> : null}
      {content.kind === 'label_image' ? (
        <LabelBoard card={card} revealed={revealed} disabled={!canChoose} />
      ) : null}
      <div aria-live="polite">
        {revealed ? (
          <section className="flex flex-col gap-2 border-t border-muted/30 pt-4">
            {attempt?.kind === 'typed' ? <TypedResult attempt={attempt} answer={card.answer} /> : null}
            {attempt?.kind === 'choice' ? (
              <p className="m-0 font-semibold">
                {t(attempt.correct ? 'study.objective.right' : 'study.objective.wrongChoice')}
              </p>
            ) : null}
            {attempt?.kind === 'verdict' && content.kind === 'true_false_justify' ? (
              <>
                <p className="m-0 font-semibold">
                  {t(attempt.correct ? 'study.tfj.right' : 'study.tfj.wrong', {
                    value: t(content.isTrue ? 'study.tfj.isTrue' : 'study.tfj.isFalse'),
                  })}
                </p>
                <Labeled label={t('study.tfj.yours')} text={attempt.justification} />
                <Labeled label={t('study.tfj.reference')} text={content.justification} strong />
              </>
            ) : null}
            {attempt?.kind === 'written' && content.kind === 'clinical_case' ? (
              <>
                <Labeled label={t('study.open.yours')} text={attempt.text} />
                <Labeled label={t('study.open.key')} text={card.answer} strong />
              </>
            ) : null}
            {attempt?.kind === 'written' && content.kind === 'open_question' ? (
              <>
                <Labeled label={t('study.open.yours')} text={attempt.text} />
                <Labeled label={t('study.open.key')} text={content.key} strong />
              </>
            ) : null}
            {/* LD14: opcional; la calificación sigue siendo de ella. */}
            {attempt?.kind === 'written' ? (
              <AiFeedbackPanel
                cardId={card.cardId}
                question={card.prompt}
                answerKey={card.answer}
                answer={attempt.text}
              />
            ) : null}
            {attempt?.kind === 'scored' && content.kind === 'sequence' ? (
              <SequenceResult items={content.items} answer={attempt.answer} />
            ) : null}
            {attempt?.kind === 'scored' && content.kind === 'matching' ? (
              <MatchingResult pairs={content.pairs} answer={attempt.answer} />
            ) : null}
            {attempt?.kind === 'scored' && content.kind === 'label_image' ? (
              <LabelResult content={content} answer={attempt.answer} />
            ) : null}
            {content.kind === 'basic' || content.kind === 'image_occlusion' ? (
              <>
                <h2 className="m-0 text-caption font-normal text-muted">{t('study.answer')}</h2>
                <p className="m-0 text-card whitespace-pre-wrap">{card.answer}</p>
              </>
            ) : null}
            {content.explanation ? (
              <p className="m-0 whitespace-pre-wrap text-muted">{content.explanation}</p>
            ) : null}
            {card.mnemonic ? <Labeled label={t('mnemonic.shown')} text={card.mnemonic} /> : null}
          </section>
        ) : null}
      </div>
    </article>
  );
}

/** LD §2: ordenar antes de comprobar; lo armado vive en la sesión hasta pasar de tarjeta. */
function SequenceBoard({ card, disabled }: { readonly card: StudyCardView; readonly disabled: boolean }) {
  const { t } = useTranslation();
  const work = useStudy((s) => s.work);
  const sessionId = useStudy((s) => s.session?.id ?? '');
  const setWork = useStudy((s) => s.setWork);
  const order = sequenceOrder(card, work, sessionId);
  return (
    <section aria-label={t('study.sequence.board')} className="flex flex-col gap-2">
      <OrderList
        rows={order.map((item) => ({ key: item, label: item, content: <span>{item}</span> }))}
        disabled={disabled}
        onMove={(index, direction) => {
          setWork({ kind: 'sequence', order: moved(order, index, direction) });
        }}
      />
    </section>
  );
}

const select = `min-h-11 w-full min-w-0 rounded-(--radius-card) border border-muted/40 bg-bg px-3 text-body text-text disabled:opacity-60 ${focus}`;

/**
 * LD §2: cada elemento de la columna A con un selector de la B, mezclada con semilla (R1). Un
 * selector nativo sirve con el pulgar, con teclado y con lector de pantalla (UX2, UX4).
 */
function MatchingBoard({ card, disabled }: { readonly card: StudyCardView; readonly disabled: boolean }) {
  const { t } = useTranslation();
  const work = useStudy((s) => s.work);
  const sessionId = useStudy((s) => s.session?.id ?? '');
  const setWork = useStudy((s) => s.setWork);
  if (card.content.kind !== 'matching') return null;
  const { pairs } = card.content;
  const picks = matchingPicks(card, work);
  const options = shuffledSequence(
    pairs.map((p) => p.right),
    `${card.cardId}:${sessionId}`,
  );
  return (
    <ul aria-label={t('study.matching.board')} className="m-0 flex list-none flex-col gap-3 p-0">
      {pairs.map((pair, i) => (
        <li key={pair.left}>
          <label className="flex flex-col gap-1">
            <span className="font-medium">{pair.left}</span>
            <select
              className={select}
              value={picks[i] ?? ''}
              disabled={disabled}
              onChange={(event) => {
                const value = event.target.value === '' ? null : event.target.value;
                setWork({ kind: 'matching', picks: picks.map((p, j) => (j === i ? value : p)) });
              }}
            >
              <option value="">{t('study.matching.choose')}</option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </li>
      ))}
    </ul>
  );
}

/** "Comprobar" espera a que cada elemento tenga pareja: elegir todas es el intento (R1). */
function MatchingCheck({ card, onCheck }: { readonly card: StudyCardView; readonly onCheck: () => void }) {
  const { t } = useTranslation();
  const work = useStudy((s) => s.work);
  const picks = matchingPicks(card, work);
  const missing = picks.filter((p) => p === null).length;
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-center text-caption text-muted">
        {missing > 0 ? t('study.matching.missing', { count: missing }) : t('study.matching.ready')}
      </p>
      <button type="button" className={primary} disabled={missing > 0} onClick={onCheck}>
        {t('study.objective.check')}
      </button>
    </div>
  );
}

/** R4: cada pareja correcta, con lo que eligió ella cuando no coincide (texto, no solo color). */
function MatchingResult({
  pairs,
  answer,
}: {
  readonly pairs: readonly { readonly left: string; readonly right: string }[];
  readonly answer: Readonly<Record<string, unknown>>;
}) {
  const { t } = useTranslation();
  const picks = Array.isArray(answer.picks) ? answer.picks : [];
  const right = pairs.filter((pair, i) => picks[i] === pair.right).length;
  return (
    <>
      <p className="m-0 font-semibold">{t('study.matching.score', { right, total: pairs.length })}</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {pairs.map((pair, i) => {
          const pick: unknown = picks[i];
          return (
            <li key={pair.left} className="flex flex-col">
              <span>
                {pair.left} → <strong className="font-semibold">{pair.right}</strong>
              </span>
              <span className="text-caption text-muted">
                {pick === pair.right
                  ? t('study.matching.right')
                  : t('study.matching.youChose', { pick: typeof pick === 'string' ? pick : '' })}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** LD §2: el caso arriba, en texto de lectura, y debajo la subpregunta que toca ("2 de 3"). */
function CaseHeader({ card }: { readonly card: StudyCardView }) {
  const { t } = useTranslation();
  if (card.content.kind !== 'clinical_case') return null;
  const found = clinicalQuestion(card.content, card.ordinal);
  return (
    <>
      <section aria-label={t('study.case.vignette')} className="flex flex-col gap-1">
        <h2 className="m-0 text-caption font-normal text-muted">{t('study.case.vignette')}</h2>
        <p className="m-0 whitespace-pre-wrap">{card.content.vignette}</p>
      </section>
      {found ? (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-caption text-muted">
            {t('study.case.position', { position: found.position, total: found.total })}
          </p>
          <p className="m-0 text-card whitespace-pre-wrap">{found.question.question}</p>
        </div>
      ) : null}
    </>
  );
}

/** Opción múltiple dentro de un caso: igual que una tarjeta de opción múltiple (R1, UX4). */
function CaseOptions({
  card,
  attempt,
  revealed,
  disabled,
  onChoose,
}: {
  readonly card: StudyCardView;
  readonly attempt: Attempt | null;
  readonly revealed: boolean;
  readonly disabled: boolean;
  readonly onChoose: (option: number) => void;
}) {
  const sub = caseQuestion(card);
  if (sub?.type !== 'multiple_choice') return null;
  return (
    <Options
      options={sub.options}
      correct={revealed ? sub.correct : null}
      chosen={attempt?.kind === 'choice' ? attempt.option : null}
      disabled={disabled}
      onChoose={onChoose}
    />
  );
}

const labelInput = `min-h-11 w-full min-w-0 rounded-(--radius-card) border border-muted/40 bg-bg px-3 text-body text-text disabled:opacity-60 ${focus}`;

/**
 * LD §2 (`label_image`): la imagen tapada y un campo por número. Sin autocorrector: la
 * terminología anatómica choca con él (UX2).
 */
function LabelBoard({
  card,
  revealed,
  disabled,
}: {
  readonly card: StudyCardView;
  readonly revealed: boolean;
  readonly disabled: boolean;
}) {
  const { t } = useTranslation();
  const work = useStudy((s) => s.work);
  const setWork = useStudy((s) => s.setWork);
  if (card.content.kind !== 'label_image') return null;
  const answers = labelAnswers(card, work);
  return (
    <>
      <LabelFigure content={card.content} revealed={revealed} eager />
      {revealed ? null : (
        <ol aria-label={t('study.labels.board')} className="m-0 flex list-none flex-col gap-2 p-0">
          {answers.map((answer, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="w-6 shrink-0 text-right font-semibold tabular-nums" aria-hidden="true">
                {i + 1}
              </span>
              <input
                className={labelInput}
                value={answer}
                disabled={disabled}
                aria-label={t('study.labels.input', { n: i + 1 })}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="next"
                onChange={(event) => {
                  setWork({
                    kind: 'label_image',
                    answers: answers.map((a, j) => (j === i ? event.target.value : a)),
                  });
                }}
              />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** R4: cada número con su nombre y lo que escribió ella; siempre la ortografía correcta (LD2). */
function LabelResult({
  content,
  answer,
}: {
  readonly content: LabelImageContent;
  readonly answer: Readonly<Record<string, unknown>>;
}) {
  const { t } = useTranslation();
  const labels = numberedLabels(content);
  const written = Array.isArray(answer.answers) ? answer.answers : [];
  const text = (i: number): string => {
    const value: unknown = written[i];
    return typeof value === 'string' ? value : '';
  };
  const right = labels.filter((label, i) => isTypedAnswerCorrect(text(i), label.label)).length;
  return (
    <>
      <p className="m-0 font-semibold">{t('study.labels.score', { right, total: labels.length })}</p>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {labels.map((label, i) => (
          <li key={label.n} className="flex items-baseline gap-3">
            <span className="w-6 shrink-0 text-right font-semibold tabular-nums">{i + 1}</span>
            <span className="flex flex-col">
              <span className="text-card">{label.label}</span>
              <span className="text-caption text-muted">
                {isTypedAnswerCorrect(text(i), label.label)
                  ? t('study.labels.right')
                  : t('study.labels.youWrote', {
                      text: text(i).trim() === '' ? t('study.objective.empty') : text(i),
                    })}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

/** R4: el orden correcto, con dónde lo puso ella; el color nunca es la única señal (UX4). */
function SequenceResult({
  items,
  answer,
}: {
  readonly items: readonly string[];
  readonly answer: Readonly<Record<string, unknown>>;
}) {
  const { t } = useTranslation();
  const order = Array.isArray(answer.order)
    ? answer.order.filter((x): x is string => typeof x === 'string')
    : [];
  const inversions = order.length === items.length ? sequenceInversions(order, items) : 0;
  return (
    <>
      <p className="m-0 font-semibold">
        {inversions === 0 ? t('study.sequence.allRight') : t('study.sequence.swapped', { count: inversions })}
      </p>
      <h2 className="m-0 text-caption font-normal text-muted">{t('study.sequence.correct')}</h2>
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {items.map((item, i) => {
          const placed = order.indexOf(item);
          return (
            <li key={item} className="flex items-baseline gap-2">
              <span className="w-6 shrink-0 text-caption text-muted tabular-nums">{i + 1}.</span>
              <span className="flex-1">{item}</span>
              <span className="shrink-0 text-caption text-muted">
                {placed === i ? t('study.sequence.inPlace') : t('study.sequence.youPut', { n: placed + 1 })}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** Un texto de ella o de la clave, con su rótulo; tras el intento (R4). */
function Labeled({
  label,
  text,
  strong = false,
}: {
  readonly label: string;
  readonly text: string;
  readonly strong?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <h2 className="m-0 text-caption font-normal text-muted">{label}</h2>
      <p className={`m-0 whitespace-pre-wrap ${strong ? 'text-card' : ''}`}>{text}</p>
    </div>
  );
}

/** LD2: siempre se muestra la ortografía correcta, también si acertó. */
function TypedResult({
  attempt,
  answer,
}: {
  readonly attempt: Attempt & { kind: 'typed' };
  readonly answer: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <p className="m-0 font-semibold">
        {t(attempt.correct ? 'study.objective.right' : 'study.objective.wrong')}
      </p>
      <p className="m-0">
        <span className="text-caption text-muted">{t('study.objective.yours')} </span>
        {attempt.text === '' ? t('study.objective.empty') : attempt.text}
      </p>
      <p className="m-0 text-card">
        <span className="text-caption text-muted">{t('study.answer')}: </span>
        {answer}
      </p>
    </>
  );
}

/**
 * Opción múltiple: antes de elegir, ninguna marca dice cuál es la correcta (R1). Después, la
 * correcta y la elegida se señalan con texto, no solo con color (UX4).
 */
function Options({
  options,
  correct,
  chosen,
  disabled,
  onChoose,
}: {
  readonly options: readonly string[];
  readonly correct: number | null;
  readonly chosen: number | null;
  readonly disabled: boolean;
  readonly onChoose: (option: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {options.map((option, i) => {
        const isCorrect = correct === i;
        const isChosen = chosen === i;
        return (
          <li key={option}>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={isChosen}
              className={`flex min-h-12 w-full items-center gap-3 rounded-(--radius-card) border px-4 text-left text-text ${isCorrect ? 'border-primary bg-primary/20' : 'border-muted/40 bg-bg'} disabled:cursor-default ${focus}`}
              onClick={() => {
                onChoose(i);
              }}
            >
              <span className="text-muted">{LETTERS[i]})</span>
              <span className="flex-1">{option}</span>
              {isCorrect ? (
                <span className="text-caption font-semibold">{t('study.objective.correctOption')}</span>
              ) : null}
              {isChosen && !isCorrect ? (
                <span className="text-caption">{t('study.objective.yourChoice')}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * R1 y R6: el intento según el tipo. En las que se recuerdan, revelar (o elegir la confianza)
 * es el intento; en escribir la respuesta, "Comprobar"; en opción múltiple, elegir en la tarjeta;
 * en V/F, elegir y justificar; en la abierta, escribir antes de ver la clave.
 */
export function AttemptControls({
  card,
  askConfidence,
  confidence,
  onReveal,
  onConfidence,
  onTyped,
  onVerdict,
  onWritten,
  onSequence,
  onMatching,
  onLabels,
}: {
  readonly card: StudyCardView;
  readonly askConfidence: boolean;
  readonly confidence: Confidence | null;
  readonly onReveal: (confidence: Confidence | null) => void;
  readonly onConfidence: (confidence: Confidence) => void;
  readonly onTyped: (text: string) => void;
  readonly onVerdict: (verdict: boolean, justification: string) => void;
  readonly onWritten: (text: string) => void;
  /** Ordenar: comprobar el orden que armó en la tarjeta. */
  readonly onSequence: () => void;
  /** Relacionar: comprobar las parejas elegidas. */
  readonly onMatching: () => void;
  /** Etiquetar: comprobar lo escrito para cada número. */
  readonly onLabels: () => void;
}) {
  const { t } = useTranslation();
  const direct = revealsDirectly(card);
  if (askConfidence && (direct || confidence === null)) {
    return (
      <ConfidencePicker
        onPick={(level) => {
          if (direct) onReveal(level);
          else onConfidence(level);
        }}
      />
    );
  }
  if (card.content.kind === 'type_answer') return <TypedAttempt onSubmit={onTyped} />;
  // LD §2: cada subpregunta del caso se intenta como su tipo.
  const sub = caseQuestion(card);
  if (sub?.type === 'type_answer') return <TypedAttempt onSubmit={onTyped} />;
  if (sub?.type === 'open') return <WrittenAttempt onSubmit={onWritten} />;
  if (sub?.type === 'multiple_choice') {
    return <p className="m-0 text-center text-caption text-muted">{t('study.objective.choose')}</p>;
  }
  if (card.content.kind === 'true_false_justify') return <VerdictAttempt onSubmit={onVerdict} />;
  if (card.content.kind === 'open_question') return <WrittenAttempt onSubmit={onWritten} />;
  if (card.content.kind === 'sequence') {
    return (
      <div className="flex flex-col gap-2">
        <p className="m-0 text-center text-caption text-muted">{t('study.sequence.hint')}</p>
        <button type="button" className={primary} onClick={onSequence}>
          {t('study.sequence.check')}
        </button>
      </div>
    );
  }
  if (card.content.kind === 'matching') {
    return <MatchingCheck card={card} onCheck={onMatching} />;
  }
  if (card.content.kind === 'label_image') {
    // Como escribir la respuesta: un campo vacío también es un intento y cuenta como error.
    return (
      <button type="button" className={primary} onClick={onLabels}>
        {t('study.objective.check')}
      </button>
    );
  }
  if (card.content.kind === 'multiple_choice') {
    return <p className="m-0 text-center text-caption text-muted">{t('study.objective.choose')}</p>;
  }
  return (
    <button
      type="button"
      className={primary}
      onClick={() => {
        onReveal(null);
      }}
    >
      {t('study.reveal')}
    </button>
  );
}

function ConfidencePicker({ onPick }: { readonly onPick: (confidence: Confidence) => void }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-2">
      <p id={id} className="m-0 text-center text-caption text-muted">
        {t('study.confidence.question')}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {CONFIDENCES.map((level) => (
          <button
            key={level}
            type="button"
            className={`min-h-14 rounded-(--radius-card) bg-primary/20 px-2 font-medium text-text ${focus}`}
            onClick={() => {
              onPick(level);
            }}
          >
            {t(`study.confidence.level${level}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** UX2: sin autocorrector (la terminología anatómica choca con él); Enter comprueba. */
function TypedAttempt({ onSubmit }: { readonly onSubmit: (text: string) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('');
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(text);
  };
  return (
    <form className="flex flex-col gap-2" onSubmit={submit} noValidate>
      <label htmlFor={id} className="text-caption text-muted">
        {t('study.objective.typeLabel')}
      </label>
      <input
        id={id}
        className={`min-h-11 w-full rounded-(--radius-card) border border-muted/40 bg-bg px-4 text-body ${focus}`}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="done"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <button type="submit" className={primary}>
        {t('study.objective.check')}
      </button>
    </form>
  );
}

const textArea = `w-full rounded-(--radius-card) border border-muted/40 bg-bg px-4 py-2 text-body ${focus}`;

/**
 * LD §2: elegir verdadero o falso y justificar; las dos cosas son el intento (R1). Comprobar
 * espera a que haya ambas.
 */
function VerdictAttempt({
  onSubmit,
}: {
  readonly onSubmit: (verdict: boolean, justification: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [verdict, setVerdict] = useState<boolean | null>(null);
  const [justification, setJustification] = useState('');
  const ready = verdict !== null && justification.trim() !== '';
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (verdict !== null && ready) onSubmit(verdict, justification.trim());
  };
  return (
    <form className="flex flex-col gap-2" onSubmit={submit} noValidate>
      <div role="group" aria-label={t('study.tfj.choose')} className="grid grid-cols-2 gap-2">
        {([true, false] as const).map((value) => (
          <button
            key={String(value)}
            type="button"
            aria-pressed={verdict === value}
            className={`min-h-12 rounded-(--radius-card) border px-3 font-medium ${verdict === value ? 'border-primary bg-primary/20 text-text' : 'border-muted/40 text-primary'} ${focus}`}
            onClick={() => {
              setVerdict(value);
            }}
          >
            {t(value ? 'study.tfj.true' : 'study.tfj.false')}
          </button>
        ))}
      </div>
      <label htmlFor={id} className="text-caption text-muted">
        {t('study.tfj.justify')}
      </label>
      <textarea
        id={id}
        className={textArea}
        rows={2}
        value={justification}
        onChange={(event) => {
          setJustification(event.target.value);
        }}
      />
      <button type="submit" className={primary} disabled={!ready}>
        {t('study.objective.check')}
      </button>
    </form>
  );
}

/** LD §2: la respuesta abierta se escribe antes de ver la clave (R1). */
function WrittenAttempt({ onSubmit }: { readonly onSubmit: (text: string) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('');
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (text.trim() !== '') onSubmit(text.trim());
  };
  return (
    <form className="flex flex-col gap-2" onSubmit={submit} noValidate>
      <label htmlFor={id} className="text-caption text-muted">
        {t('study.open.write')}
      </label>
      <textarea
        id={id}
        className={textArea}
        rows={3}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <button type="submit" className={primary} disabled={text.trim() === ''}>
        {t('study.open.showKey')}
      </button>
    </form>
  );
}

/** LD2: los botones de calificación que corresponden al tipo y al intento. */
export function RatingControls({
  card,
  attempt,
  busy,
  onRate,
}: {
  readonly card: StudyCardView;
  readonly attempt: Attempt | null;
  readonly busy: boolean;
  readonly onRate: (rating: Rating) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const ratingConfig = useStudy((s) => s.session?.ratingConfig);
  const ratings = allowedRatings(card, attempt);
  if (attempt?.kind === 'verdict' && attempt.correct && ratingConfig) {
    // LD2: con el V/F acertado, ella juzga su justificación frente a la de referencia.
    const judge = (justification: 'sufficient' | 'weak') => {
      onRate(toRating({ kind: 'true_false_justify', verdictCorrect: true, justification }, ratingConfig));
    };
    return (
      <div role="group" aria-labelledby={id} className="flex flex-col gap-2">
        <p id={id} className="m-0 text-center text-caption text-muted">
          {t('study.tfj.judge')}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`min-h-14 rounded-(--radius-card) bg-primary/20 px-2 font-medium text-text disabled:opacity-60 ${focus}`}
            disabled={busy}
            onClick={() => {
              judge('weak');
            }}
          >
            {t('study.tfj.weak')}
          </button>
          <button
            type="button"
            className={`min-h-14 rounded-(--radius-card) bg-primary px-2 font-medium text-primary-contrast disabled:opacity-60 ${focus}`}
            disabled={busy}
            onClick={() => {
              judge('sufficient');
            }}
          >
            {t('study.tfj.sufficient')}
          </button>
        </div>
      </div>
    );
  }
  const only = ratings.length === 1 ? ratings[0] : undefined;
  if (only !== undefined) {
    // LD2: un error en una objetiva es Again fijo, y un puntaje parcial da su calificación; solo
    // queda seguir.
    return (
      <button
        type="button"
        className={primary}
        disabled={busy}
        onClick={() => {
          onRate(only);
        }}
      >
        {t('study.objective.next')}
      </button>
    );
  }
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-2">
      <p id={id} className="m-0 text-center text-caption text-muted">
        {t(
          card.content.kind === 'open_question' || attempt?.kind === 'written'
            ? 'study.open.rateLabel'
            : isSelfGraded(card)
              ? 'study.rate.label'
              : 'study.objective.rateLabel',
        )}
      </p>
      <div className={`grid gap-2 ${ratings.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
        {ratings.map((rating) => (
          <RatingButton key={rating} rating={rating} onRate={onRate} disabled={busy} />
        ))}
      </div>
    </div>
  );
}
