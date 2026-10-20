import { describe, expect, it } from 'vitest';
import { type PushEnvironment, pushSupport, subscriptionInput, vapidKeyBytes } from './push';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
const env = (patch: Partial<PushEnvironment> = {}): PushEnvironment => ({
  userAgent: MAC,
  maxTouchPoints: 0,
  standalone: false,
  hasPush: true,
  vapidKey: 'clave',
  ...patch,
});

describe('NT8: dónde hay Web Push', () => {
  it('en Safari de iPhone o iPad (pestaña) explica cómo instalar; instalada, funciona', () => {
    expect(pushSupport(env({ userAgent: IPHONE, hasPush: false }))).toBe('install');
    expect(pushSupport(env({ maxTouchPoints: 5 }))).toBe('install'); // iPadOS se presenta como Mac
    expect(pushSupport(env({ userAgent: IPHONE, standalone: true }))).toBe('ready');
  });

  it('sin API de push o sin clave VAPID no se ofrece', () => {
    expect(pushSupport(env())).toBe('ready');
    expect(pushSupport(env({ hasPush: false }))).toBe('unsupported');
    expect(pushSupport(env({ vapidKey: undefined }))).toBe('unsupported');
  });

  it('la clave VAPID base64url se convierte en bytes', () => {
    expect([...vapidKeyBytes('AQID_-8')]).toEqual([1, 2, 3, 255, 239]);
  });

  it('la suscripción del navegador se valida con el contrato de shared (AG2)', () => {
    const subscription = {
      endpoint: 'https://push.ejemplo.mx/abc',
      toJSON: () => ({ endpoint: 'https://push.ejemplo.mx/abc', keys: { p256dh: 'p', auth: 'a' } }),
    } as unknown as PushSubscription;
    const deviceId = '0192f1a0-0000-7000-8000-0000000000d1';
    expect(subscriptionInput(subscription, deviceId, 'x'.repeat(400))).toEqual({
      deviceId,
      endpoint: 'https://push.ejemplo.mx/abc',
      keys: { p256dh: 'p', auth: 'a' },
      userAgent: 'x'.repeat(300),
    });
    const broken = { endpoint: subscription.endpoint, toJSON: () => ({}) } as unknown as PushSubscription;
    expect(() => subscriptionInput(broken, deviceId, '')).toThrow();
  });
});
