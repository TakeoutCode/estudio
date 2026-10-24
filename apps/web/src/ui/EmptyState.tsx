import type { ReactNode } from 'react';
import { BowIcon } from './icons';

/** UI-UX UX3: un estado vacío siempre dice qué pasa y ofrece una acción. */
export function EmptyState({ message, action }: { readonly message: string; readonly action?: ReactNode }) {
  return (
    <section className="flex flex-col items-center gap-3 rounded-(--radius-card) bg-surface px-6 py-8 text-center text-muted shadow-card">
      <span className="flex size-16 items-center justify-center rounded-full bg-blush text-bow">
        <BowIcon className="w-10" />
      </span>
      <p className="m-0 max-w-xs">{message}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </section>
  );
}
