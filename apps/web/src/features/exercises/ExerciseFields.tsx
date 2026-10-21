import { type RefObject, useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditableExerciseKind, ExerciseDraft } from './draft';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `w-full rounded-(--radius-card) border border-muted/40 bg-bg px-4 py-2 text-text ${focus}`;
const choiceButton = `min-h-12 rounded-(--radius-card) border px-3 text-text ${focus}`;

/**
 * Los campos propios de cada ejercicio (LD §2). Mazo, tema, explicación y etiquetas los pone el
 * editor de notas, igual que en una tarjeta.
 */
export function ExerciseFields({
  kind,
  draft,
  onDraft,
  firstRef,
}: {
  readonly kind: EditableExerciseKind;
  readonly draft: ExerciseDraft;
  readonly onDraft: (next: ExerciseDraft) => void;
  /** El primer campo: recibe el foco tras guardar, para escribir el siguiente. */
  readonly firstRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const set = (patch: Partial<ExerciseDraft>) => {
    onDraft({ ...draft, ...patch });
  };

  switch (kind) {
    case 'true_false_justify':
      return (
        <>
          <label className="flex flex-col gap-1">
            <span>{t('exercises.tfj.statement')}</span>
            <textarea
              ref={firstRef}
              className={field}
              rows={3}
              value={draft.statement}
              onChange={(event) => {
                set({ statement: event.target.value });
              }}
            />
          </label>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1">{t('exercises.tfj.isTrue')}</legend>
            <div className="grid grid-cols-2 gap-2">
              {([true, false] as const).map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  aria-pressed={draft.isTrue === value}
                  className={`${choiceButton} ${draft.isTrue === value ? 'border-primary bg-primary/20' : 'border-muted/40'}`}
                  onClick={() => {
                    set({ isTrue: value });
                  }}
                >
                  {t(value ? 'exercises.tfj.true' : 'exercises.tfj.false')}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1">
              <span>{t('exercises.tfj.justification')}</span>
              <textarea
                className={field}
                rows={3}
                maxLength={1000}
                aria-describedby={`${ids}-justification`}
                value={draft.justification}
                onChange={(event) => {
                  set({ justification: event.target.value });
                }}
              />
            </label>
            <span id={`${ids}-justification`} className="text-caption text-muted">
              {t('exercises.tfj.justificationHint')}
            </span>
          </div>
        </>
      );
    case 'open_question':
      return (
        <>
          <label className="flex flex-col gap-1">
            <span>{t('exercises.open.question')}</span>
            <textarea
              ref={firstRef}
              className={field}
              rows={3}
              value={draft.question}
              onChange={(event) => {
                set({ question: event.target.value });
              }}
            />
          </label>
          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1">
              <span>{t('exercises.open.key')}</span>
              <textarea
                className={field}
                rows={4}
                aria-describedby={`${ids}-key`}
                value={draft.key}
                onChange={(event) => {
                  set({ key: event.target.value });
                }}
              />
            </label>
            <span id={`${ids}-key`} className="text-caption text-muted">
              {t('exercises.open.keyHint')}
            </span>
          </div>
        </>
      );
  }
}
