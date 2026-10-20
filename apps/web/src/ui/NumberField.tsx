import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const step = `inline-flex size-11 shrink-0 items-center justify-center rounded-(--radius-card) border border-muted/40 text-title leading-none text-primary disabled:opacity-40 ${focus}`;

const parse = (text: string): number | null => (/^\d{1,4}$/.test(text.trim()) ? Number(text) : null);

/**
 * Número entero con −/+ de 44 px (UX2) y campo para escribirlo. El rango viene de la config
 * (AG4); fuera de rango avisa y entrega `null`, sin corregir en silencio.
 */
export function NumberField({
  label,
  defaultValue,
  min,
  max,
  onChange,
}: {
  readonly label: string;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number | null) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState(String(defaultValue));
  const value = parse(text);
  const valid = value !== null && value >= min && value <= max;

  const set = (next: string) => {
    setText(next);
    const n = parse(next);
    onChange(n !== null && n >= min && n <= max ? n : null);
  };
  // Desde un valor fuera de rango, −/+ restan o suman a lo escrito y lo traen al rango.
  const nudge = (delta: number) => {
    set(String(Math.min(max, Math.max(min, (value ?? min) + delta))));
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-caption text-muted">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={step}
          aria-label={t('ui.number.decrease', { label })}
          disabled={valid && value <= min}
          onClick={() => {
            nudge(-1);
          }}
        >
          −
        </button>
        <input
          id={id}
          className={`min-h-11 w-14 min-w-0 rounded-(--radius-card) border bg-bg px-1 text-center text-body tabular-nums ${valid ? 'border-muted/40' : 'border-text'} ${focus}`}
          inputMode="numeric"
          enterKeyHint="done"
          autoComplete="off"
          value={text}
          aria-invalid={!valid}
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            set(event.target.value);
          }}
        />
        <button
          type="button"
          className={step}
          aria-label={t('ui.number.increase', { label })}
          disabled={valid && value >= max}
          onClick={() => {
            nudge(1);
          }}
        >
          +
        </button>
      </div>
      <p id={`${id}-hint`} className={`m-0 text-caption ${valid ? 'text-muted' : 'text-text'}`}>
        {t(valid ? 'ui.number.range' : 'ui.number.invalid', { min, max })}
      </p>
    </div>
  );
}
