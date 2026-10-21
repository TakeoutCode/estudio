import { CLINICAL_QUESTIONS } from '@estudio/shared';
import { type RefObject, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { type ClinicalQuestionDraft, emptyClinicalQuestion, type ExerciseDraft } from './draft';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `w-full rounded-(--radius-card) border border-muted/40 bg-bg px-4 py-2 text-text ${focus}`;
const input = `min-h-11 w-full min-w-0 rounded-(--radius-card) border border-muted/40 bg-bg px-3 text-text ${focus}`;
const choiceButton = `min-h-11 rounded-(--radius-card) border px-2 text-caption text-text ${focus}`;
const textLink = `-ml-2 inline-flex min-h-11 items-center self-start px-2 text-primary ${focus}`;
const TYPES = ['multiple_choice', 'type_answer', 'open'] as const;
const MAX_OPTIONS = 5;

/**
 * LD §2 (`clinical_case`): la viñeta y de 1 a 6 subpreguntas; cada una es una Card y se responde
 * como su tipo. El número de una subpregunta no se reutiliza al quitarla, así el historial de
 * las demás no cambia (como las etiquetas de una oclusión).
 */
export function ClinicalCaseFields({
  draft,
  onDraft,
  firstRef,
}: {
  readonly draft: ExerciseDraft;
  readonly onDraft: (next: ExerciseDraft) => void;
  readonly firstRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useTranslation();
  const { questions } = draft;
  const update = (n: number, patch: Partial<ClinicalQuestionDraft>) => {
    onDraft({ ...draft, questions: questions.map((q) => (q.n === n ? { ...q, ...patch } : q)) });
  };
  const nextN = Math.max(0, ...questions.map((q) => q.n)) + 1;
  return (
    <>
      <label className="flex flex-col gap-1">
        <span>{t('exercises.clinical.vignette')}</span>
        <textarea
          ref={firstRef}
          className={field}
          rows={5}
          maxLength={3000}
          placeholder={t('exercises.clinical.vignettePlaceholder')}
          value={draft.vignette}
          onChange={(event) => {
            onDraft({ ...draft, vignette: event.target.value });
          }}
        />
      </label>
      {questions.map((q, i) => (
        <QuestionFields
          key={q.n}
          position={i + 1}
          question={q}
          removable={questions.length > CLINICAL_QUESTIONS.min}
          onChange={(patch) => {
            update(q.n, patch);
          }}
          onRemove={() => {
            onDraft({ ...draft, questions: questions.filter((x) => x.n !== q.n) });
          }}
        />
      ))}
      {questions.length < CLINICAL_QUESTIONS.max ? (
        <button
          type="button"
          className={textLink}
          onClick={() => {
            onDraft({ ...draft, questions: [...questions, emptyClinicalQuestion(nextN)] });
          }}
        >
          {t('exercises.clinical.add')}
        </button>
      ) : null}
    </>
  );
}

function QuestionFields({
  position,
  question: q,
  removable,
  onChange,
  onRemove,
}: {
  readonly position: number;
  readonly question: ClinicalQuestionDraft;
  readonly removable: boolean;
  readonly onChange: (patch: Partial<ClinicalQuestionDraft>) => void;
  readonly onRemove: () => void;
}) {
  const { t } = useTranslation();
  const ids = useId();
  return (
    <fieldset className="m-0 flex flex-col gap-2 rounded-(--radius-card) border border-muted/40 p-3">
      <legend className="px-1 font-semibold">{t('exercises.clinical.question', { n: position })}</legend>
      <div role="group" aria-label={t('exercises.clinical.type')} className="grid grid-cols-3 gap-2">
        {TYPES.map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={q.type === type}
            className={`${choiceButton} ${q.type === type ? 'border-primary bg-primary/20' : 'border-muted/40'}`}
            onClick={() => {
              onChange({ type });
            }}
          >
            {t(`exercises.clinical.types.${type}`)}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1">
        <span>{t('exercises.clinical.questionText')}</span>
        <textarea
          className={field}
          rows={2}
          maxLength={1000}
          value={q.question}
          onChange={(event) => {
            onChange({ question: event.target.value });
          }}
        />
      </label>
      {q.type === 'multiple_choice' ? (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-caption text-muted">{t('exercises.clinical.options')}</legend>
          {q.options.map((option, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="radio"
                name={`${ids}-correct`}
                className="size-5 shrink-0 accent-primary"
                checked={q.correct === i}
                aria-label={t('exercises.clinical.markCorrect', { n: i + 1 })}
                onChange={() => {
                  onChange({ correct: i });
                }}
              />
              <input
                className={input}
                value={option}
                maxLength={200}
                aria-label={t('exercises.clinical.option', { n: i + 1 })}
                onChange={(event) => {
                  onChange({ options: q.options.map((o, j) => (j === i ? event.target.value : o)) });
                }}
              />
            </div>
          ))}
          {q.options.length < MAX_OPTIONS ? (
            <button
              type="button"
              className={textLink}
              onClick={() => {
                onChange({ options: [...q.options, ''] });
              }}
            >
              {t('exercises.clinical.addOption')}
            </button>
          ) : null}
        </fieldset>
      ) : null}
      {q.type === 'type_answer' ? (
        <label className="flex flex-col gap-1">
          <span>{t('exercises.clinical.answer')}</span>
          <input
            className={input}
            value={q.answer}
            maxLength={200}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => {
              onChange({ answer: event.target.value });
            }}
          />
        </label>
      ) : null}
      {q.type === 'open' ? (
        <label className="flex flex-col gap-1">
          <span>{t('exercises.open.key')}</span>
          <textarea
            className={field}
            rows={3}
            maxLength={2000}
            value={q.key}
            onChange={(event) => {
              onChange({ key: event.target.value });
            }}
          />
        </label>
      ) : null}
      {removable ? (
        <button
          type="button"
          className={`-ml-2 inline-flex min-h-11 items-center self-start px-2 text-danger ${focus}`}
          onClick={onRemove}
        >
          {t('exercises.clinical.remove', { n: position })}
        </button>
      ) : null}
    </fieldset>
  );
}
