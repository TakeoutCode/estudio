import { type ReactNode, useEffect, useState } from 'react';

/**
 * UX2: con el teclado abierto, cuánto tapa el teclado la parte de abajo del layout. En iOS el
 * layout no se achica con el teclado; `visualViewport` sí. Sin `visualViewport`, 0.
 */
function useKeyboardInset(enabled: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!enabled || !viewport) return;
    const update = () => {
      setInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, [enabled]);
  return inset;
}

/**
 * UI-UX UX2: acciones principales en la zona del pulgar, pegadas abajo y por encima del
 * indicador de inicio. Va al final de la pantalla: `mt-auto` la baja aunque haya poco
 * contenido y `sticky` la deja visible si hay mucho, sobre la barra de pestañas si la hay
 * (`--chrome-bottom`). Absorbe el relleno inferior del layout (`--edge-bottom`) para llegar al
 * borde y pone el suyo. Con `keyboardAware`, sube por encima
 * del teclado (p. ej. el campo y "Comprobar" de escribir la respuesta).
 */
export function ActionBar({
  children,
  label,
  keyboardAware = false,
}: {
  readonly children: ReactNode;
  readonly label?: string;
  readonly keyboardAware?: boolean;
}) {
  const inset = useKeyboardInset(keyboardAware);
  return (
    <div
      role={label ? 'group' : undefined}
      aria-label={label}
      style={inset > 0 ? { bottom: inset } : undefined}
      className="sticky bottom-(--chrome-bottom) z-10 mt-auto -mb-(--edge-bottom) flex flex-col gap-2 bg-linear-to-t from-bg from-80% to-transparent pt-6 pb-(--edge-bottom)"
    >
      {children}
    </div>
  );
}
