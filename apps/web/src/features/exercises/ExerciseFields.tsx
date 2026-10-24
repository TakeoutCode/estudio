import { MATCHING_PAIRS, SEQUENCE_ITEMS } from '@estudio/shared';
import { type RefObject, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ClinicalCaseFields } from './ClinicalCaseFields';
import type { DraftExerciseKind, ExerciseDraft } from './draft';
import { moved, OrderList } from './OrderList';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `w-full rounded-(--radius-card) border-2 border-line-strong bg-bg px-4 py-2 text-text ${focus}`;
const choiceButton = `min-h-12 rounded-(--radius-card) border-2 px-3 text-text ${focus}`;

/**
 * Los campos propios de cada ejercicio (LD §2). Mazo, tema, explicación y etiquetas los pone el
 * editor de notas, igual que en una tarjeta.
 */
export function ExerciseFields({
  kind,
  draft,
  onDraft,
  firstRef,
  aiDeckId = null,
}: {
  readonly kind: DraftExerciseKind;
  readonly draft: ExerciseDraft;
  readonly onDraft: (next: ExerciseDraft) => void;
  /** El primer campo: recibe el foco tras guardar, para escribir el siguiente. */
  readonly firstRef: RefObject<HTMLTextAreaElement | null>;
  /** LD14: el mazo para pedir distractores con IA; null si el mazo todavía no existe. */
  readonly aiDeckId?: string | null;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const set = (patch: Partial<ExerciseDraft>) => {
    onDraft({ ...draft, ...patch });
  };

  switch (kind) {
    case 'clinical_case':
      return <ClinicalCaseFields draft={draft} onDraft={onDraft} firstRef={firstRef} aiDeckId={aiDeckId} />;
    case 'matching':
      return (
        <>
          <label className="flex flex-col gap-1">
            <span>{t('exercises.sequence.prompt')}</span>
            <textarea
              ref={firstRef}
              className={field}
              rows={2}
              maxLength={500}
              placeholder={t('exercises.matching.promptPlaceholder')}
              value={draft.prompt}
              onChange={(event) => {
                set({ prompt: event.target.value });
              }}
            />
          </label>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" aria-describedby={`${ids}-pairs`}>
            <legend className="mb-1">{t('exercises.matching.pairs')}</legend>
            <div
              className="grid grid-cols-[1fr_1fr_2.75rem] gap-2 text-caption text-muted"
              aria-hidden="true"
            >
              <span>{t('exercises.matching.left')}</span>
              <span>{t('exercises.matching.right')}</span>
            </div>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {draft.pairs.map((pair, i) => {
                const update = (patch: Partial<typeof pair>) => {
                  set({ pairs: draft.pairs.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
                };
                return (
                  <li key={i} className="grid grid-cols-[1fr_1fr_2.75rem] items-center gap-2">
                    <input
                      className={`min-h-11 w-full min-w-0 rounded-(--radius-card) border-2 border-line-strong bg-bg px-3 text-text ${focus}`}
                      value={pair.left}
                      maxLength={200}
                      aria-label={t('exercises.matching.leftN', { n: i + 1 })}
                      onChange={(event) => {
                        update({ left: event.target.value });
                      }}
                    />
                    <input
                      className={`min-h-11 w-full min-w-0 rounded-(--radius-card) border-2 border-line-strong bg-bg px-3 text-text ${focus}`}
                      value={pair.right}
                      maxLength={200}
                      aria-label={t('exercises.matching.rightN', { n: i + 1 })}
                      onChange={(event) => {
                        update({ right: event.target.value });
                      }}
                    />
                    {draft.pairs.length > MATCHING_PAIRS.min ? (
                      <button
                        type="button"
                        className={`inline-flex size-11 items-center justify-center text-muted ${focus}`}
                        aria-label={t('exercises.matching.remove', { n: i + 1 })}
                        onClick={() => {
                          set({ pairs: draft.pairs.filter((_, j) => j !== i) });
                        }}
                      >
                        <span aria-hidden="true">×</span>
                      </button>
                    ) : (
                      <span />
                    )}
                  </li>
                );
              })}
            </ul>
            {draft.pairs.length < MATCHING_PAIRS.max ? (
              <button
                type="button"
                className={`-ml-2 inline-flex min-h-11 items-center self-start px-2 text-primary ${focus}`}
                onClick={() => {
                  set({ pairs: [...draft.pairs, { left: '', right: '' }] });
                }}
              >
                {t('exercises.matching.add')}
              </button>
            ) : null}
            <p id={`${ids}-pairs`} className="m-0 text-caption text-muted">
              {t('exercises.matching.hint', { min: MATCHING_PAIRS.min, max: MATCHING_PAIRS.max })}
            </p>
          </fieldset>
        </>
      );
    case 'sequence':
      return (
        <>
          <label className="flex flex-col gap-1">
            <span>{t('exercises.sequence.prompt')}</span>
            <textarea
              ref={firstRef}
              className={field}
              rows={2}
              maxLength={500}
              placeholder={t('exercises.sequence.promptPlaceholder')}
              value={draft.prompt}
              onChange={(event) => {
                set({ prompt: event.target.value });
              }}
            />
          </label>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" aria-describedby={`${ids}-items`}>
            <legend className="mb-1">{t('exercises.sequence.items')}</legend>
            <OrderList
              rows={draft.items.map((item, i) => ({
                key: String(i),
                label: item.trim() === '' ? t('exercises.sequence.step', { n: i + 1 }) : item,
                content: (
                  <div className="flex items-center gap-1">
                    <input
                      className={`min-h-11 w-full min-w-0 rounded-(--radius-card) border-2 border-line-strong bg-bg px-3 text-text ${focus}`}
                      value={item}
                      maxLength={200}
                      aria-label={t('exercises.sequence.step', { n: i + 1 })}
                      onChange={(event) => {
                        set({ items: draft.items.map((x, j) => (j === i ? event.target.value : x)) });
                      }}
                    />
                    {draft.items.length > SEQUENCE_ITEMS.min ? (
                      <button
                        type="button"
                        className={`inline-flex size-11 shrink-0 items-center justify-center text-muted ${focus}`}
                        aria-label={t('exercises.sequence.remove', { n: i + 1 })}
                        onClick={() => {
                          set({ items: draft.items.filter((_, j) => j !== i) });
                        }}
                      >
                        <span aria-hidden="true">×</span>
                      </button>
                    ) : null}
                  </div>
                ),
              }))}
              onMove={(index, direction) => {
                set({ items: moved(draft.items, index, direction) });
              }}
            />
            {draft.items.length < SEQUENCE_ITEMS.max ? (
              <button
                type="button"
                className={`-ml-2 inline-flex min-h-11 items-center self-start px-2 text-primary ${focus}`}
                onClick={() => {
                  set({ items: [...draft.items, ''] });
                }}
              >
                {t('exercises.sequence.add')}
              </button>
            ) : null}
            <p id={`${ids}-items`} className="m-0 text-caption text-muted">
              {t('exercises.sequence.hint', { min: SEQUENCE_ITEMS.min, max: SEQUENCE_ITEMS.max })}
            </p>
          </fieldset>
        </>
      );
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
                  className={`${choiceButton} ${draft.isTrue === value ? 'border-primary bg-primary/20' : 'border-line-strong'}`}
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
