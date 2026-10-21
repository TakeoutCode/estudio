import { CONTRAST_MEMBERS, type ContrastGroup } from '@estudio/shared';
import { normalizeAnswer } from '@estudio/srs';
import { type SubmitEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { EmptyState } from '@/ui/EmptyState';
import { createContrastGroup, deleteContrastGroup, updateContrastGroup } from './commands';
import { type NoteChoice, useContrastGroup, useNoteChoices } from './queries';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `min-h-11 w-full min-w-0 rounded-(--radius-card) border border-muted/40 bg-bg px-4 text-text ${focus}`;
const textLink = `-ml-2 inline-flex min-h-11 items-center self-start px-2 text-primary ${focus}`;
const primary = `min-h-14 w-full rounded-(--radius-card) bg-primary px-4 font-medium text-primary-contrast disabled:opacity-60 ${focus}`;
/** Una lista larga en el teléfono no ayuda: se pide buscar. */
const MAX_RESULTS = 30;

/** R9: crear o editar un grupo de tarjetas que se confunden. */
export function ContrastEditorScreen() {
  const { t } = useTranslation();
  const { groupId } = useParams();
  const group = useContrastGroup(groupId);
  const choices = useNoteChoices();
  if (group === undefined || choices === undefined) return null;
  if (groupId && group === null) {
    // Se borró en otro dispositivo.
    return (
      <EmptyState
        message={t('contrast.missing')}
        action={
          <Link className={textLink} to="/contrast">
            {t('contrast.back')}
          </Link>
        }
      />
    );
  }
  return <GroupForm key={group?.id ?? 'new'} group={group} choices={choices} />;
}

type Status = 'idle' | 'invalid' | 'failed' | 'saved';

function GroupForm({
  group,
  choices,
}: {
  readonly group: ContrastGroup | null;
  readonly choices: readonly NoteChoice[];
}) {
  const { t } = useTranslation();
  const ids = useId();
  const navigate = useNavigate();
  const [name, setName] = useState(group?.name ?? '');
  const [selected, setSelected] = useState<readonly string[]>(group?.noteIds ?? []);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const byId = new Map(choices.map((c) => [c.id, c]));
  const needle = normalizeAnswer(query);
  const results = choices
    .filter((c) => !selected.includes(c.id) && (needle === '' || c.search.includes(needle)))
    .slice(0, MAX_RESULTS);
  const full = selected.length >= CONTRAST_MEMBERS.max;

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = { name: name.trim(), noteIds: selected };
    if (input.name === '' || selected.length < CONTRAST_MEMBERS.min) {
      setStatus('invalid');
      return;
    }
    setBusy(true);
    try {
      if (group) await updateContrastGroup(group.id, input);
      else await createContrastGroup(input);
      await navigate('/contrast');
    } catch {
      setStatus('failed');
      setBusy(false);
    }
  };

  return (
    <>
      <header className="flex flex-col">
        <Link className={textLink} to="/contrast">
          {t('contrast.back')}
        </Link>
        <h1 className="m-0 text-title font-semibold">{t(group ? 'contrast.edit' : 'contrast.new')}</h1>
      </header>
      {group ? (
        <p className="m-0 text-caption text-muted">
          {t(group.abArm === 'contrast' ? 'contrast.armHint.contrast' : 'contrast.armHint.control')}
        </p>
      ) : (
        <p className="m-0 text-caption text-muted">{t('contrast.newHint')}</p>
      )}
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
        <label className="flex flex-col gap-1">
          <span>{t('contrast.name')}</span>
          <input
            className={field}
            maxLength={120}
            placeholder={t('contrast.namePlaceholder')}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setStatus('idle');
            }}
          />
        </label>

        <section aria-labelledby={`${ids}-selected`} className="flex flex-col gap-2">
          <h2 id={`${ids}-selected`} className="m-0 text-body font-semibold">
            {t('contrast.selected', { count: selected.length, max: CONTRAST_MEMBERS.max })}
          </h2>
          {selected.length === 0 ? (
            <p className="m-0 text-caption text-muted">{t('contrast.selectedEmpty')}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {selected.map((id) => {
                const choice = byId.get(id);
                const label = choice?.label ?? t('contrast.deletedNote');
                return (
                  <li key={id} className="flex items-center gap-2 rounded-(--radius-card) bg-surface pl-3">
                    <span className="flex min-w-0 flex-1 flex-col py-2">
                      <span className="wrap-break-word">{label}</span>
                      {choice ? <span className="text-caption text-muted">{choice.deck}</span> : null}
                    </span>
                    <button
                      type="button"
                      className={`min-h-11 min-w-11 shrink-0 text-primary ${focus}`}
                      aria-label={t('contrast.remove', { label })}
                      onClick={() => {
                        setSelected(selected.filter((s) => s !== id));
                        setStatus('idle');
                      }}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby={`${ids}-search`} className="flex flex-col gap-2">
          <h2 id={`${ids}-search`} className="m-0 text-body font-semibold">
            {t('contrast.add')}
          </h2>
          <input
            type="search"
            className={field}
            aria-labelledby={`${ids}-search`}
            placeholder={t('contrast.searchPlaceholder')}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          {results.length === 0 ? (
            <p className="m-0 text-caption text-muted">{t('contrast.noResults')}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {results.map((choice) => (
                <li key={choice.id}>
                  <button
                    type="button"
                    disabled={full}
                    className={`flex min-h-11 w-full flex-col items-start rounded-(--radius-card) border border-muted/40 px-3 py-2 text-left text-text disabled:opacity-60 ${focus}`}
                    aria-label={t('contrast.addNamed', { label: choice.label })}
                    onClick={() => {
                      setSelected([...selected, choice.id]);
                      setStatus('idle');
                    }}
                  >
                    <span className="wrap-break-word">{choice.label}</span>
                    <span className="text-caption text-muted">{choice.deck}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {status === 'invalid' || status === 'failed' ? (
          <p role="alert" className="m-0 text-caption">
            {t(status === 'invalid' ? 'contrast.error.invalid' : 'error.generic')}
          </p>
        ) : null}
        <button type="submit" className={primary} disabled={busy}>
          {t('contrast.save')}
        </button>
      </form>
      {group ? (
        confirming ? (
          <div role="alertdialog" aria-labelledby={`${ids}-confirm`} className="flex flex-col gap-2">
            <p id={`${ids}-confirm`} className="m-0">
              {t('contrast.deleteConfirm')}
            </p>
            <button
              type="button"
              className={`min-h-11 w-full rounded-(--radius-card) border border-danger px-4 font-medium text-danger ${focus}`}
              onClick={() => {
                void deleteContrastGroup(group.id).then(() => navigate('/contrast'));
              }}
            >
              {t('contrast.deleteYes')}
            </button>
            <button
              type="button"
              className={`min-h-11 w-full rounded-(--radius-card) px-4 text-primary ${focus}`}
              onClick={() => {
                setConfirming(false);
              }}
            >
              {t('decks.cancel')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={`min-h-11 w-full rounded-(--radius-card) px-4 text-danger ${focus}`}
            onClick={() => {
              setConfirming(true);
            }}
          >
            {t('contrast.delete')}
          </button>
        )
      ) : null}
    </>
  );
}
