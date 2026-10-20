import type { ReactNode } from 'react';

/** UI-UX UX3: un estado vacío siempre dice qué pasa y ofrece una acción. */
export function EmptyState({ message, action }: { readonly message: string; readonly action?: ReactNode }) {
  return (
    <section className="rounded-(--radius-card) bg-surface p-6 text-center text-muted">
      <p className="m-0">{message}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </section>
  );
}
