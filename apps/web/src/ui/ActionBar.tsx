import type { ReactNode } from 'react';

/**
 * UI-UX UX2: acciones principales en la zona del pulgar, pegadas abajo y por encima del
 * indicador de inicio. Va al final de la pantalla: `mt-auto` la baja aunque haya poco
 * contenido y `sticky` la deja visible si hay mucho. Absorbe el relleno inferior del layout
 * para llegar al borde y pone el suyo con la safe area.
 */
export function ActionBar({ children, label }: { readonly children: ReactNode; readonly label?: string }) {
  return (
    <div
      role={label ? 'group' : undefined}
      aria-label={label}
      className="sticky bottom-0 mt-auto -mb-[max(1rem,env(safe-area-inset-bottom))] flex flex-col gap-2 bg-bg pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      {children}
    </div>
  );
}
