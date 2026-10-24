import type { PushPayload } from '@estudio/shared';
import webpush from 'web-push';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../config/app-config.js';
import { WebPushSender } from './push-sender.js';

const keys = webpush.generateVAPIDKeys();
const config = {
  get: (key: string) =>
    ({
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      VAPID_SUBJECT: 'mailto:avisos@ejemplo.mx',
    })[key],
} as unknown as AppConfig;
const target = { endpoint: 'https://push.example/abc', p256dh: 'p', auth: 'a' };
const payload = { title: 'Repaso', body: 'Tienes 12 pendientes', url: '/' } as unknown as PushPayload;
const rejected = (status: number) => new webpush.WebPushError('fallo', status, {}, '', target.endpoint);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('WebPushSender (BE13, NT8)', () => {
  it('BE13: envía con TTL, urgencia normal y un timeout de 10 s', async () => {
    const send = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    expect(await new WebPushSender(config).send(target, payload, { ttlSec: 300 })).toBe('ok');
    expect(send.mock.calls[0]?.[2]).toMatchObject({ TTL: 300, urgency: 'normal', timeout: 10_000 });
  });

  it('BE13: reintenta un 429 o un 5xx con espera creciente y entrega al recuperarse', async () => {
    vi.useFakeTimers();
    const send = vi
      .spyOn(webpush, 'sendNotification')
      .mockRejectedValueOnce(rejected(503))
      .mockRejectedValueOnce(rejected(429))
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    const done = new WebPushSender(config).send(target, payload, { ttlSec: 300 });
    await vi.runAllTimersAsync();
    expect(await done).toBe('ok');
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('BE13: tras 3 reintentos queda como fallido; un 4xx o un timeout no se reintentan', async () => {
    vi.useFakeTimers();
    const down = vi.spyOn(webpush, 'sendNotification').mockRejectedValue(rejected(500));
    const done = new WebPushSender(config).send(target, payload, { ttlSec: 300 });
    await vi.runAllTimersAsync();
    expect(await done).toBe('failed');
    expect(down).toHaveBeenCalledTimes(4);

    for (const error of [rejected(400), new Error('Socket timeout')]) {
      const once = vi.spyOn(webpush, 'sendNotification').mockReset().mockRejectedValue(error);
      expect(await new WebPushSender(config).send(target, payload, { ttlSec: 300 })).toBe('failed');
      expect(once).toHaveBeenCalledTimes(1);
    }
  });

  it('NT8: 404 y 410 dicen que la suscripción ya no existe, sin reintentar', async () => {
    for (const status of [404, 410]) {
      const gone = vi.spyOn(webpush, 'sendNotification').mockReset().mockRejectedValue(rejected(status));
      expect(await new WebPushSender(config).send(target, payload, { ttlSec: 300 })).toBe('gone');
      expect(gone).toHaveBeenCalledTimes(1);
    }
  });
});
