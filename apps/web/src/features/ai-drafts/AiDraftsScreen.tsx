import {
  AI_INPUT_MAX_LENGTH,
  type AiDraft,
  aiDraftToNoteContent,
  type AiNoteDraft,
  AiNoteDraftSchema,
  canAcceptAiDraft,
} from '@estudio/shared';
import { type SubmitEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { ApiError } from '@/lib/api';
import { useOnline } from '@/lib/use-online';
import { Banner } from '@/ui/Banner';
import { EmptyState } from '@/ui/EmptyState';
import { acceptAiDraft, editAiDraft, rejectAiDraft, requestAiDrafts } from './commands';
import { useDeckAiDrafts } from './queries';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const textLink = `-ml-2 inline-flex min-h-11 items-center self-start px-2 text-primary ${focus}`;
const field = `w-full min-w-0 rounded-(--radius-card) border-2 border-line-strong bg-bg px-4 py-2 text-text ${focus}`;
const solid = `inline-flex min-h-11 items-center justify-center rounded-(--radius-card) bg-primary px-4 font-bold text-primary-contrast candy disabled:opacity-60 ${focus}`;
const quiet = `inline-flex min-h-11 items-center px-3 text-primary disabled:opacity-60 ${focus}`;
const card = 'flex flex-col gap-3 rounded-(--radius-card) bg-surface p-4 shadow-card';

/**
 * LEARNING-DESIGN §8: borradores de tarjetas a partir de un texto suyo. La IA propone y ella
 * revisa, edita y acepta cada uno (LD16); la captura manual sigue siendo el camino principal.
 */
export function AiDraftsScreen() {
  const { t } = useTranslation();
  const { deckId } = useParams();
  const data = useDeckAiDrafts(deckId);
  if (data === undefined) return null;
  if (data === null) {
    return (
      <>
        <Link className={textLink} to="/decks">
          {t('decks.back')}
        </Link>
        <EmptyState message={t('decks.missing')} />
      </>
    );
  }
  return (
    <>
      <header className="flex flex-col gap-1">
        <Link className={textLink} to={`/decks/${data.deck.id}`}>
          {t('ai.backToDeck')}
        </Link>
        <h1 className="m-0 text-title font-extrabold">{t('ai.title')}</h1>
        <p className="m-0 text-caption text-muted wrap-break-word">{data.deck.name}</p>
      </header>
      <Banner>{t('ai.privacy')}</Banner>
      <RequestForm deckId={data.deck.id} />
      {data.pending.length > 0 ? (
        <section className="flex flex-col gap-3" aria-labelledby="ai-pending">
          <h2 id="ai-pending" className="m-0 text-body font-extrabold">
            {t('ai.pending', { count: data.pending.length })}
          </h2>
          <p className="m-0 text-caption text-muted">{t('ai.reviewHint')}</p>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {data.pending.map((draft) => (
              <DraftItem key={draft.id} row={draft} />
            ))}
          </ul>
        </section>
      ) : null}
      {data.accepted > 0 ? (
        <p className="m-0 text-caption text-muted">{t('ai.accepted', { count: data.accepted })}</p>
      ) : null}
    </>
  );
}

type RequestStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly saved: number; readonly discarded: number }
  | { readonly kind: 'quota' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'failed' };

/** LD17: sin red, deshabilitado; con error, su texto queda intacto y se puede reintentar. */
function RequestForm({ deckId }: { readonly deckId: string }) {
  const { t } = useTranslation();
  const id = useId();
  const online = useOnline();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<RequestStatus>({ kind: 'idle' });
  const busy = status.kind === 'busy';

  const generate = () => {
    if (busy || text.trim() === '') return;
    setStatus({ kind: 'busy' });
    requestAiDrafts(deckId, text)
      .then(({ saved, discarded }) => {
        setStatus({ kind: 'done', saved, discarded });
        if (saved > 0) setText(''); // ya están abajo; otro toque no los duplica
      })
      .catch((error: unknown) => {
        const code = error instanceof ApiError ? error.code : null;
        setStatus({
          kind: code === 'ai_quota_exceeded' ? 'quota' : code === 'network' ? 'offline' : 'failed',
        });
      });
  };
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    generate();
  };

  return (
    <form className={card} onSubmit={submit} noValidate>
      <label htmlFor={`${id}-text`} className="font-bold">
        {t('ai.sourceLabel')}
      </label>
      <textarea
        id={`${id}-text`}
        className={field}
        rows={8}
        maxLength={AI_INPUT_MAX_LENGTH}
        aria-describedby={`${id}-count`}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          if (status.kind !== 'busy') setStatus({ kind: 'idle' });
        }}
      />
      <span id={`${id}-count`} className="text-caption text-muted">
        {t('ai.sourceCount', { count: text.length, max: AI_INPUT_MAX_LENGTH })}
      </span>
      <button
        type="submit"
        className={`${solid} self-start`}
        disabled={!online || busy || text.trim() === ''}
      >
        {t(busy ? 'ai.generating' : 'ai.generate')}
      </button>
      {!online ? <p className="m-0 text-caption text-muted">{t('ai.needsConnection')}</p> : null}
      <RequestMessage status={status} onRetry={generate} />
    </form>
  );
}

