import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useAppStatus } from '@/lib/app-status';
import { useSessionLock } from '@/lib/session-lock';
import { Banner } from '@/ui/Banner';

/**
 * FRONTEND FE6: ofrece la versión nueva y la activa solo si no hay sesión en curso; si llegó
 * durante una, se aplica sola al terminarla, como dice el aviso. Si la API respondió 426
 * (ARC6), avisa que la sync espera esa actualización y le pide al navegador que la busque.
 */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const sessionActive = useSessionLock((s) => s.holders > 0);
  const contractOutdated = useAppStatus((s) => s.contractOutdated);
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_url, r) => {
      registration.current = r;
    },
  });

  useEffect(() => {
    if (contractOutdated) void registration.current?.update();
  }, [contractOutdated]);

  const apply = useCallback(() => {
    if (needRefresh) void updateServiceWorker(true);
    else window.location.reload();
  }, [needRefresh, updateServiceWorker]);

  const pending = needRefresh || contractOutdated;
  const promised = useRef(false);
  useEffect(() => {
    if (!pending) return;
    if (sessionActive) promised.current = true;
    else if (promised.current) {
      promised.current = false;
      apply();
    }
  }, [pending, sessionActive, apply]);

  if (!pending) return null;

  const action = sessionActive ? (
    <span className="text-muted">{t('update.afterSession')}</span>
  ) : (
    <button
      type="button"
      className="min-h-11 rounded-(--radius-card) bg-primary px-4 font-bold text-primary-contrast candy"
      onClick={apply}
    >
      {t('update.apply')}
    </button>
  );

  return <Banner action={action}>{t(needRefresh ? 'update.available' : 'update.required')}</Banner>;
}
