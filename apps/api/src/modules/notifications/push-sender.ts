import type { PushPayload } from '@estudio/shared';
import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { AppConfig } from '../../config/app-config.js';

export interface PushTarget {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

export interface PushOptions {
  /** NT5: 4 h para recordatorios, 5 min para el fin de descanso. */
  readonly ttlSec: number;
}

/** `gone`: el servicio respondió 404 o 410 y la suscripción ya no existe (NT8, NT-T9). */
export type PushResult = 'ok' | 'gone' | 'failed';

/** BE13: timeout explícito; reintentos solo ante 429/5xx, con espera creciente. */
const TIMEOUT_MS = 10_000;
const RETRIES = 3;
const BACKOFF_MS = 500;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** QUALITY §1: se reemplaza por uno falso en las pruebas. */
export abstract class PushSender {
  abstract send(target: PushTarget, payload: PushPayload, options: PushOptions): Promise<PushResult>;
}

/**
 * Web Push con VAPID (ARC8: la clave privada solo vive aquí). Sin claves (desarrollo), no
 * envía: el evento queda registrado como fallido y la app sigue funcionando.
 */
@Injectable()
export class WebPushSender extends PushSender {
  private readonly logger = new Logger(WebPushSender.name);
  private readonly ready: boolean;

  constructor(config: AppConfig) {
    super();
    const publicKey = config.get('VAPID_PUBLIC_KEY');
    const privateKey = config.get('VAPID_PRIVATE_KEY');
    const subject = config.get('VAPID_SUBJECT');
    this.ready = publicKey !== undefined && privateKey !== undefined && subject !== undefined;
    if (this.ready && publicKey && privateKey && subject)
      webpush.setVapidDetails(subject, publicKey, privateKey);
    else this.logger.warn('Sin claves VAPID: los avisos se registran sin enviarse');
  }

  async send(target: PushTarget, payload: PushPayload, options: PushOptions): Promise<PushResult> {
    if (!this.ready) return 'failed';
    for (let attempt = 0; ; attempt += 1) {
      try {
        await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(payload),
          { TTL: options.ttlSec, urgency: 'normal', timeout: TIMEOUT_MS },
        );
        return 'ok';
      } catch (error: unknown) {
        const status = error instanceof webpush.WebPushError ? error.statusCode : null;
        if (status === 404 || status === 410) return 'gone';
        // Un timeout (sin status) no se reintenta: el aviso podría haber llegado.
        const retryable = status !== null && (status === 429 || status >= 500);
        if (!retryable || attempt >= RETRIES) {
          // BE6: sin contenido ni endpoint en el log.
          this.logger.warn({ status, attempts: attempt + 1 }, 'Fallo al enviar un aviso');
          return 'failed';
        }
        await wait(BACKOFF_MS * 2 ** attempt);
      }
    }
  }
}
