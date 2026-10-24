import { CredentialsSchema } from '@estudio/shared';
import { type SubmitEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { ApiError } from '@/lib/api';
import { useOnline } from '@/lib/use-online';
import { BowIcon, HeartIcon, SparkleIcon } from '@/ui/icons';
import { AccountMismatchError } from './commands';
import { login, register } from './session';

type Mode = 'login' | 'register';

const errorKey = (error: unknown, mode: Mode) => {
  if (error instanceof AccountMismatchError) return 'auth.error.accountMismatch' as const;
  if (error instanceof ApiError) {
    if (error.code === 'network') return 'auth.error.offline' as const;
    if (error.code === 'rate_limited') return 'auth.error.rateLimited' as const;
    if (error.code === 'unauthorized') {
      return mode === 'register' ? ('auth.error.registerFailed' as const) : ('auth.error.invalid' as const);
    }
  }
  return 'auth.error.generic' as const;
};

const field =
  'min-h-11 w-full rounded-(--radius-card) border-2 border-line-strong bg-bg px-4 text-text focus-visible:outline-2 focus-visible:outline-primary';

export function LoginScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // QA6: al llegar después de borrar la cuenta, se confirma qué pasó.
  const deleted = (useLocation().state as { notice?: string } | null)?.notice === 'accountDeleted';
  const [mode, setMode] = useState<Mode>('login');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // FE7: entrar necesita red; sin ella el botón se deshabilita y lo dice, sin un error.
  const online = useOnline();

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = CredentialsSchema.safeParse({ email: form.get('email'), password: form.get('password') });
    if (!online) return;
    if (!parsed.success) {
      setError(t('auth.error.format'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await (mode === 'login' ? login(parsed.data) : register(parsed.data));
      await navigate('/', { replace: true });
    } catch (caught) {
      setError(t(errorKey(caught, mode)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 py-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="relative mb-2 flex size-28 items-center justify-center rounded-full bg-surface text-bow shadow-card">
          <BowIcon className="w-18" />
          <HeartIcon className="absolute top-2 right-1 size-6 rotate-12 text-bow" />
          <SparkleIcon className="absolute bottom-3 left-0 size-5 text-line-strong" />
        </span>
        <p className="m-0 text-display leading-tight font-extrabold">{t('app.name')}</p>
        <p className="m-0 text-muted">{t('app.tagline')}</p>
      </div>
      {deleted ? (
        <p role="status" className="m-0 rounded-(--radius-card) bg-blush px-4 py-3 text-caption">
          {t('auth.accountDeleted')}
        </p>
      ) : null}
      <form
        className="flex flex-col gap-4 rounded-(--radius-card) bg-surface p-5 shadow-card"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <h1 className="m-0 text-title font-extrabold">
          {t(mode === 'login' ? 'auth.login.title' : 'auth.register.title')}
        </h1>
        <label className="flex flex-col gap-1">
          <span className="font-bold">{t('auth.email')}</span>
          <input
            className={field}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-bold">{t('auth.password')}</span>
          <input
            className={field}
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={12}
            required
          />
        </label>
        {error ? (
          <p role="alert" className="m-0 text-caption text-text">
            {error}
          </p>
        ) : null}
        {online ? null : (
          <p role="status" className="m-0 text-caption text-text">
            {t('auth.error.offline')}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !online}
          className="mt-1 min-h-14 rounded-(--radius-card) bg-primary px-4 font-bold text-primary-contrast candy disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t(mode === 'login' ? 'auth.login.submit' : 'auth.register.submit')}
        </button>
      </form>
      <button
        type="button"
        className="press min-h-11 rounded-(--radius-card) font-bold text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setError(null);
        }}
      >
        {t(mode === 'login' ? 'auth.login.switch' : 'auth.register.switch')}
      </button>
    </div>
  );
}
