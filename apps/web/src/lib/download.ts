/** URLs `blob:` que duran lo suficiente para que el navegador empiece la descarga. */
const REVOKE_AFTER_MS = 60_000;

/** Descarga un archivo generado en el dispositivo (sin red, FE7). En iOS abre la hoja de guardar. */
export function saveFile(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, REVOKE_AFTER_MS);
}

/** Fecha local `AAAA-MM-DD` para nombres de archivo. */
export const fileDate = (ms: number): string => new Intl.DateTimeFormat('sv-SE').format(ms);
