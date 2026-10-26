import { TIMER_PRESETS, TIMER_RANGES, type TimerMode } from '@estudio/shared';
import { activeMs, isPauseExpired, remainingMs, type TimerBlockRecord } from '@estudio/srs';
import { type SubmitEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { updateStudyConfig } from '@/features/settings';
import { ClockIcon } from '@/ui/icons';
import { NumberField } from '@/ui/NumberField';
import { SourceLink } from '@/ui/SourceLink';
import { dispatchTimer, recordManualMinutes, type TimerAction, type TimerResult } from './commands';
import { formatClock } from './format';
import type { TimerView } from './queries';

const MINUTE_MS = 60_000;
const MODES: readonly TimerMode[] = ['structured', 'flexible', 'free'];

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const action = `press inline-flex min-h-11 items-center justify-center rounded-(--radius-card) px-3 font-bold text-primary ${focus}`;
const strong = `inline-flex min-h-11 items-center justify-center rounded-(--radius-card) bg-primary px-4 font-bold text-primary-contrast candy ${focus}`;
const choice = `min-h-11 rounded-(--radius-card) border-2 px-3 text-text ${focus}`;

/**
 * El temporizador dentro del repaso (§3). Va bajo la barra superior y nunca tapa la tarjeta;
 * durante el descanso la pantalla muestra `BreakPanel` en su lugar.
 */
export function TimerStrip({
  view,
  now,
  onResult,
  breakAfterCard,
}: {
  readonly view: TimerView;
  /** `Date.now()` del último repintado. */
  readonly now: number;
  readonly onResult: (result: TimerResult) => void;
  /**
   * R13: con una tarjeta en pantalla, "Descansar" no la corta: quien la muestra pide el
   * descanso y lo empieza al terminarla. Sin esto, el descanso empieza en el acto.
   */
  readonly breakAfterCard?: {
    readonly pending: boolean;
    readonly request: () => void;
    readonly cancel: () => void;
  };
}) {
  const { t } = useTranslation();
  const [choosing, setChoosing] = useState(false);
  const { session, config } = view;
  const at = now + view.offsetMs;
  const act = (timerAction: TimerAction) => {
    void dispatchTimer(timerAction).then((result) => {
      if (result) onResult(result);
    });
  };

  if (session && !view.isOwner && session.state !== 'idle') {
    return (
      <Row label={t('timer.elsewhere')}>
        <button
          type="button"
          className={action}
          onClick={() => {
            act({ type: 'takeover' });
          }}
        >
          {t('timer.takeover')}
        </button>
      </Row>
    );
  }
  if (!session || session.state === 'idle') {
    return choosing ? (
      <TimerStart
        initialMode={config.mode}
        initialFocus={config.focusMin}
        initialRest={config.shortBreakMin}
        extendMin={config.flexExtendMin}
        onCancel={() => {
          setChoosing(false);
        }}
        onStart={async (choice) => {
          await updateStudyConfig((cfg) => ({
            ...cfg,
            timer: {
              ...cfg.timer,
              mode: choice.mode,
              focusMin: choice.focusMin,
              shortBreakMin: choice.restMin,
            },
          }));
          // El modo queda fijo por sesión: una en reposo con otro modo se cierra antes.
          if (session && session.mode !== choice.mode) await dispatchTimer({ type: 'stop' });
          const result = await dispatchTimer({ type: 'start' });
          if (result) onResult(result);
          setChoosing(false);
        }}
      />
    ) : (
      <div>
        <button
          type="button"
          className={`${action} gap-1.5 bg-blush pr-4 pl-3`}
          onClick={() => {
            setChoosing(true);
          }}
        >
          <ClockIcon className="size-5" />
          {t('timer.start')}
        </button>
      </div>
    );
  }
  if (session.state === 'break_short' || session.state === 'break_long') return null;

  if (session.state === 'paused') {
    const expired = isPauseExpired(session, at, config);
    return (
      <div className="flex flex-col gap-2">
        <Row label={t('timer.paused')} clock={formatClock(remainingMs(session, at))}>
          <button
            type="button"
            className={strong}
            onClick={() => {
              act({ type: 'resume' });
            }}
          >
            {t('timer.resume')}
          </button>
        </Row>
        {/* §3: pasado el límite, "Reanudar" sigue con lo que faltaba y "Bloque nuevo" empieza otro. */}
        <Notice text={expired ? t('timer.pauseExpired', { minutes: config.pauseTimeoutMin }) : ''}>
          {expired ? (
            <button
              type="button"
              className={action}
              onClick={() => {
                act({ type: 'start' });
              }}
            >
              {t('timer.newBlock')}
            </button>
          ) : null}
          <button
            type="button"
            className={action}
            onClick={() => {
              act({ type: 'stop' });
            }}
          >
            {t('timer.stop')}
          </button>
        </Notice>
      </div>
    );
  }

  // Enfoque: en libre se ve el tiempo activo; en los otros, lo que falta (§3).
  const left = remainingMs(session, at);
  const clock = session.mode === 'free' ? activeMs(session, at) : left;
  const reached = session.mode === 'flexible' && left === 0;
  return (
    <div className="flex flex-col gap-2">
      <Row label={t('timer.focus')} clock={formatClock(clock)}>
        <button
          type="button"
          className={action}
          onClick={() => {
            act({ type: 'pause' });
          }}
        >
          {t('timer.pause')}
        </button>
        {breakAfterCard?.pending ? null : (
          <button
            type="button"
            className={action}
            onClick={() => {
              if (breakAfterCard) breakAfterCard.request();
              else act({ type: 'takeBreak' });
            }}
          >
            {t('timer.takeBreak')}
          </button>
        )}
      </Row>
      {breakAfterCard?.pending ? (
        <Notice text={t('timer.breakAfterCard')}>
          <button type="button" className={action} onClick={breakAfterCard.cancel}>
            {t('timer.cancelBreak')}
          </button>
        </Notice>
      ) : null}
      {reached ? (
        <Notice text={t('timer.blockDone')}>
          {session.extendedThisBlock ? null : (
            <button
              type="button"
              className={action}
              onClick={() => {
                act({ type: 'extend' });
              }}
            >
              {t('timer.extend', { minutes: config.flexExtendMin })}
            </button>
          )}
        </Notice>
      ) : null}
    </div>
  );
}

function Row({
  label,
  clock,
  children,
}: {
  readonly label: string;
  readonly clock?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-2 rounded-(--radius-card) bg-surface shadow-card py-1 pr-1 pl-4">
      <p className="m-0 flex items-baseline gap-2" aria-live="off">
        <span className="text-caption text-muted">{label}</span>
        {clock ? <span className="font-semibold tabular-nums">{clock}</span> : null}
      </p>
      <div className="flex shrink-0 gap-1">{children}</div>
    </div>
  );
}

/** Avisos suaves (§3, R8): informan y ofrecen, nunca cortan. */
function Notice({ text, children }: { readonly text: string; readonly children?: React.ReactNode }) {
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 px-1 text-caption">
      <span>{text}</span>
      <div className="flex gap-1">{children}</div>
    </div>
  );
}

