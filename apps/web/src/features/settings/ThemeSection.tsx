import type { UiSettings } from '@estudio/shared';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { updateUiSettings } from './commands';
import { useUiSettings } from './queries';

const THEMES = ['system', 'light', 'dark'] as const satisfies readonly UiSettings['theme'][];

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const choice = `min-h-11 rounded-(--radius-card) border-2 px-2 text-text ${focus}`;

/**
 * UX5: Sistema (por defecto), Claro u Oscuro. Se aplica y se guarda al tocarlo, para verlo de
 * inmediato; viaja con UserSettings.ui a sus otros dispositivos.
 */
export function ThemeSection() {
  const { t } = useTranslation();
  const id = useId();
  const current = useUiSettings()?.theme ?? 'system';
  const [failed, setFailed] = useState(false);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="m-0 text-body font-semibold">
        {t('settings.theme.title')}
      </h2>
      <div className="grid grid-cols-3 gap-2">
        {THEMES.map((theme) => (
          <button
            key={theme}
            type="button"
            aria-pressed={current === theme}
            className={`${choice} ${current === theme ? 'border-primary bg-primary/20' : 'border-line-strong'}`}
            onClick={() => {
              setFailed(false);
              updateUiSettings((ui) => ({ ...ui, theme })).catch(() => {
                setFailed(true);
              });
            }}
          >
            {t(`settings.theme.${theme}`)}
          </button>
        ))}
      </div>
      {failed ? (
        <p role="alert" className="m-0 text-caption">
          {t('settings.saveFailed')}
        </p>
      ) : null}
    </section>
  );
}
