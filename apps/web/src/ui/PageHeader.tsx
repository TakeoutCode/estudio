import type { ReactNode } from 'react';
import { BowIcon } from './icons';

/** Título de una pantalla principal, con el lazo del tema como adorno. */
export function PageHeader({
  title,
  eyebrow,
  children,
}: {
  readonly title: string;
  /** Línea breve sobre el título (p. ej. un saludo). */
  readonly eyebrow?: string;
  readonly children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-1 pt-1">
      {eyebrow ? <p className="m-0 text-caption font-bold text-muted">{eyebrow}</p> : null}
      <div className="flex items-center gap-2">
        <h1 className="m-0 text-display leading-tight font-extrabold">{title}</h1>
        <BowIcon className="w-9 shrink-0 -rotate-6 text-bow" />
      </div>
      {children}
    </header>
  );
}
