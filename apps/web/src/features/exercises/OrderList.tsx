import { type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const step = `inline-flex size-11 shrink-0 items-center justify-center rounded-(--radius-card) border-2 border-line-strong text-primary disabled:opacity-40 ${focus}`;

type Direction = 'up' | 'down';

/** Mueve el elemento `index` un lugar hacia arriba o hacia abajo. */
export function moved<T>(list: readonly T[], index: number, direction: Direction): T[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  const next = [...list];
  const [item] = next.splice(index, 1);
  if (item === undefined || target < 0 || target > list.length - 1) return [...list];
  next.splice(target, 0, item);
  return next;
}

/**
 * UX2, UX4: ordenar con botones "Subir" y "Bajar" de 44 px, que también sirven con teclado y
 * lector de pantalla. Tras mover, el foco sigue al elemento movido.
 */
export function OrderList({
  rows,
  disabled = false,
  onMove,
}: {
  readonly rows: readonly { readonly key: string; readonly label: string; readonly content: ReactNode }[];
  readonly disabled?: boolean;
  readonly onMove: (index: number, direction: Direction) => void;
}) {
  const { t } = useTranslation();
  const list = useRef<HTMLOListElement>(null);
  /** El lugar al que se movió un elemento: su botón recibe el foco al volver a dibujar. */
  const pending = useRef<{ index: number; direction: Direction } | null>(null);

  useEffect(() => {
    const want = pending.current;
    if (!want || !list.current) return;
    pending.current = null;
    const buttons = list.current.querySelectorAll<HTMLButtonElement>(`[data-index="${String(want.index)}"]`);
    const same = [...buttons].find((b) => b.dataset.direction === want.direction && !b.disabled);
    (same ?? [...buttons].find((b) => !b.disabled))?.focus();
  });

  return (
    <ol ref={list} className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((row, index) => (
        <li key={row.key} className="flex items-center gap-2 rounded-(--radius-card) bg-bg py-1 pr-1 pl-3">
          <span className="w-6 shrink-0 text-caption text-muted tabular-nums" aria-hidden="true">
            {index + 1}.
          </span>
          <div className="min-w-0 flex-1">{row.content}</div>
          {(['up', 'down'] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              className={step}
              data-index={index}
              data-direction={direction}
              disabled={disabled || (direction === 'up' ? index === 0 : index === rows.length - 1)}
              aria-label={t(direction === 'up' ? 'exercises.order.up' : 'exercises.order.down', {
                label: row.label,
              })}
              onClick={() => {
                pending.current = { index: direction === 'up' ? index - 1 : index + 1, direction };
                onMove(index, direction);
              }}
            >
              <span aria-hidden="true">{direction === 'up' ? '↑' : '↓'}</span>
            </button>
          ))}
        </li>
      ))}
    </ol>
  );
}
