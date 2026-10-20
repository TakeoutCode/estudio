import type { ReactNode } from 'react';

/** Aviso no bloqueante. Nunca usa rojo ni tono de alarma (UI-UX UX1, §5). */
export function Banner({ children, action }: { readonly children: ReactNode; readonly action?: ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-(--radius-card) bg-surface px-4 py-3 text-caption text-text"
    >
      <span>{children}</span>
      {action}
    </div>
  );
}