/** `null` = lo escrito está fuera del rango de R7. */
interface Rhythm {
  readonly focusMin: number | null;
  readonly restMin: number | null;
}

const isPreset = (preset: (typeof TIMER_PRESETS)[number], rhythm: Rhythm) =>
  preset.focusMin === rhythm.focusMin && preset.shortBreakMin === rhythm.restMin;

interface StartChoice {
  readonly mode: TimerMode;
  readonly focusMin: number;
  readonly restMin: number;
}

/** R7, R8 y R17: el modo y el ritmo los elige ella; ningún ritmo se presenta como óptimo. */
function TimerStart({
  initialMode,
  initialFocus,
  initialRest,
  extendMin,
  onStart,
  onCancel,
}: {
  readonly initialMode: TimerMode;
  readonly initialFocus: number;
  readonly initialRest: number;
  readonly extendMin: number;
  readonly onStart: (choice: StartChoice) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState(initialMode);
  const [rhythm, setRhythm] = useState<Rhythm>({ focusMin: initialFocus, restMin: initialRest });
  // R7: un ritmo que no es preset abre directo en "Otro".
  const [custom, setCustom] = useState(() => !TIMER_PRESETS.some((p) => isPreset(p, rhythm)));
  const [busy, setBusy] = useState(false);
  const { focusMin, restMin } = rhythm;
  const ready = focusMin !== null && restMin !== null;
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (focusMin === null || restMin === null) return;
    setBusy(true);
    void onStart({ mode, focusMin, restMin }).finally(() => {
      setBusy(false);
    });
  };
  return (
    <form
      className="flex flex-col gap-4 rounded-(--radius-card) bg-surface shadow-card p-4"
      onSubmit={submit}
    >
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 font-semibold">{t('timer.modeLabel')}</legend>
        {MODES.map((value) => (
          <label key={value} className="flex min-h-11 items-start gap-3">
            <input
              type="radio"
              name="timer-mode"
              className="mt-1 size-5 shrink-0"
              checked={mode === value}
              onChange={() => {
                setMode(value);
              }}
            />
            <span className="flex flex-col">
              <span>{t(`timer.mode.${value}`)}</span>
              <span className="text-caption text-muted">
                {t(`timer.modeHint.${value}`, { minutes: extendMin })}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 font-semibold">{t('timer.rhythmLabel')}</legend>
        <div className="grid grid-cols-3 gap-2">
          {TIMER_PRESETS.map((preset) => {
            const selected = !custom && isPreset(preset, rhythm);
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={selected}
                className={`${choice} ${selected ? 'border-primary bg-primary/20' : 'border-line-strong'}`}
                onClick={() => {
                  setCustom(false);
                  setRhythm({ focusMin: preset.focusMin, restMin: preset.shortBreakMin });
                }}
              >
                {t('timer.rhythm', { focus: preset.focusMin, rest: preset.shortBreakMin })}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={custom}
            className={`${choice} ${custom ? 'border-primary bg-primary/20' : 'border-line-strong'}`}
            onClick={() => {
              setCustom(true);
            }}
          >
            {t('timer.custom')}
          </button>
        </div>
        {custom ? (
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label={t('timer.customFocus')}
              defaultValue={focusMin ?? initialFocus}
              min={TIMER_RANGES.focusMin.min}
              max={TIMER_RANGES.focusMin.max}
              onChange={(value) => {
                setRhythm((prev) => ({ ...prev, focusMin: value }));
              }}
            />
            <NumberField
              label={t('timer.customRest')}
              defaultValue={restMin ?? initialRest}
              min={TIMER_RANGES.shortBreakMin.min}
              max={TIMER_RANGES.shortBreakMin.max}
              onChange={(value) => {
                setRhythm((prev) => ({ ...prev, restMin: value }));
              }}
            />
          </div>
        ) : null}
        <p className="m-0 text-caption text-muted">
          {t('timer.rhythmHint')} <SourceLink source={22} />
        </p>
      </fieldset>
      <div className="flex flex-col gap-2">
        <button type="submit" className={`${strong} min-h-14 w-full`} disabled={busy || !ready}>
          {focusMin === null ? t('timer.startBlockPlain') : t('timer.startBlock', { minutes: focusMin })}
        </button>
        <button type="button" className={`${action} w-full`} onClick={onCancel}>
          {t('timer.cancel')}
        </button>
      </div>
    </form>
  );
}

/** §3 y UX7: mensaje neutro; lo declarado se guarda como `manual` y no se mezcla. */
export function AwayPrompt({
  sessionId,
  interrupted,
  now,
  onDone,
}: {
  readonly sessionId: string;
  readonly interrupted: TimerBlockRecord;
  readonly now: number;
  readonly onDone: () => void;
}) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const [minutes, setMinutes] = useState('');
  const [invalid, setInvalid] = useState(false);
  const max = Math.max(1, Math.floor((now - interrupted.endedAt) / MINUTE_MS));
  const save = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    recordManualMinutes({ sessionId, interrupted, minutes: Number(minutes) })
      .then(onDone)
      .catch(() => {
        setInvalid(true);
      });
  };
  return (
    <section role="status" className="flex flex-col gap-3 rounded-(--radius-card) bg-surface shadow-card p-4">
      <p className="m-0">
        {t('timer.away.title')} {t('timer.away.question')}
      </p>
      {asking ? (
        <form className="flex flex-col gap-2" onSubmit={save} noValidate>
          <label className="flex flex-col gap-1">
            <span>{t('timer.away.minutes')}</span>
            <input
              className={`min-h-11 rounded-(--radius-card) border-2 border-line-strong bg-bg px-4 ${focus}`}
              inputMode="numeric"
              enterKeyHint="done"
              value={minutes}
              onChange={(event) => {
                setMinutes(event.target.value);
              }}
            />
          </label>
          {invalid ? (
            <p role="alert" className="m-0 text-caption">
              {t('timer.away.invalid', { max })}
            </p>
          ) : null}
          <button type="submit" className={`${strong} w-full`}>
            {t('timer.away.save')}
          </button>
        </form>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={`${action} border-2 border-line-strong`} onClick={onDone}>
            {t('timer.away.no')}
          </button>
          <button
            type="button"
            className={strong}
            onClick={() => {
              setAsking(true);
            }}
          >
            {t('timer.away.yes')}
          </button>
        </div>
      )}
    </section>
  );
}
