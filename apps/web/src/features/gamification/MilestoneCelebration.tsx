import { type Milestone, type MilestoneState, newMilestones, progressAfter } from '@estudio/srs';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { projectionWorker } from '@/workers/projection';
import { loadGamificationInput, useAnsweredSince, useGamificationConfig } from './queries';

/** UX6: una celebración dura 1.5 s como máximo y se puede cerrar antes. */
const CELEBRATION_MS = 1500;

interface Baseline {
  readonly state: MilestoneState;
  /** Instante del resumen: lo respondido después es lo nuevo de la sesión. */
  readonly since: number;
}

/**
 * UX6, UX10: durante una sesión, un aviso suave al subir de nivel o al ganar un logro, nunca en
 * cada tarjeta. El resumen completo se calcula una vez en el worker (FE4); después solo se
 * suman las respuestas nuevas, sin recorrer el log en el hilo principal (FE9). Sin sonido, y
 * sin movimiento con `prefers-reduced-motion` (UX4).
 */
export function MilestoneCelebration() {
  const config = useGamificationConfig();
  const on = config?.enabled === true && config.celebrations;
  const baseline = useBaseline(on);
  const added = useAnsweredSince(baseline?.since ?? null);
  const shown = useRef(new Set<string>());
  const [showing, setShowing] = useState<readonly Milestone[]>([]);

  useEffect(() => {
    if (!config || !baseline || !added) return;
    const after = progressAfter(baseline.state, added, config);
    const fresh = newMilestones(baseline.state, after).filter((m) => !shown.current.has(keyOf(m)));
    if (fresh.length === 0) return;
    for (const m of fresh) shown.current.add(keyOf(m));
    setShowing(fresh);
  }, [config, baseline, added]);

  useEffect(() => {
    if (showing.length === 0) return;
    const timer = window.setTimeout(() => {
      setShowing([]);
    }, CELEBRATION_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [showing]);

  // La región `status` existe antes del aviso, para que el lector de pantalla lo anuncie.
  return on ? (
    <div
      data-gamification=""
      role="status"
      className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-30 flex justify-center px-4"
    >
      {showing.length > 0 ? (
        <Toast
          milestones={showing}
          onClose={() => {
            setShowing([]);
          }}
        />
      ) : null}
    </div>
  ) : null;
}

const keyOf = (m: Milestone): string => (m.kind === 'level' ? `level:${String(m.level)}` : `badge:${m.id}`);

/** El nivel y los logros al abrir la sesión, calculados una sola vez en el worker. */
function useBaseline(on: boolean): Baseline | null {
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  useEffect(() => {
    if (!on) return;
    const worker = projectionWorker();
    if (!worker) return;
    let cancelled = false;
    loadGamificationInput()
      .then(async (input) => {
        if (!input) return;
        const state = await worker.gamificationSummary(input);
        if (!cancelled) setBaseline({ state, since: input.now });
      })
      .catch(() => undefined); // sin resumen no hay celebración; la sesión sigue igual
    return () => {
      cancelled = true;
    };
  }, [on]);
  return on ? baseline : null;
}

function Toast({
  milestones,
  onClose,
}: {
  readonly milestones: readonly Milestone[];
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setEntered(true);
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <button
      type="button"
      className={`pointer-events-auto flex min-h-12 max-w-sm flex-col items-center rounded-(--radius-card) bg-blush px-5 py-2 text-center font-bold text-primary shadow-card motion-safe:transition motion-safe:duration-200 motion-safe:ease-out ${entered ? 'opacity-100 motion-safe:scale-100' : 'opacity-0 motion-safe:scale-95'} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
      onClick={onClose}
    >
      {milestones.map((m) => (
        <span key={keyOf(m)}>
          {m.kind === 'level'
            ? t('gamification.celebration.level', { level: m.level })
            : t('gamification.celebration.badge', { name: t(`gamification.badges.${m.id}.name`) })}
        </span>
      ))}
    </button>
  );
}
