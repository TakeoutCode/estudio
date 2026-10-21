import type { GamificationConfig } from '@estudio/shared';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { updateGamificationConfig } from '@/features/settings';
import { Toggle } from '@/ui/Toggle';
import { useGamificationConfig } from './queries';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const quiet = `-ml-3 inline-flex min-h-11 items-center self-start px-3 text-primary ${focus}`;

/**
 * UX10: activar o apagar la gamificación (y la racha y las celebraciones) en cualquier momento.
 * Se guarda al tocar, como el tema; viaja con UserSettings.gamification.
 */
export function GamificationSection() {
  const { t } = useTranslation();
  const id = useId();
  const config = useGamificationConfig();
  const [failed, setFailed] = useState(false);
  if (!config) return null;
  const change = (update: Partial<GamificationConfig>) => {
    setFailed(false);
    updateGamificationConfig((current) => ({ ...current, ...update })).catch(() => {
      setFailed(true);
    });
  };
  const on = config.enabled === true;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="m-0 text-body font-semibold">
        {t('gamification.settings.title')}
      </h2>
      <p className="m-0 text-caption text-muted">{t('gamification.settings.hint')}</p>
      <Toggle
        label={t('gamification.settings.enabled')}
        checked={on}
        onChange={(enabled) => {
          change({ enabled });
        }}
      />
      {on ? (
        <>
          <Toggle
            label={t('gamification.settings.streak')}
            hint={t('gamification.settings.streakHint')}
            checked={config.streakEnabled}
            onChange={(streakEnabled) => {
              change({ streakEnabled });
            }}
          />
          <Toggle
            label={t('gamification.settings.celebrations')}
            hint={t('gamification.settings.celebrationsHint')}
            checked={config.celebrations}
            onChange={(celebrations) => {
              change({ celebrations });
            }}
          />
          <Link className={quiet} to="/rewards">
            {t('gamification.open')}
          </Link>
        </>
      ) : null}
      {failed ? (
        <p role="alert" className="m-0 text-caption">
          {t('gamification.saveFailed')}
        </p>
      ) : null}
    </section>
  );
}
