import type { AiExplanationCheck } from '@estudio/shared';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/lib/api';
import { useOnline } from '@/lib/use-online';
import { requestExplanationCheck } from './commands';

/** Lo que admite el pedido (`AiExplanationCheckRequestSchema`). */
const LIMITS = { question: 8000, key: 2000, explanation: 2000 } as const;

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `w-full rounded-(--radius-card) border-2 border-line-strong bg-bg px-4 py-2 text-text ${focus}`;
const primary = `inline-flex min-h-14 w-full items-center justify-center rounded-(--radius-card) bg-primary px-4 font-bold text-primary-contrast candy disabled:opacity-60 ${focus}`;
const outline = `inline-flex min-h-11 w-full items-center justify-center rounded-(--radius-card) border-2 border-primary px-4 font-bold text-primary disabled:opacity-60 ${focus}`;

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly check: AiExplanationCheck }
  | { readonly kind: 'quota' | 'offline' | 'failed' };

/**
 * STUDY-METHODS §1 (elaboración en tarjetas con fallos) y LD14: tras olvidar una tarjeta que ya
 * sabía, "Explícalo con tus palabras". Es opcional; con red, la IA dice si su explicación es
 * correcta frente a la tarjeta. Nada de esto toca FSRS: la calificación ya quedó guardada. Los
 * botones van al final y no en una barra fija, para que el teclado de iOS no los tape (UX2).
 */
export function LapseExplain({
  cardId,
  question,
  answerKey,
  onDone,
}: {
  readonly cardId: string;
  readonly question: string;
  readonly answerKey: string;
  readonly onDone: () => void;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const online = useOnline();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const check = () => {
    setStatus({ kind: 'busy' });
    requestExplanationCheck(cardId, {
      question: question.slice(0, LIMITS.question),
      key: answerKey.slice(0, LIMITS.key),
      explanation: text.trim(),
    })
      .then((result) => {
        setStatus({ kind: 'done', check: result });
      })
      .catch((error: unknown) => {
        const code = error instanceof ApiError ? error.code : null;
        setStatus({
          kind: code === 'ai_quota_exceeded' ? 'quota' : code === 'network' ? 'offline' : 'failed',
        });
      });
  };

  return (
    <section aria-labelledby={`${ids}-title`} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-(--radius-card) bg-surface p-5 shadow-card">
        <h2 id={`${ids}-title`} className="m-0 text-title font-extrabold">
          {t('lapse.title')}
        </h2>
        <p className="m-0 text-muted">{t('lapse.hint')}</p>
        <p className="m-0 whitespace-pre-wrap">{question}</p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-text`} className="font-semibold">
          {t('lapse.label')}
        </label>
        <textarea
          id={`${ids}-text`}
          className={field}
          rows={4}
          maxLength={LIMITS.explanation}
          // UX2: la terminología anatómica choca con el autocorrector.
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          readOnly={status.kind === 'busy' || status.kind === 'done'}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </div>
      {status.kind === 'done' ? <CheckView check={status.check} /> : null}
      {status.kind === 'quota' || status.kind === 'offline' || status.kind === 'failed' ? (
        <p role="alert" className="m-0 text-caption">
          {t(`lapse.error.${status.kind}`)}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        {status.kind === 'done' ? null : (
          <>
            <button
              type="button"
              className={outline}
              disabled={!online || status.kind === 'busy' || text.trim() === ''}
              onClick={check}
            >
              {t(status.kind === 'busy' ? 'lapse.checking' : 'lapse.check')}
            </button>
            {online ? null : <p className="m-0 text-caption text-muted">{t('ai.needsConnection')}</p>}
          </>
        )}
        <button type="button" className={primary} disabled={status.kind === 'busy'} onClick={onDone}>
          {t('lapse.next')}
        </button>
      </div>
    </section>
  );
}

function CheckView({ check }: { readonly check: AiExplanationCheck }) {
  const { t } = useTranslation();
  const lists = [
    ['missing', check.missing],
    ['misconceptions', check.misconceptions],
  ] as const;
  return (
    <section
      aria-label={t('lapse.result')}
      className="flex flex-col gap-2 rounded-(--radius-card) bg-blush p-4"
    >
      <p role="status" className="m-0 font-bold">
        {t(`lapse.verdict.${check.verdict}`)}
      </p>
      {lists.map(([key, items]) =>
        items.length > 0 ? (
          <div key={key} className="flex flex-col">
            <h3 className="m-0 text-caption font-bold">{t(`lapse.${key}`)}</h3>
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
              {items.map((item, i) => (
                <li key={`${String(i)}:${item}`}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      {check.suggestion ? (
        <p className="m-0">
          <span className="font-bold">{t('lapse.suggestion')}</span> {check.suggestion}
        </p>
      ) : null}
      <p className="m-0 text-caption text-muted">{t('lapse.yours')}</p>
    </section>
  );
}
