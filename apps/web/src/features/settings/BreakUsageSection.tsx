import type { BreakUsage } from '@estudio/srs';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { projectionWorker } from '@/workers/projection';
import { useBreakUsageInput } from './queries';

/**
 * §5 "Uso de descansos": solo aquí, en Ajustes, y sin juicio. Sirve para comparar modos del
 * temporizador con sus datos (§6). Se calcula en el worker (FE4).
 */
export function BreakUsageSection() {
  const { t } = useTranslation();
  const id = useId();
  const input = useBreakUsageInput();
  const worker = projectionWorker();
  const [usage, setUsage] = useState<BreakUsage | null>(null);

  useEffect(() => {
    if (!input || !worker) return;
    let cancelled = false;
    void worker.breakUsage(input).then((result) => {
      if (!cancelled) setUsage(result);
    });
    return () => {
      cancelled = true;
    };
  }, [input, worker]);

  if (!input || !usage) return null;
  const used = usage.focusBlocks + usage.taken + usage.cutShort > 0;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="m-0 text-body font-semibold">
        {t('settings.breaks.title')}
      </h2>
      {used ? (
        <>
          <p className="m-0 text-caption text-muted">
            {t('settings.breaks.window', { weeks: input.config.metrics.baselineWeeks })}
          </p>
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
            <dt>{t('settings.breaks.taken')}</dt>
            <dd className="m-0 text-right tabular-nums">{usage.taken}</dd>
            <dt>{t('settings.breaks.cutShort')}</dt>
            <dd className="m-0 text-right tabular-nums">{usage.cutShort}</dd>
            <dt>{t('settings.breaks.extended')}</dt>
            <dd className="m-0 text-right tabular-nums">{usage.extended}</dd>
          </dl>
        </>
      ) : (
        <p className="m-0 text-caption text-muted">{t('settings.breaks.none')}</p>
      )}
    </section>
  );
}
