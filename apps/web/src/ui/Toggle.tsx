import { useId } from 'react';

/**
 * Sí/no con la fila entera como objetivo táctil de 44 px (UX2). Sigue siendo una casilla para
 * el lector de pantalla; el interruptor es solo su dibujo, con el foco visible en él.
 */
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
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
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
        className="peer sr-only"
        checked={checked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <span
        aria-hidden="true"
        className="relative h-8 w-13 shrink-0 rounded-full border-2 border-line-strong bg-blush transition-colors duration-150 ease-out peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary after:absolute after:top-0.5 after:left-0.5 after:size-6 after:rounded-full after:bg-surface after:shadow-card after:transition-transform after:duration-150 after:ease-out peer-checked:after:translate-x-5"
      />
    </label>
  );
}
