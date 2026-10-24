import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRightIcon } from './icons';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** Enlace a otra sección como tarjeta de una fila: ícono, texto y flecha. El texto es su nombre. */
export function LinkRow({
  to,
  icon,
  children,
}: {
  readonly to: string;
  readonly icon: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={`press flex min-h-14 items-center gap-3 rounded-(--radius-card) bg-surface py-2 pr-3 pl-2 font-bold text-text shadow-card ${focus}`}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-blush text-primary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      <ChevronRightIcon className="size-5 shrink-0 text-muted" />
    </Link>
  );
}
