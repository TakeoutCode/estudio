import { z } from 'zod';

// Contratos HTTP de los avisos (NOTIFICATIONS §2, NT4, NT7, NT8). Los usan la web y la api
// (AGENTS AG2). La política está en `srs` (`decideNotification`).

const epochMs = () => z.number().int().nonnegative();

/** NT8: la suscripción Web Push de este dispositivo, tal como la da el navegador. */
export const PushSubscriptionInputSchema = z
  .object({
    deviceId: z.uuid(),
    endpoint: z.url({ protocol: /^https$/ }).max(1000),
    keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }).strict(),
    userAgent: z.string().max(300).nullable(),
  })
  .strict();
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInputSchema>;

export const PushUnsubscribeSchema = z.object({ endpoint: z.url().max(1000) }).strict();
export type PushUnsubscribe = z.infer<typeof PushUnsubscribeSchema>;

/** NT4: el fin de descanso lo programa el cliente al pasar a segundo plano. */
export const BreakEndScheduleSchema = z
  .object({
    timerSessionId: z.uuid(),
    blockIndex: z.number().int().nonnegative(),
    fireAt: epochMs(),
  })
  .strict();
export type BreakEndSchedule = z.infer<typeof BreakEndScheduleSchema>;

export const BreakEndCancelSchema = BreakEndScheduleSchema.omit({ fireAt: true }).strict();
export type BreakEndCancel = z.infer<typeof BreakEndCancelSchema>;

/** NT7: modo reducido y si hay que preguntarle (una sola vez, dentro de la app). */
export const NotificationStateSchema = z
  .object({ backoff: z.boolean(), askBackoffQuestion: z.boolean() })
  .strict();
export type NotificationState = z.infer<typeof NotificationStateSchema>;

/** NT7: "Como antes", "Cada N días" o "Desactivar" (esto último lo guarda la app en sus ajustes). */
export const BackoffAnswerSchema = z.object({ choice: z.enum(['as_before', 'reduced', 'off']) }).strict();
export type BackoffAnswer = z.infer<typeof BackoffAnswerSchema>;

/** NT5, NT6: lo que recibe el service worker. El texto ya viene neutro del catálogo. */
export const PushPayloadSchema = z
  .object({
    title: z.string().min(1),
    body: z.string(),
    tag: z.enum(['reminder', 'break']),
    /** Ruta de la app a abrir; con `?aviso=<id>` la app registra la apertura (NT7). */
    url: z.string().startsWith('/'),
  })
  .strict();
export type PushPayload = z.infer<typeof PushPayloadSchema>;
