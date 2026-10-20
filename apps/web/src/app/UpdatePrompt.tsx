import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useAppStatus } from '@/lib/app-status';
import { Banner } from '@/ui/Banner';
import { useSessionLock } from './session-lock';

/**
 * FRONTEND FE6: ofrece la versión nueva y la activa solo si no hay sesión en curso. Si la
 * API respondió 426 (ARC6), avisa que la sync espera esa actualización.
 */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const sessionActive = useSessionLock((s) => s.active);
  const contractOutdated = useAppStatus((s) => s.contractOutdated);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh && !contractOutdated) return null;

  const action = sessionActive ? (
    <span className="text-muted">{t('update.afterSession')}</span>
  ) : (
    <button
      type="button"
      className="min-h-11 rounded-(--radius-card) bg-primary px-4 text-primary-contrast"
      onClick={() => {
        if (needRefresh) void updateServiceWorker(true);
        else window.location.reload();
      }}
    >
      {t('update.apply')}
    </button>
  );

  return <Banner action={action}>{t(needRefresh ? 'update.available' : 'update.required')}</Banner>;
}
