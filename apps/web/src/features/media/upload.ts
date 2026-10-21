import { MediaSignatureSchema } from '@estudio/shared';
import { authorizedApi } from '@/features/auth';
import { ApiError } from '@/lib/api';
import type { MediaUploadTransport } from './commands';

/** Una imagen de 10 MB con mala señal tarda; pasado esto se corta y se reintenta en otra vuelta. */
const UPLOAD_TIMEOUT_MS = 120_000;

const timeoutSignal = (ms: number): AbortSignal | undefined =>
  'timeout' in AbortSignal ? AbortSignal.timeout(ms) : undefined;

/** ARC8: la firma la da la API; el archivo va directo a Cloudinary sin pasar por ella (ADR-010). */
export const httpMediaTransport: MediaUploadTransport = {
  sign: (assetId) =>
    authorizedApi('/media/signature', { method: 'POST', body: { assetId }, schema: MediaSignatureSchema }),
  async upload(signature, file) {
    const form = new FormData();
    for (const [key, value] of Object.entries(signature.fields)) form.append(key, value);
    form.append('file', file);
    let res: Response;
    try {
      res = await fetch(signature.uploadUrl, {
        method: 'POST',
        body: form,
        signal: timeoutSignal(UPLOAD_TIMEOUT_MS),
      });
    } catch {
      throw new ApiError(0, 'network');
    }
    // Un 5xx de Cloudinary se reintenta en la próxima vuelta; un 4xx cuenta como intento fallido.
    if (!res.ok) throw new ApiError(res.status, res.status >= 500 ? 'unavailable' : 'validation_failed');
    const body: unknown = await res.json();
    return body;
  },
};
