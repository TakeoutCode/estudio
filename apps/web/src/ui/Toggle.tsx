import { useId } from 'react';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** Sí/no con la fila entera como objetivo táctil de 44 px (UX2); la casilla no se encoge. */
export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <label className="flex min-h-11 items-center justify-between gap-3">
      <span className="flex flex-col">
        <span>{label}</span>
        {hint ? (
          <span id={`${id}-hint`} className="text-caption text-muted">
            {hint}
          </span>
        ) : null}
      </span>
      <input
        type="checkbox"
        className={`size-6 shrink-0 accent-primary ${focus}`}
        checked={checked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
    </label>
  );
}
