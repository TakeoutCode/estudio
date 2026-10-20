import {
  type BackoffAnswer,
  type BreakEndCancel,
  type BreakEndSchedule,
  type NotificationState,
  NotificationStateSchema,
} from '@estudio/shared';
import { z } from 'zod';
import { deviceId } from '@/db/clock';
import { db as defaultDb, type EstudioDb } from '@/db/schema';
import { authorizedApi } from '@/features/auth';
import { ApiError } from '@/lib/api';
import { env } from '@/lib/env';
import { deviceSubscription, notificationPermission, subscribeDevice, subscriptionInput } from './push';

// Lo que este dispositivo le dice a la api sobre los avisos (NOTIFICATIONS §4, §6, §7). Las
// preferencias viajan por sync en UserSettings.notifications (features/settings).

const none = z.undefined();

async function sendSubscription(subscription: PushSubscription, database: EstudioDb): Promise<void> {
  const body = subscriptionInput(subscription, await deviceId(database), navigator.userAgent);
  await authorizedApi('/push/subscriptions', { method: 'POST', body, schema: none });
}

/**
 * NT8: pide el permiso y suscribe este dispositivo. Llamarla directo desde el gesto de ella:
 * iOS solo muestra la pregunta del sistema dentro de un toque.
 */
export async function enableOnThisDevice(database: EstudioDb = defaultDb): Promise<'granted' | 'denied'> {
  const key = env.VITE_VAPID_PUBLIC_KEY;
  if (key === undefined) throw new Error('vapid_not_configured');
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  await sendSubscription(await subscribeDevice(key), database);
  return 'granted';
}

/** Deja de recibir avisos en este dispositivo. Sin red, el servidor la borra al primer 410. */
export async function disableOnThisDevice(): Promise<void> {
  const subscription = await deviceSubscription();
  if (!subscription) return;
  await authorizedApi('/push/subscriptions', {
    method: 'DELETE',
    body: { endpoint: subscription.endpoint },
    schema: none,
  }).catch(() => undefined);
  await subscription.unsubscribe();
}

/** Al abrir la app: reenviarla es idempotente y repone una suscripción que el servidor perdió. */
export async function refreshDeviceSubscription(database: EstudioDb = defaultDb): Promise<void> {
  if (notificationPermission() !== 'granted') return;
  const subscription = await deviceSubscription();
  if (subscription) await sendSubscription(subscription, database);
}

/** NT4: al pasar a segundo plano durante un descanso. */
export async function scheduleBreakEnd(input: BreakEndSchedule): Promise<void> {
  await authorizedApi('/notifications/break-end', { method: 'PUT', body: input, schema: none, keepalive: true });
}

/** NT4, NT-T7: al volver a la app. */
export async function cancelBreakEnd(input: BreakEndCancel): Promise<void> {
  await authorizedApi('/notifications/break-end', { method: 'DELETE', body: input, schema: none, keepalive: true });
}

const PENDING_OPENS_KEY = 'notificationOpens';
const PendingOpensSchema = z.array(z.uuid());

async function pendingOpens(database: EstudioDb): Promise<string[]> {
  const parsed = PendingOpensSchema.safeParse((await database.meta.get(PENDING_OPENS_KEY))?.value);
  return parsed.success ? parsed.data : [];
}

/**
 * NT7: abrió la app desde un recordatorio. Sin red se guarda y se reporta después; un 404
 * (evento de otra cuenta o ya purgado) se descarta.
 */
export async function reportOpened(eventIds: readonly string[], database: EstudioDb = defaultDb): Promise<void> {
  const ids = [...new Set([...(await pendingOpens(database)), ...eventIds])];
  const left: string[] = [];
  for (const id of ids) {
    try {
      await authorizedApi(`/notifications/${id}/opened`, { method: 'POST', schema: none });
    } catch (error: unknown) {
      if (error instanceof ApiError && (error.code === 'network' || error.status >= 500)) left.push(id);
    }
  }
  await database.meta.put({ key: PENDING_OPENS_KEY, value: left });
}

export const fetchNotificationState = (): Promise<NotificationState> =>
  authorizedApi('/notifications/state', { schema: NotificationStateSchema });

/** NT7: la respuesta a la pregunta única del modo reducido. */
export async function answerBackoff(choice: BackoffAnswer['choice']): Promise<void> {
  await authorizedApi('/notifications/backoff', { method: 'POST', body: { choice }, schema: none });
}
