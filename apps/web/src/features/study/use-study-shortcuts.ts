import { type Confidence, type Rating, RatingSchema } from '@estudio/shared';
import { useEffect, useRef } from 'react';

interface Shortcuts {
  /** Espacio o Enter; `null` si ahora no se puede revelar. Ningún atajo salta el intento (R1). */
  readonly onReveal: (() => void) | null;
  /** 1-3 antes de revelar, cuando se pide confianza (R6). */
  readonly onConfidence: ((confidence: Confidence) => void) | null;
  /** 1-4 tras revelar. */
  readonly onRate: ((rating: Rating) => void) | null;
  readonly onHelp: () => void;
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * FRONTEND FE12: todos los atajos de estudio en un solo lugar. Se ignoran al escribir, y
 * Enter o Espacio sobre un botón con foco se dejan al propio botón.
 */
export function useStudyShortcuts(shortcuts: Shortcuts): void {
  const current = useRef(shortcuts);
  useEffect(() => {
    current.current = shortcuts;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isTyping(event.target)
      ) {
        return;
      }
      const { onReveal, onConfidence, onRate, onHelp } = current.current;
      const onButton = event.target instanceof HTMLButtonElement;
      if ((event.key === ' ' || event.key === 'Enter') && onReveal && !onButton) {
        event.preventDefault();
        onReveal();
        return;
      }
      if (event.key === '?') {
        onHelp();
        return;
      }
      const digit = RatingSchema.safeParse(Number(event.key));
      if (!digit.success) return;
      if (onRate) onRate(digit.data);
      else if (onConfidence && digit.data <= 3) onConfidence(digit.data as Confidence);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}