function RequestMessage({
  status,
  onRetry,
}: {
  readonly status: RequestStatus;
  readonly onRetry: () => void;
}) {
  const { t } = useTranslation();
  switch (status.kind) {
    case 'idle':
    case 'busy':
      return null;
    case 'done':
      return (
        <div role="status" className="flex flex-col gap-1 text-caption">
          <p className="m-0">{t(status.saved > 0 ? 'ai.done' : 'ai.none', { count: status.saved })}</p>
          {status.discarded > 0 ? (
            <p className="m-0">{t('ai.discarded', { count: status.discarded })}</p>
          ) : null}
        </div>
      );
    case 'quota':
      return (
        <p role="alert" className="m-0 text-caption">
          {t('ai.quota')}
        </p>
      );
    case 'offline':
      return (
        <p role="alert" className="m-0 text-caption">
          {t('ai.offline')}
        </p>
      );
    case 'failed':
      return (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-caption">
          <span>{t('ai.failed')}</span>
          <button type="button" className={quiet} onClick={onRetry}>
            {t('error.retry')}
          </button>
        </div>
      );
  }
}

type ItemStatus = 'idle' | 'invalid' | 'failed';

/** LD16: el borrador completo, editable; sin respaldo en su texto, se acepta solo editado. */
function DraftItem({ row }: { readonly row: AiDraft }) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState<AiNoteDraft>(row.draft);
  const [status, setStatus] = useState<ItemStatus>('idle');
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(row.draft);
  const acceptable = canAcceptAiDraft({ ...row, edited: row.edited || dirty });
  const set = (patch: Partial<AiNoteDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setStatus('idle');
  };

  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    work()
      .catch((error: unknown) => {
        setStatus(error instanceof Error && error.message === 'ai_draft_invalid' ? 'invalid' : 'failed');
      })
      .finally(() => {
        setBusy(false);
      });
  };
  const save = async () => {
    const parsed = AiNoteDraftSchema.safeParse(draft);
    if (!parsed.success) throw new Error('ai_draft_invalid');
    if (dirty) await editAiDraft(row.id, parsed.data);
  };
  const accept = () => {
    run(async () => {
      const parsed = AiNoteDraftSchema.safeParse(draft);
      if (!parsed.success || !aiDraftToNoteContent(parsed.data)) throw new Error('ai_draft_invalid');
      await save();
      await acceptAiDraft(row.id);
    });
  };

  const labels = (
    {
      basic: { front: 'ai.field.question', back: 'ai.field.answer' },
      cloze: { front: 'ai.field.clozeText', back: 'ai.field.hidden' },
      multiple_choice: { front: 'ai.field.question', back: 'ai.field.correct' },
    } as const
  )[draft.kind];

  return (
    <li className={card}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-blush px-3 py-1 text-caption font-bold text-primary">
          {t(`ai.kind.${draft.kind}`)}
        </span>
        {!row.supported && !row.edited && !dirty ? (
          <span className="rounded-full border-2 border-line-strong px-3 py-1 text-caption font-bold">
            {t('ai.unsupported')}
          </span>
        ) : null}
      </div>
      <p className="m-0 text-caption text-muted">{t('ai.quote', { quote: row.draft.sourceQuote })}</p>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-muted">{t(labels.front)}</span>
        <textarea
          className={field}
          rows={2}
          maxLength={500}
          value={draft.front}
          onChange={(event) => {
            set({ front: event.target.value });
          }}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-muted">{t(labels.back)}</span>
        <textarea
          className={field}
          rows={2}
          maxLength={1000}
          value={draft.back}
          onChange={(event) => {
            set({ back: event.target.value });
          }}
        />
      </label>
      {draft.kind === 'multiple_choice' ? (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-caption text-muted">{t('ai.field.options')}</legend>
          {(draft.options ?? []).map((option, index) => (
            <input
              // El orden de las opciones no cambia mientras edita.
              key={index}
              className={`${field} min-h-11`}
              maxLength={200}
              aria-label={t('ai.field.option', { n: index + 1 })}
              value={option}
              onChange={(event) => {
                const options = [...(draft.options ?? [])];
                options[index] = event.target.value;
                set({ options });
              }}
            />
          ))}
        </fieldset>
      ) : null}
      <label className="flex flex-col gap-1">
        <span className="text-caption text-muted">{t('ai.field.explanation')}</span>
        <textarea
          className={field}
          rows={2}
          maxLength={400}
          value={draft.explanation}
          onChange={(event) => {
            set({ explanation: event.target.value });
          }}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={solid}
          disabled={busy || !acceptable}
          aria-describedby={acceptable ? undefined : `${id}-why`}
          onClick={accept}
        >
          {t('ai.accept')}
        </button>
        {dirty ? (
          <button
            type="button"
            className={quiet}
            disabled={busy}
            onClick={() => {
              run(save);
            }}
          >
            {t('ai.save')}
          </button>
        ) : null}
        <button
          type="button"
          className={quiet}
          disabled={busy}
          onClick={() => {
            run(() => rejectAiDraft(row.id));
          }}
        >
          {t('ai.reject')}
        </button>
      </div>
      {acceptable ? null : (
        <p id={`${id}-why`} className="m-0 text-caption text-muted">
          {t('ai.editFirst')}
        </p>
      )}
      {status === 'idle' ? null : (
        <p role="alert" className="m-0 text-caption">
          {t(status === 'invalid' ? 'ai.invalid' : 'ai.saveFailed')}
        </p>
      )}
    </li>
  );
}
