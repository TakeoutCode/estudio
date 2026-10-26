import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Llama a `onChange` al montar y cada vez que la página se oculta o vuelve (teléfono
 * bloqueado, otra app u otra pestaña), con la hora del dispositivo. Corre dentro del evento y
 * no en un render posterior: iOS congela la página justo después de ocultarla (FE11). El primer
 * aviso va en el mismo commit en que se pinta (layout effect): el reloj de una tarjeta empieza
 * cuando ella la ve, no cuando React llegue a los efectos pasivos.
 */
export function usePageVisibility(onChange: (hidden: boolean, at: number) => void): void {
  const report = useRef(onChange);
  useEffect(() => {
    report.current = onChange;
  });
  useLayoutEffect(() => {
    const notify = () => {
      report.current(document.visibilityState === 'hidden', Date.now());
    };
    notify();
    document.addEventListener('visibilitychange', notify);
    return () => {
      document.removeEventListener('visibilitychange', notify);
    };
  }, []);
}
