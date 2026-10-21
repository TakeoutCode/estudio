import type { AiOpenFeedback } from '@estudio/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/lib/api';
import { useOnline } from '@/lib/use-online';
import { requestAiFeedback } from './commands';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const outline = `inline-flex min-h-11 items-center justify-center self-start rounded-(--radius-card) border-2 border-primary px-4 font-bold text-primary disabled:opacity-60 ${focus}`;

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly feedback: AiOpenFeedback }
  | { readonly kind: 'quota' | 'offline' | 'failed' };

/**
 * LD14: después de ver la clave, ella puede pedir retroalimentación de su respuesta abierta.
 * Es opcional, requiere conexión (FE7) y nunca califica: los 4 botones siguen siendo suyos.
 */
export function AiFeedbackPanel({
  cardId,
  question,
  answerKey,
  answer,
}: {
  readonly cardId: string;
  readonly question: string;
  readonly answerKey: string;
  readonly answer: string;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const ask = () => {
    setStatus({ kind: 'busy' });
    requestAiFeedback(cardId, { question, key: answerKey, answer })
      .then((feedback) => {
        setStatus({ kind: 'done', feedback });
      })
      .catch((error: unknown) => {
        const code = error instanceof ApiError ? error.code : null;
        setStatus({
          kind: code === 'ai_quota_exceeded' ? 'quota' : code === 'network' ? 'offline' : 'failed',
        });
      });
  };

  if (status.kind === 'done') return <FeedbackView feedback={status.feedback} />;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className={outline}
        disabled={!online || status.kind === 'busy' || answer.trim() === ''}
        onClick={ask}
      >
        {t(status.kind === 'busy' ? 'aiFeedback.asking' : 'aiFeedback.ask')}
      </button>
      {!online ? <p className="m-0 text-caption text-muted">{t('ai.needsConnection')}</p> : null}
      {status.kind === 'quota' || status.kind === 'offline' || status.kind === 'failed' ? (
        <p role="alert" className="m-0 text-caption">
          {t(`aiFeedback.error.${status.kind}`)}
        </p>
      ) : null}
    </div>
  );
}

function FeedbackView({ feedback }: { readonly feedback: AiOpenFeedback }) {
  const { t } = useTranslation();
  const lists = [
    ['covered', feedback.covered],
    ['missing', feedback.missing],
    ['misconceptions', feedback.misconceptions],
  ] as const;
  const empty = lists.every(([, items]) => items.length === 0) && feedback.suggestion === '';
  return (
    <section
      aria-label={t('aiFeedback.title')}
      className="flex flex-col gap-2 rounded-(--radius-card) bg-blush p-4"
    >
      <h2 className="m-0 text-caption font-bold text-muted">{t('aiFeedback.title')}</h2>
      {empty ? <p className="m-0">{t('aiFeedback.empty')}</p> : null}
      {lists.map(([key, items]) =>
        items.length > 0 ? (
          <div key={key} className="flex flex-col">
            <h3 className="m-0 text-caption font-bold">{t(`aiFeedback.${key}`)}</h3>
            <ul className="m-0 flex flex-col gap-1 pl-5">
              {items.map((item, i) => (
                <li key={`${String(i)}:${item}`}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      {feedback.suggestion ? (
        <p className="m-0">
          <span className="font-bold">{t('aiFeedback.suggestion')}</span> {feedback.suggestion}
        </p>
      ) : null}
      <p className="m-0 text-caption text-muted">{t('aiFeedback.yours')}</p>
    </section>
  );
}
