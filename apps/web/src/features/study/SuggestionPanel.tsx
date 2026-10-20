import type { PlannerConfig } from '@estudio/shared';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { Suggestion } from './use-session-suggestion';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const act = `inline-flex min-h-11 flex-1 items-center justify-center rounded-(--radius-card) border border-primary px-3 font-medium text-primary ${focus}`;
const later = `inline-flex min-h-11 shrink-0 items-center justify-center rounded-(--radius-card) px-4 text-primary ${focus}`;

/**
 * P5 y P6: aviso suave sobre las acciones, en la zona del pulgar (UX2). Informa y ofrece;
 * la tarjeta y sus botones siguen ahí (P6: nunca bloquear). Sin culpa ni urgencia (UX7, R19).
 */
export function SuggestionPanel({
  suggestion,
  planner,
  canBreak,
  onTakeBreak,
  onFinish,
  onDismiss,
}: {
  readonly suggestion: Suggestion;
  readonly planner: PlannerConfig;
  /** Hay un bloque del temporizador en este dispositivo: se puede pasar al descanso (§3). */
  readonly canBreak: boolean;
  readonly onTakeBreak: () => void;
  readonly onFinish: () => void;
  readonly onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const text =
    suggestion.kind === 'break'
      ? t('study.suggest.break')
      : suggestion.reason === 'bedtime'
        ? t('study.suggest.bedtime')
        : suggestion.reason === 'fatigue'
          ? t('study.suggest.fatigue', { count: planner.fatigueWarningsToStop })
          : t('study.suggest.blocks', { count: planner.stopAfterNetBlocks });

  return (
    <section
      role="status"
      aria-labelledby={id}
      className="flex flex-col gap-2 rounded-(--radius-card) bg-surface p-4"
    >
      <p id={id} className="m-0">
        {text}
      </p>
      <div className="flex justify-end gap-2">
        {suggestion.kind === 'stop' ? (
          <button type="button" className={act} onClick={onFinish}>
            {t('study.finish')}
          </button>
        ) : null}
        {suggestion.kind === 'break' && canBreak ? (
          <button type="button" className={act} onClick={onTakeBreak}>
            {t('study.suggest.takeBreak')}
          </button>
        ) : null}
        <button type="button" className={later} onClick={onDismiss}>
          {t(suggestion.kind === 'break' && canBreak ? 'study.suggest.later' : 'study.suggest.continue')}
        </button>
      </div>
    </section>
  );
}
