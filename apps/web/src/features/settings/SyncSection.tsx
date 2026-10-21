import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requestPersistentStorage, type StorageStatus, storageStatus } from '@/lib/storage';
import { useSyncStatus } from '@/sync';
import { discardRejected, retryRejected } from './commands';
import { type OutboxSummary, useOutboxSummary, useProfile } from './queries';

type OutboxEntry = OutboxSummary['rejected'][number];

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const quiet = `-ml-3 inline-flex min-h-11 items-center self-start px-3 text-primary disabled:opacity-60 ${focus}`;
const outline = `inline-flex min-h-11 items-center justify-center rounded-(--radius-card) border-2 border-primary px-4 font-bold text-primary disabled:opacity-60 ${focus}`;

/**
 * SYNC SY8 y FRONTEND FE7: cómo va la sync, lo que espera por enviarse, lo que el servidor
 * rechazó (nunca se borra sin avisar) y cuánto ocupa la app en este dispositivo.
 */
export function SyncSection() {
  const { t } = useTranslation();
  const id = useId();
  const outbox = useOutboxSummary();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="m-0 text-body font-semibold">
        {t('sync.title')}
      </h2>
      <SyncState />
      {outbox && outbox.pending > 0 ? (
        <p className="m-0 text-caption text-muted">{t('sync.pending', { count: outbox.pending })}</p>
      ) : null}
      {outbox && outbox.rejected.length > 0 ? <Rejected entries={outbox.rejected} /> : null}
      <Storage />
    </section>
  );
}

function SyncState() {
  const { t, i18n } = useTranslation();
  const state = useSyncStatus((s) => s.state);
  const lastSyncedAt = useSyncStatus((s) => s.lastSyncedAt);
  const timeZone = useProfile()?.timeZone;
  const time = (ms: number) =>
    new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short', timeZone }).format(ms);
  const text =
    state === 'idle'
      ? lastSyncedAt === null
        ? t('sync.state.waiting')
        : t('sync.state.idle', { time: time(lastSyncedAt) })
      : t(`sync.state.${state}`);
  return (
    <p role="status" className="m-0">
      {text}
    </p>
  );
}

function Rejected({ entries }: { readonly entries: readonly OutboxEntry[] }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-(--radius-card) bg-blush p-4">
      <p className="m-0">{t('sync.rejected.title', { count: entries.length })}</p>
      <p className="m-0 text-caption">{t('sync.rejected.hint')}</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {entries.map((entry) => (
          <RejectedRow key={entry.mutationId} entry={entry} />
        ))}
      </ul>
      <button
        type="button"
        className={`${outline} self-start bg-surface`}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void retryRejected().finally(() => {
            setBusy(false);
          });
        }}
      >
        {t('sync.rejected.retry')}
      </button>
    </div>
  );
}

function RejectedRow({ entry }: { readonly entry: OutboxEntry }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const timeZone = useProfile()?.timeZone;
  const [confirming, setConfirming] = useState(false);
  const when = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(entry.createdAt);
  return (
    <li className="flex flex-col gap-1 rounded-(--radius-card) bg-surface px-4 py-2">
      <span className="font-bold">{t(`sync.entity.${entry.entity}`)}</span>
      <span className="text-caption text-muted">
        {t('sync.rejected.when', { date: when })} · {t(`sync.reason.${reasonKey(entry.code)}`)}
      </span>
      {confirming ? (
        <div role="alertdialog" aria-labelledby={`${id}-confirm`} className="flex flex-col gap-2 pt-1">
          <p id={`${id}-confirm`} className="m-0 text-caption">
            {t('sync.rejected.confirmDiscard')}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={`min-h-11 rounded-(--radius-card) border-2 border-danger px-4 font-bold text-danger ${focus}`}
              onClick={() => {
                void discardRejected(entry.mutationId);
              }}
            >
              {t('sync.rejected.discard')}
            </button>
            <button
              type="button"
              className={quiet}
              onClick={() => {
                setConfirming(false);
              }}
            >
              {t('sync.rejected.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={`${quiet} text-danger`}
          onClick={() => {
            setConfirming(true);
          }}
        >
          {t('sync.rejected.discard')}
        </button>
      )}
    </li>
  );
}

const KNOWN_REASONS = ['validation_failed', 'not_found', 'forbidden', 'conflict'] as const;
type Reason = (typeof KNOWN_REASONS)[number] | 'other';
const reasonKey = (code: OutboxEntry['code']): Reason =>
  KNOWN_REASONS.find((known) => known === code) ?? 'other';

/** FE7: cuánto ocupa la app aquí y si el navegador puede borrar datos para hacer espacio. */
function Storage() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [asked, setAsked] = useState(false);
  const refresh = useCallback(() => {
    void storageStatus().then(setStatus);
  }, []);
  useEffect(refresh, [refresh]);
  if (!status) return null;
  const size = (bytes: number) => {
    const gb = bytes >= 1e9;
    return new Intl.NumberFormat(i18n.language, {
      style: 'unit',
      unit: gb ? 'gigabyte' : 'megabyte',
      maximumFractionDigits: 1,
    }).format(bytes / (gb ? 1e9 : 1e6));
  };
  return (
    <div className="flex flex-col gap-1 pt-2">
      {status.usage !== null && status.quota !== null ? (
        <p className="m-0 text-caption text-muted">
          {t('sync.storage.usage', { used: size(status.usage), quota: size(status.quota) })}
        </p>
      ) : null}
      {status.persisted === true ? (
        <p className="m-0 text-caption text-muted">{t('sync.storage.persisted')}</p>
      ) : status.persisted === false ? (
        <>
          <p className="m-0 text-caption text-muted">
            {t(asked ? 'sync.storage.denied' : 'sync.storage.notPersisted')}
          </p>
          <button
            type="button"
            className={quiet}
            onClick={() => {
              setAsked(true);
              void requestPersistentStorage().then(refresh);
            }}
          >
            {t('sync.storage.ask')}
          </button>
        </>
      ) : null}
    </div>
  );
}
