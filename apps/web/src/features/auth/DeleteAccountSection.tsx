import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ApiError } from '@/lib/api';
import { useOnline } from '@/lib/use-online';
import { deleteAccount } from './session';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `min-h-11 w-full rounded-(--radius-card) border-2 border-line-strong bg-bg px-4 text-text ${focus}`;
// UX1: --color-danger solo para la acción destructiva.
const danger = `min-h-11 w-full rounded-(--radius-card) border-2 border-danger px-4 font-bold text-danger disabled:opacity-60 ${focus}`;

const errorKey = (error: unknown) => {
  if (error instanceof ApiError && error.code === 'forbidden')
    return 'account.delete.error.forbidden' as const;
  if (error instanceof ApiError && error.code === 'rate_limited')
    return 'account.delete.error.rateLimited' as const;
  return 'account.delete.error.generic' as const;
};

/**
 * QUALITY QA6: ella decide sobre sus datos. Borrar la cuenta pide confirmación con su
 * contraseña y conexión (FE7: sin red se muestra "Requiere conexión", no un error). Va dentro
 * del formulario de Ajustes, así que no usa `<form>` propio: Enter en la contraseña confirma
 * aquí y no guarda los ajustes.
 */
export function DeleteAccountSection() {
  const { t } = useTranslation();
  const ids = useId();
  const navigate = useNavigate();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !online || password === '') return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(password);
      await navigate('/login', { replace: true, state: { notice: 'accountDeleted' } });
    } catch (caught) {
      setError(t(errorKey(caught)));
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${ids}-title`} className="flex flex-col gap-3">
      <h2 id={`${ids}-title`} className="m-0 text-body font-semibold">
        {t('account.delete.title')}
      </h2>
      <p className="m-0 text-caption text-muted">{t('account.delete.body')}</p>
      {!open ? (
        <button
          type="button"
          className={danger}
          disabled={!online}
          aria-describedby={online ? undefined : `${ids}-offline`}
          onClick={() => {
            setOpen(true);
          }}
        >
          {t('account.delete.start')}
        </button>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span>{t('account.delete.password')}</span>
            <input
              type="password"
              autoComplete="current-password"
              className={field}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                void submit();
              }}
            />
          </label>
          {error ? (
            <p role="alert" className="m-0 text-caption">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            className={danger}
            disabled={busy || !online || password === ''}
            aria-describedby={online ? undefined : `${ids}-offline`}
            onClick={() => {
              void submit();
            }}
          >
            {t('account.delete.confirm')}
          </button>
          <button
            type="button"
            className={`min-h-11 w-full rounded-(--radius-card) px-4 text-primary ${focus}`}
            onClick={() => {
              setOpen(false);
              setPassword('');
              setError(null);
            }}
          >
            {t('account.delete.cancel')}
          </button>
        </div>
      )}
      {!online ? (
        <p id={`${ids}-offline`} className="m-0 text-caption text-muted">
          {t('account.delete.offline')}
        </p>
      ) : null}
    </section>
  );
}
