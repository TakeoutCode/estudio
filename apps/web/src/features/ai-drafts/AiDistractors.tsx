import { AI_DISTRACTORS_MAX } from '@estudio/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/lib/api';
import { useOnline } from '@/lib/use-online';
import {
  type AiDistractorsDraft,
  markAiDistractorsUsed,
  rejectAiDraft,
  requestAiDistractors,
} from './commands';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const quiet = `inline-flex min-h-11 items-center px-3 text-primary disabled:opacity-60 ${focus}`;
const textLink = `-ml-2 inline-flex min-h-11 items-center self-start px-2 text-primary disabled:opacity-60 ${focus}`;

type Status = 'idle' | 'busy' | 'quota' | 'offline' | 'failed';

/** LD §1: de 3 a 5 opciones; con la correcta, caben 4 distractores. */
const MAX_OPTIONS = AI_DISTRACTORS_MAX + 1;

/** El distractor elegido va a la primera opción vacía que no es la correcta, o al final. */
export function withDistractor(options: readonly string[], correct: number | null, option: string): string[] {
  const empty = options.findIndex((o, i) => i !== correct && o.trim() === '');
  if (empty >= 0) return options.map((o, i) => (i === empty ? option : o));
  return options.length < MAX_OPTIONS ? [...options, option] : [...options];
}

/**
 * LD14: distractores con IA para una pregunta de opción múltiple (en una tarjeta o en una
 * subpregunta de caso clínico). Requiere la pregunta y la opción correcta. Ella elige cada
 * sugerencia, que pasa a una opción editable; nada se guarda en su nota hasta que ella la
 * guarda (LD16), y se le pide revisar que ninguna sea también correcta.
 */
export function AiDistractors({
  deckId,
  question,
  options,
  correct,
  context = null,
  onOptions,
}: {
  readonly deckId: string;
  readonly question: string;
  readonly options: readonly string[];
  /** La opción marcada como correcta, o null si todavía no hay. */
  readonly correct: number | null;
  /** En un caso clínico, la viñeta. */
  readonly context?: string | null;
  readonly onOptions: (options: string[]) => void;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const [status, setStatus] = useState<Status>('idle');
  const [draft, setDraft] = useState<AiDistractorsDraft | null>(null);
  const [used, setUsed] = useState<readonly string[]>([]);
  const correctText = correct === null ? '' : (options[correct] ?? '').trim();
  const ready = question.trim() !== '' && correctText !== '';
  const canAdd = options.some((o, i) => i !== correct && o.trim() === '') || options.length < MAX_OPTIONS;
  const busy = status === 'busy';

  const ask = () => {
    if (!ready || busy) return;
    setStatus('busy');
    requestAiDistractors(deckId, {
      question: question.trim(),
      correct: correctText,
      // Las otras que ya escribió, para no repetirlas.
      existing: options
        .filter((_, i) => i !== correct)
        .map((o) => o.trim())
        .filter((o) => o !== '')
        .slice(0, AI_DISTRACTORS_MAX),
      context: context?.trim() ? context.trim() : null,
    })
      .then((saved) => {
        setDraft(saved);
        setUsed([]);
        setStatus('idle');
      })
      .catch((error: unknown) => {
        const code = error instanceof ApiError ? error.code : null;
        setStatus(code === 'ai_quota_exceeded' ? 'quota' : code === 'network' ? 'offline' : 'failed');
      });
  };
  const use = (option: string) => {
    if (!draft) return;
    onOptions(withDistractor(options, correct, option));
    setUsed((current) => [...current, option]);
    void markAiDistractorsUsed(draft.id);
  };
  const dismiss = () => {
    // Si ya usó alguno quedó `accepted`; si no, se descarta sin borrarse (LD16).
    if (draft && used.length === 0) void rejectAiDraft(draft.id);
    setDraft(null);
    setUsed([]);
  };

  if (draft) {
    return (
      <section
        className="flex flex-col gap-2 rounded-(--radius-card) bg-blush p-3"
        aria-label={t('ai.distractors.title')}
      >
        <p className="m-0 font-bold">{t('ai.distractors.title')}</p>
        <p className="m-0 text-caption">{t('ai.distractors.check')}</p>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {draft.draft.distractors.map((option) => {
            const taken = used.includes(option);
            return (
              <li key={option} className="flex items-center justify-between gap-2">
                <span className="min-w-0 wrap-break-word">{option}</span>
                <button
                  type="button"
                  className={quiet}
                  disabled={taken || !canAdd}
                  aria-label={t(taken ? 'ai.distractors.usedNamed' : 'ai.distractors.useNamed', { option })}
                  onClick={() => {
                    use(option);
                  }}
                >
                  {t(taken ? 'ai.distractors.used' : 'ai.distractors.use')}
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className={textLink} onClick={dismiss}>
          {t(used.length > 0 ? 'ai.distractors.close' : 'ai.distractors.dismiss')}
        </button>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button type="button" className={textLink} disabled={!online || !ready || busy} onClick={ask}>
        {t(busy ? 'ai.distractors.asking' : 'ai.distractors.ask')}
      </button>
      {!online ? (
        <p className="m-0 text-caption text-muted">{t('ai.needsConnection')}</p>
      ) : (
        <p className="m-0 text-caption text-muted">
          {t(ready ? 'ai.distractors.privacy' : 'ai.distractors.needs')}
        </p>
      )}
      {status === 'quota' ? (
        <p role="alert" className="m-0 text-caption">
          {t('ai.quota')}
        </p>
      ) : status === 'offline' ? (
        <p role="alert" className="m-0 text-caption">
          {t('ai.offline')}
        </p>
      ) : status === 'failed' ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-caption">
          <span>{t('ai.distractors.failed')}</span>
          <button type="button" className={quiet} onClick={ask}>
            {t('error.retry')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
