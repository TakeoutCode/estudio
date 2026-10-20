import { CredentialsSchema } from '@estudio/shared';
import { type SubmitEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ApiError } from '@/lib/api';
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
  'min-h-11 w-full rounded-(--radius-card) border border-muted/40 bg-bg px-4 text-text focus-visible:outline-2 focus-visible:outline-primary';

export function LoginScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = CredentialsSchema.safeParse({ email: form.get('email'), password: form.get('password') });
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
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-4">
      <h1 className="m-0 text-title font-semibold">
        {t(mode === 'login' ? 'auth.login.title' : 'auth.register.title')}
      </h1>
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
        <label className="flex flex-col gap-1">
          <span>{t('auth.email')}</span>
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
          <span>{t('auth.password')}</span>
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
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 rounded-(--radius-card) bg-primary px-4 text-primary-contrast disabled:opacity-60"
        >
          {t(mode === 'login' ? 'auth.login.submit' : 'auth.register.submit')}
        </button>
      </form>
      <button
        type="button"
        className="min-h-11 text-primary"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setError(null);
        }}
      >
        {t(mode === 'login' ? 'auth.login.switch' : 'auth.register.switch')}
      </button>
    </main>
  );
}
