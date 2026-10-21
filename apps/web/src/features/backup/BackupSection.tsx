import { type Backup, parseBackup } from '@estudio/shared';
import { type ChangeEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { accountUserId } from '@/features/auth';
import { importBackup, type ImportSummary } from './commands';
import { downloadBackup, downloadSpreadsheets } from './files';
import { useBackupInfo } from './queries';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const button = `min-h-11 w-full rounded-(--radius-card) border border-muted/40 px-4 text-text disabled:opacity-60 ${focus}`;
const primary = `min-h-11 w-full rounded-(--radius-card) bg-primary px-4 font-medium text-primary-contrast disabled:opacity-60 ${focus}`;

type Message =
  | { readonly kind: 'error'; readonly key: 'invalid' | 'newer' | 'failed' | 'export' }
  | { readonly kind: 'done'; readonly summary: ImportSummary };

/**
 * QUALITY QA7, Ajustes › Respaldo: descargar el respaldo (JSON) y las planillas (CSV), e
 * importar un respaldo tras ver qué trae. Todo funciona sin red (FE7). Va dentro del formulario
 * de Ajustes: solo botones `type="button"`.
 */
export function BackupSection() {
  const { t, i18n } = useTranslation();
  const ids = useId();
  const info = useBackupInfo();
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<{
    readonly backup: Backup;
    readonly sameAccount: boolean;
  } | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  const run = async (task: () => Promise<void>, failure: 'failed' | 'export') => {
    setBusy(true);
    setMessage(null);
    try {
      await task();
    } catch {
      setMessage({ kind: 'error', key: failure });
    } finally {
      setBusy(false);
    }
  };
  const download = (which: 'backup' | 'sheets') =>
    run(async () => {
      const userId = await accountUserId();
      if (!userId) throw new Error('no_account');
      await (which === 'backup' ? downloadBackup(userId) : downloadSpreadsheets(userId));
    }, 'export');

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = ''; // elegir el mismo archivo otra vez vuelve a leerlo
    if (!file) return;
    setMessage(null);
    setCandidate(null);
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setMessage({ kind: 'error', key: 'invalid' });
      return;
    }
    const parsed = parseBackup(raw); // AG2
    if ('problem' in parsed) {
      setMessage({ kind: 'error', key: parsed.problem });
      return;
    }
    setCandidate({ backup: parsed.backup, sameAccount: parsed.backup.userId === (await accountUserId()) });
  };

  const confirm = (backup: Backup) =>
    run(async () => {
      const userId = await accountUserId();
      if (!userId) throw new Error('no_account');
      const summary = await importBackup(backup, { userId });
      setCandidate(null);
      setMessage({ kind: 'done', summary });
    }, 'failed');

  const date = (ms: number) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(ms);

  return (
    <section aria-labelledby={`${ids}-title`} className="flex flex-col gap-3">
      <h2 id={`${ids}-title`} className="m-0 text-body font-semibold">
        {t('backup.title')}
      </h2>
      <p className="m-0 text-caption text-muted">{t('backup.body')}</p>
      {info && info.pendingImages > 0 ? (
        <p className="m-0 text-caption">{t('backup.pendingImages', { count: info.pendingImages })}</p>
      ) : null}
      <button
        type="button"
        className={button}
        disabled={busy}
        onClick={() => {
          void download('backup');
        }}
      >
        {t('backup.download')}
      </button>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          className={button}
          disabled={busy}
          aria-describedby={`${ids}-sheets`}
          onClick={() => {
            void download('sheets');
          }}
        >
          {t('backup.spreadsheets')}
        </button>
        <span id={`${ids}-sheets`} className="text-caption text-muted">
          {t('backup.spreadsheetsHint')}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor={`${ids}-file`}
          className={`${button} inline-flex cursor-pointer items-center justify-center focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary`}
        >
          {t('backup.import')}
        </label>
        <input
          id={`${ids}-file`}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          aria-describedby={`${ids}-import`}
          disabled={busy}
          onChange={(event) => {
            void choose(event);
          }}
        />
        <span id={`${ids}-import`} className="text-caption text-muted">
          {t('backup.importHint')}
        </span>
      </div>

      {candidate ? (
        <div
          role="group"
          aria-labelledby={`${ids}-candidate`}
          className="flex flex-col gap-2 rounded-(--radius-card) bg-surface p-4"
        >
          <p id={`${ids}-candidate`} className="m-0 font-semibold">
            {t('backup.confirm.title', { date: date(candidate.backup.exportedAt) })}
          </p>
          <p className="m-0">
            {t('backup.confirm.counts', {
              notes: candidate.backup.entities.note.length,
              reviews: candidate.backup.entities.reviewLog.length,
              exams: candidate.backup.entities.exam.length,
            })}
          </p>
          {candidate.sameAccount ? null : (
            <p className="m-0 text-caption">{t('backup.confirm.otherAccount')}</p>
          )}
          <button
            type="button"
            className={primary}
            disabled={busy}
            onClick={() => {
              void confirm(candidate.backup);
            }}
          >
            {t(busy ? 'backup.confirm.busy' : 'backup.confirm.go')}
          </button>
          <button
            type="button"
            className={`min-h-11 w-full rounded-(--radius-card) px-4 text-primary ${focus}`}
            disabled={busy}
            onClick={() => {
              setCandidate(null);
            }}
          >
            {t('backup.confirm.cancel')}
          </button>
        </div>
      ) : null}

      {message?.kind === 'error' ? (
        <p role="alert" className="m-0 text-caption">
          {t(`backup.error.${message.key}`)}
        </p>
      ) : null}
      {message?.kind === 'done' ? (
        <p role="status" className="m-0 text-caption">
          {t('backup.done', { notes: message.summary.notes, reviews: message.summary.reviews })}
          {message.summary.imagesMissing > 0
            ? ` ${t('backup.doneImagesMissing', { count: message.summary.imagesMissing })}`
            : ''}
        </p>
      ) : null}
    </section>
  );
}
