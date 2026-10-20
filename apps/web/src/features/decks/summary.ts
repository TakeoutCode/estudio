import type { LoadSummary } from '@estudio/srs';
import type { TFunction } from 'i18next';

/**
 * "12 tarjetas · 3 pendientes · 5 nuevas" (§5: "pendientes", sin atraso). "Tarjetas" son las
 * notas que ella escribió (LD §1); pendientes y nuevas cuentan lo que se estudia, así que una
 * nota de huecos aporta una por hueco, como en Hoy.
 */
export function deckSummary(t: TFunction, notes: number, load: LoadSummary): string {
  if (notes === 0) return t('decks.noCards');
  return [
    t('decks.cards', { count: notes }),
    t('decks.due', { count: load.due }),
    t('decks.fresh', { count: load.fresh }),
  ].join(' · ');
}
