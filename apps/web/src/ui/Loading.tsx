import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** UI-UX UX3: el esqueleto aparece solo si la carga tarda más que esto. */
export const SKELETON_DELAY_MS = 300;

/** `true` cuando `active` lleva más de `SKELETON_DELAY_MS` seguidos. */
export function useDelayed(active: boolean): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!active) return;
    const handle = window.setTimeout(() => {
      setLate(true);
    }, SKELETON_DELAY_MS);
    return () => {
      window.clearTimeout(handle);
      setLate(false);
    };
  }, [active]);
  return active && late;
}

/**
 * UI-UX UX3: el estado de carga de una vista. Los primeros 300 ms no muestra nada (casi siempre
 * Dexie responde antes, y un parpadeo se lee peor que la espera); después, un esqueleto con la
 * forma de una pantalla, que solo late si ella no pidió menos movimiento (UX4).
 */
export function Loading() {
  const { t } = useTranslation();
  if (!useDelayed(true)) return null;
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">{t('app.loading')}</span>
      <div aria-hidden="true" className="flex flex-col gap-3 motion-safe:animate-pulse">
        <div className="h-8 w-2/5 rounded-(--radius-card) bg-line" />
        <div className="h-28 rounded-(--radius-card) bg-line" />
        <div className="h-14 rounded-(--radius-card) bg-line" />
        <div className="h-14 rounded-(--radius-card) bg-line" />
      </div>
    </div>
  );
}
