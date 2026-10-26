import { useTranslation } from 'react-i18next';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * El enlace primario de cada fuente que la app cita, con su número de STUDY-METHODS (Fuentes).
 * Una cita nueva agrega aquí su número con el mismo enlace del documento.
 */
const SOURCES = {
  7: 'https://doi.org/10.1037/bul0000209',
  8: 'https://link.springer.com/article/10.1007/s40037-017-0365-x',
  21: 'https://docs.ankiweb.net/faqs/what-spaced-repetition-algorithm.md',
  22: 'https://pubmed.ncbi.nlm.nih.gov/36859717/',
  29: 'https://www.nature.com/articles/nrn2762',
} as const;

export type SourceNumber = keyof typeof SOURCES;

/**
 * UI-UX UX9, R20: toda cifra de olvido o de mejora, y todo efecto que la app cita, enlaza su
 * fuente primaria. Se ve como `[n]`, el número de STUDY-METHODS. La prop no se llama `ref`
 * (como en UX9) porque React la reserva. WCAG 2.5.3: el nombre accesible empieza con lo que
 * se ve (`[7]`) y sigue con un texto solo para lectores de pantalla.
 */
export function SourceLink({ source }: { readonly source: SourceNumber }) {
  const { t } = useTranslation();
  return (
    <a className={`text-primary underline ${focus}`} href={SOURCES[source]} target="_blank" rel="noreferrer">
      [{source}]<span className="sr-only"> {t('ui.source')}</span>
    </a>
  );
}
