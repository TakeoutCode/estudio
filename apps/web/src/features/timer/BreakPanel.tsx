import type { TimerSession } from '@estudio/shared';
import { remainingMs } from '@estudio/srs';
import { useTranslation } from 'react-i18next';
import { ActionBar } from '@/ui/ActionBar';
import { dispatchTimer } from './commands';
import { formatClock } from './format';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * Descanso (§3): reemplaza la tarjeta entre una y otra (R13). Se sugiere, no se fuerza: se
 * puede seguir antes (`skipBreak`) o terminar el temporizador.
 */
export function BreakPanel({ session, at }: { readonly session: TimerSession; readonly at: number }) {
  const { t } = useTranslation();
  const left = remainingMs(session, at);
  return (
    <>
      <section className="flex flex-col items-center gap-2 rounded-(--radius-card) bg-surface px-5 py-10 text-center">
        <h2 className="m-0 text-body font-semibold">
          {t(session.state === 'break_long' ? 'timer.breakLong' : 'timer.break')}
        </h2>
        <p className="m-0 text-display font-semibold tabular-nums" aria-live="off">
          {formatClock(left)}
        </p>
        <p className="m-0 text-muted">{t(left === 0 ? 'timer.breakOver' : 'timer.breakHint')}</p>
      </section>
      <ActionBar>
        <button
          type="button"
          className={`inline-flex min-h-14 w-full items-center justify-center rounded-(--radius-card) bg-primary px-4 font-medium text-primary-contrast ${focus}`}
          onClick={() => void dispatchTimer({ type: 'skipBreak' })}
        >
          {t('timer.continue')}
        </button>
        <button
          type="button"
          className={`inline-flex min-h-11 w-full items-center justify-center rounded-(--radius-card) px-4 text-primary ${focus}`}
          onClick={() => void dispatchTimer({ type: 'stop' })}
        >
          {t('timer.stop')}
        </button>
      </ActionBar>
    </>
  );
}
