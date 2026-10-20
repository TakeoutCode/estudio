import { clozeSegments, type Confidence, Rating } from '@estudio/shared';
import { type SubmitEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RatingButton } from '@/ui/RatingButton';
import type { StudyCardView } from './queries';
import type { Attempt, CardPhase } from './store';

// Cómo se ve y se intenta cada tipo de LEARNING-DESIGN §1. Antes del intento la respuesta no
// está en el DOM (R1, FE10); después, siempre con su explicación (R4).

const CONFIDENCES = [1, 2, 3] as const;
const SELF_RATINGS = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const;
/** LD2: con acierto en una objetiva se elige entre estas, con Good por defecto. */
const CORRECT_RATINGS = [Rating.Hard, Rating.Good, Rating.Easy] as const;
const LETTERS = 'abcde';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const primary = `inline-flex min-h-14 w-full items-center justify-center rounded-(--radius-card) bg-primary px-4 font-medium text-primary-contrast disabled:opacity-60 ${focus}`;

/** Las que ella califica eligiendo entre los 4 botones (LD2). */
export const isSelfGraded = (card: StudyCardView): boolean =>
  card.content.kind === 'basic' || card.content.kind === 'cloze';

/** La calificación por defecto de Enter tras revelar una objetiva: Again si falló, Good si acertó. */
export const defaultObjectiveRating = (attempt: Attempt): Rating =>
  attempt.correct ? Rating.Good : Rating.Again;

/** LD2: las calificaciones que se pueden elegir después del intento. */
export function allowedRatings(card: StudyCardView, attempt: Attempt | null): readonly Rating[] {
  if (isSelfGraded(card) || !attempt) return SELF_RATINGS;
  return attempt.correct ? CORRECT_RATINGS : [Rating.Again];
}

/** El cuerpo de la tarjeta: pregunta y, tras el intento, respuesta y explicación. */
export function CardBody({
  card,
  phase,
  attempt,
  canChoose,
  onChoose,
}: {
  readonly card: StudyCardView;
  readonly phase: CardPhase;
  readonly attempt: Attempt | null;
  /** Opción múltiple: elegir es el intento; con `askConfidence`, después de la confianza. */
  readonly canChoose: boolean;
  readonly onChoose: (option: number) => void;
}) {
  const { t } = useTranslation();
  const revealed = phase === 'revealed';
  const { content } = card;
  return (
    <article className="flex flex-col gap-4 rounded-(--radius-card) bg-surface p-5">
      {content.kind === 'cloze' ? (
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
      <div aria-live="polite">
        {revealed ? (
          <section className="flex flex-col gap-2 border-t border-muted/30 pt-4">
            {attempt?.kind === 'typed' ? <TypedResult attempt={attempt} answer={card.answer} /> : null}
            {attempt?.kind === 'choice' ? (
              <p className="m-0 font-semibold">
                {t(attempt.correct ? 'study.objective.right' : 'study.objective.wrongChoice')}
              </p>
            ) : null}
            {content.kind === 'basic' ? (
              <>
                <h2 className="m-0 text-caption font-normal text-muted">{t('study.answer')}</h2>
                <p className="m-0 text-card whitespace-pre-wrap">{card.answer}</p>
              </>
            ) : null}
            {content.explanation ? (
              <p className="m-0 whitespace-pre-wrap text-muted">{content.explanation}</p>
            ) : null}
          </section>
        ) : null}
      </div>
    </article>
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
 * R1 y R6: el intento según el tipo. En las que ella califica, revelar (o elegir la confianza)
 * es el intento; en escribir la respuesta, "Comprobar"; en opción múltiple, elegir en la tarjeta.
 */
export function AttemptControls({
  card,
  askConfidence,
  confidence,
  onReveal,
  onConfidence,
  onTyped,
}: {
  readonly card: StudyCardView;
  readonly askConfidence: boolean;
  readonly confidence: Confidence | null;
  readonly onReveal: (confidence: Confidence | null) => void;
  readonly onConfidence: (confidence: Confidence) => void;
  readonly onTyped: (text: string) => void;
}) {
  const { t } = useTranslation();
  const selfGraded = isSelfGraded(card);
  if (askConfidence && (selfGraded || confidence === null)) {
    return (
      <ConfidencePicker
        onPick={(level) => {
          if (selfGraded) onReveal(level);
          else onConfidence(level);
        }}
      />
    );
  }
  if (card.content.kind === 'type_answer') return <TypedAttempt onSubmit={onTyped} />;
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
  const ratings = allowedRatings(card, attempt);
  if (ratings.length === 1) {
    // LD2: un error en una objetiva es Again fijo; solo queda seguir.
    return (
      <button
        type="button"
        className={primary}
        disabled={busy}
        onClick={() => {
          onRate(Rating.Again);
        }}
      >
        {t('study.objective.next')}
      </button>
    );
  }
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-2">
      <p id={id} className="m-0 text-center text-caption text-muted">
        {t(isSelfGraded(card) ? 'study.rate.label' : 'study.objective.rateLabel')}
      </p>
      <div className={`grid gap-2 ${ratings.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
        {ratings.map((rating) => (
          <RatingButton key={rating} rating={rating} onRate={onRate} disabled={busy} />
        ))}
      </div>
    </div>
  );
}
