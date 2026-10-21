import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { AppConfig } from '../../config/app-config.js';
import { parseCloudinaryUrl } from './media-signer.js';

/** BE13: puerto hacia Cloudinary para borrar todo lo de una cuenta (QUALITY QA6). */
export abstract class MediaPurger {
  /** Borra todo bajo `estudio/<userId>/`; `unconfigured` si no hay Cloudinary (desarrollo). */
  abstract purgeUser(userId: string): Promise<'purged' | 'unconfigured'>;
}

/** BE13: timeout explícito; reintentos solo ante 429/5xx, con espera creciente. */
const TIMEOUT_MS = 10_000;
const RETRIES = 3;
const BACKOFF_MS = 500;
/** Cloudinary borra hasta 1000 por llamada; con `partial` hay que volver a pedir. */
const MAX_ROUNDS = 50;

const DeleteResponseSchema = z.object({
  partial: z.boolean().optional(),
  next_cursor: z.string().optional(),
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Admin API de Cloudinary: `DELETE resources/image/upload?prefix=…` hasta que no queda nada, y
 * después la carpeta vacía (si no existe, no importa). Lanza si Cloudinary no responde: así
 * `DELETE /me` falla antes de tocar Postgres y ella puede reintentar.
 */
@Injectable()
export class CloudinaryPurger extends MediaPurger {
  private readonly logger = new Logger(CloudinaryPurger.name);
  private readonly account;

  constructor(config: AppConfig) {
    super();
    this.account = parseCloudinaryUrl(config.get('CLOUDINARY_URL'));
  }

  async purgeUser(userId: string): Promise<'purged' | 'unconfigured'> {
    if (!this.account) return 'unconfigured';
    const folder = `estudio/${userId}`;
    let cursor: string | undefined;
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const query = new URLSearchParams({ prefix: `${folder}/` });
      if (cursor) query.set('next_cursor', cursor);
      const res = await this.call('DELETE', `resources/image/upload?${query.toString()}`);
      if (!res.ok) throw new Error(`cloudinary_purge_failed_${String(res.status)}`);
      const body = DeleteResponseSchema.parse(await res.json());
      if (!body.partial) break;
      cursor = body.next_cursor;
    }
    const folderRes = await this.call('DELETE', `folders/${folder}`);
    // BE6: sin el userId en el log.
    if (!folderRes.ok && folderRes.status !== 404)
      this.logger.warn({ status: folderRes.status }, 'Carpeta sin borrar');
    return 'purged';
  }

  private async call(method: 'DELETE', path: string): Promise<Response> {
    const account = this.account;
    if (!account) throw new Error('cloudinary_unconfigured');
    const auth = Buffer.from(`${account.apiKey}:${account.apiSecret}`).toString('base64');
    for (let attempt = 0; ; attempt += 1) {
      const res = await fetch(`https://api.cloudinary.com/v1_1/${account.cloudName}/${path}`, {
        method,
        headers: { authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= RETRIES) return res;
      await wait(BACKOFF_MS * 2 ** attempt);
    }
  }
}
