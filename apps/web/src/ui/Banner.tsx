import type { ReactNode } from 'react';
import { HeartIcon } from './icons';

/** Aviso no bloqueante. Nunca usa rojo ni tono de alarma (UI-UX UX1, §5). */
export function Banner({ children, action }: { readonly children: ReactNode; readonly action?: ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-(--radius-card) bg-blush px-4 py-3 text-caption text-text"
    >
      <span className="flex items-start gap-2">
        <HeartIcon className="mt-0.5 size-4 shrink-0 text-bow" />
        <span>{children}</span>
      </span>
      {action}
    </div>
  );
}
