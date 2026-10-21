import { type PushSubscriptionInput, PushSubscriptionInputSchema } from '@estudio/shared';

// NOTIFICATIONS NT8: Web Push con la clave pública VAPID (la privada solo vive en la api).

export interface PushEnvironment {
  readonly userAgent: string;
  readonly maxTouchPoints: number;
  /** Abierta como app instalada (pantalla de inicio), no en una pestaña. */
  readonly standalone: boolean;
  readonly hasPush: boolean;
  readonly vapidKey: string | undefined;
}

/** `install`: iPhone o iPad en una pestaña de Safari; ahí iOS no ofrece Web Push. */
export type PushSupport = 'ready' | 'install' | 'unsupported';

export function pushSupport(env: PushEnvironment): PushSupport {
  // iPadOS se presenta como Mac; lo delata la pantalla táctil.
  const ios =
    /iPhone|iPad|iPod/.test(env.userAgent) || (env.userAgent.includes('Macintosh') && env.maxTouchPoints > 1);
  if (ios && !env.standalone) return 'install';
  return env.hasPush && env.vapidKey !== undefined ? 'ready' : 'unsupported';
}

export function detectEnvironment(vapidKey: string | undefined): PushEnvironment {
  const nav = navigator as Navigator & { readonly standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints,
    standalone: window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true,
    hasPush: 'serviceWorker' in nav && 'PushManager' in window && 'Notification' in window,
    vapidKey,
  };
}

/** `default` también cuando el navegador no tiene la API. */
export const notificationPermission = (): NotificationPermission =>
  typeof Notification === 'undefined' ? 'default' : Notification.permission;

/** La clave VAPID viene en base64url; `subscribe` la quiere en bytes. */
export function vapidKeyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/** La suscripción de este dispositivo, si ya tiene. */
export async function deviceSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

export async function subscribeDevice(vapidKey: string): Promise<PushSubscription> {
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  return (
    existing ??
    registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyBytes(vapidKey),
    })
  );
}

export function subscriptionInput(
  subscription: PushSubscription,
  deviceId: string,
  userAgent: string,
): PushSubscriptionInput {
  const { keys } = subscription.toJSON();
  return PushSubscriptionInputSchema.parse({
    deviceId,
    endpoint: subscription.endpoint,
    keys: { p256dh: keys?.p256dh, auth: keys?.auth },
    userAgent: userAgent.slice(0, 300),
  });
}
