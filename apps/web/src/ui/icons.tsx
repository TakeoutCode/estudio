import type { ReactNode } from 'react';

// Íconos del sistema de diseño: siempre decorativos (`aria-hidden`); el texto visible o el
// `aria-label` del control da el nombre (UX4). Toman el color de `currentColor`.

type IconProps = { readonly className?: string };

function Stroke({ className, children }: IconProps & { readonly children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

/** El lazo del tema: solo adorno. */
export function BowIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 32" fill="currentColor" aria-hidden="true" focusable="false" className={className}>
      <path d="M21 13.5C15.5 5.5 4.5 3.5 3.6 11.5 2.8 19 12.5 22.5 21 18.5Z" />
      <path d="M27 13.5c5.5-8 16.5-10 17.4-2 .8 7.5-8.9 11-17.4 7Z" />
      <path
        d="M8.5 10.5c2.5-1.5 6.5 0 9 3"
        className="fill-none stroke-shine"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <path
        d="M39.5 10.5c-2.5-1.5-6.5 0-9 3"
        className="fill-none stroke-shine"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <ellipse cx="24" cy="16" rx="5" ry="5.5" />
      <ellipse cx="22.6" cy="14.4" rx="1.6" ry="1.2" className="fill-shine" />
    </svg>
  );
}

export function HeartIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className={className}>
      <path d="M12 20.5s-8.5-5.1-8.5-11A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8.5 2.5c0 5.9-8.5 11-8.5 11Z" />
    </svg>
  );
}

export function SparkleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className={className}>
      <path d="M12 2.5c.8 5.3 2.2 6.7 7.5 7.5-5.3.8-6.7 2.2-7.5 7.5-.8-5.3-2.2-6.7-7.5-7.5 5.3-.8 6.7-2.2 7.5-7.5Z" />
    </svg>
  );
}

export function HomeIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19Z" />
      <path
        d="M12 17.2s-3-1.8-3-3.8a1.5 1.5 0 0 1 3-.5 1.5 1.5 0 0 1 3 .5c0 2-3 3.8-3 3.8Z"
        fill="currentColor"
        strokeWidth={1}
      />
    </Stroke>
  );
}

export function CardsIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <rect x="7.5" y="3.5" width="12" height="15" rx="3" />
      <path d="M4.5 7.5v10a3 3 0 0 0 3 3h8" />
    </Stroke>
  );
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <circle cx="12" cy="15.2" r="1.6" fill="currentColor" stroke="none" />
    </Stroke>
  );
}

export function ChartIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <path d="M6 19.5v-5M12 19.5v-11M18 19.5v-8" strokeWidth={3} />
      <path
        d="M17.5 3.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5Z"
        fill="currentColor"
        strokeWidth={1}
      />
    </Stroke>
  );
}

export function SlidersIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <path d="M4 7h9M18.5 7H20M4 17h1.5M10.5 17H20" />
      <circle cx="15.8" cy="7" r="2.5" />
      <circle cx="8" cy="17" r="2.5" />
    </Stroke>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <circle cx="12" cy="13" r="7.5" />
      <path d="M12 9.5V13l2.5 1.5M9.5 3h5" />
    </Stroke>
  );
}

export function TagIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <path d="M3.5 12V5A1.5 1.5 0 0 1 5 3.5h7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0Z" />
      <circle cx="8.2" cy="8.2" r="1.5" />
    </Stroke>
  );
}

export function TwinsIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <circle cx="9" cy="12" r="5.5" />
      <circle cx="15" cy="12" r="5.5" />
    </Stroke>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <path d="M12 5.5v13M5.5 12h13" strokeWidth={2.5} />
    </Stroke>
  );
}

export function PlayIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className={className}>
      <path d="M8 5.6v12.8a1.1 1.1 0 0 0 1.7.9l9.9-6.4a1.1 1.1 0 0 0 0-1.8L9.7 4.7A1.1 1.1 0 0 0 8 5.6Z" />
    </svg>
  );
}

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <path d="M14.5 6 8.5 12l6 6" strokeWidth={2.5} />
    </Stroke>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <path d="m9.5 6 6 6-6 6" strokeWidth={2.5} />
    </Stroke>
  );
}
