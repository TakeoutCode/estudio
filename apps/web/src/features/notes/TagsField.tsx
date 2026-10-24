import { type Tag, TAG_NAME_MAX_LENGTH, tagKey, TAGS_PER_NOTE_MAX } from '@estudio/shared';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TagChoice } from './commands';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `min-h-11 w-full min-w-0 rounded-(--radius-card) border-2 border-line-strong bg-bg px-4 text-text ${focus}`;
const chip = `inline-flex min-h-11 items-center rounded-(--radius-card) border-2 px-3 ${focus}`;
/** Sugerencias a la vista: las suficientes para elegir sin buscar, sin llenar la pantalla. */
const SUGGESTIONS = 8;

const choiceKey = (choice: TagChoice, byId: ReadonlyMap<string, Tag>): string =>
  'id' in choice ? tagKey(byId.get(choice.id)?.name ?? choice.id) : tagKey(choice.name);

/**
 * Etiquetas de la nota (diseño): elegir una que ya tiene o escribir una nueva, que se crea al
 * guardar. Son opcionales y cruzan mazos; sirven para filtrar y para estudiar una etiqueta.
 */
export function TagsField({
  tags,
  chosen,
  onChange,
}: {
  readonly tags: readonly Tag[];
  readonly chosen: readonly TagChoice[];
  readonly onChange: (next: TagChoice[]) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [query, setQuery] = useState('');
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const taken = new Set(chosen.map((c) => choiceKey(c, byId)));
  const full = chosen.length >= TAGS_PER_NOTE_MAX;
  const typed = tagKey(query);
  const suggestions = tags
    .filter((tag) => !taken.has(tagKey(tag.name)) && (typed === '' || tagKey(tag.name).includes(typed)))
    .slice(0, SUGGESTIONS);

  const add = (choice: TagChoice) => {
    if (full || taken.has(choiceKey(choice, byId))) return;
    onChange([...chosen, choice]);
    setQuery('');
  };
  const addTyped = () => {
    if (typed === '') return;
    const known = tags.find((tag) => tagKey(tag.name) === typed);
    add(known ? { id: known.id } : { name: query.trim() });
  };

  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" aria-describedby={`${id}-hint`}>
      <legend className="mb-1">{t('notes.tags.label')}</legend>
      {chosen.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {chosen.map((choice) => {
            const name = 'id' in choice ? byId.get(choice.id)?.name : choice.name;
            if (name === undefined) return null; // borrada en otro dispositivo: no se guarda
            return (
              <li key={choiceKey(choice, byId)}>
                <button
                  type="button"
                  className={`${chip} gap-2 border-primary bg-primary/20 text-text`}
                  aria-label={t('notes.tags.remove', { name })}
                  onClick={() => {
                    onChange(chosen.filter((c) => c !== choice));
                  }}
                >
                  <span>{name}</span>
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <input
          className={field}
          value={query}
          maxLength={TAG_NAME_MAX_LENGTH}
          disabled={full}
          aria-label={t('notes.tags.add')}
          placeholder={t('notes.tags.placeholder')}
          enterKeyHint="done"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault(); // Enter agrega la etiqueta; no guarda la nota a medias
            addTyped();
          }}
        />
        <button
          type="button"
          className={`min-h-11 shrink-0 rounded-(--radius-card) border-2 border-primary px-4 font-bold text-primary disabled:opacity-40 ${focus}`}
          disabled={full || typed === ''}
          onClick={addTyped}
        >
          {t('notes.tags.addButton')}
        </button>
      </div>
      {suggestions.length > 0 && !full ? (
        <div role="group" aria-label={t('notes.tags.suggestions')} className="flex flex-wrap gap-2">
          {suggestions.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className={`${chip} border-line-strong text-primary`}
              onClick={() => {
                add({ id: tag.id });
              }}
            >
              {tag.name}
            </button>
          ))}
        </div>
      ) : null}
      <p id={`${id}-hint`} className="m-0 text-caption text-muted">
        {full ? t('notes.tags.full', { max: TAGS_PER_NOTE_MAX }) : t('notes.tags.hint')}
      </p>
    </fieldset>
  );
}
