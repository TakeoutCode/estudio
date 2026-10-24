import {
  type BreakEndSchedule,
  type Exam,
  ExamSchema,
  type PushSubscriptionInput,
  type ReviewLog,
  ReviewLogSchema,
} from '@estudio/shared';
import type { ReminderEvent } from '@estudio/srs';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { PrismaTxHost } from '../../prisma/transaction.js';
import type { PushTarget } from './push-sender.js';

const num = (value: bigint | number): number => Number(value);

const SETTINGS_SECTIONS = ['notifications', 'profile', 'study'];

export interface StoredSubscription extends PushTarget {
  readonly id: string;
}

export interface NotificationUser {
  readonly userId: string;
  readonly settings: Readonly<Record<string, unknown>>;
}

/** Lo que el cron necesita para calcular los recordatorios de una cuenta (NT3). */
export interface StudyData {
  readonly notes: readonly {
    readonly id: string;
    readonly deckId: string;
    readonly topicId: string | null;
  }[];
  /** Mazos en pausa: sus tarjetas no cuentan como pendientes (como en Hoy). */
  readonly pausedDeckIds: ReadonlySet<string>;
  readonly cards: readonly {
    readonly id: string;
    readonly noteId: string;
    readonly createdAt: number;
    readonly lapseBaseline: number;
  }[];
  readonly logs: readonly ReviewLog[];
  readonly exams: readonly Exam[];
  readonly topicNames: ReadonlyMap<string, string>;
}

export interface NewEvent {
  readonly id: string;
  readonly userId: string;
  readonly kinds: readonly string[];
  readonly localDate: string;
  /** §3d: 1 = a la hora del recordatorio, 2 = a la segunda hora. */
  readonly slot: 1 | 2;
  readonly scheduledFor: number;
  readonly status: 'pending' | 'suppressed';
  readonly reason: string | null;
  readonly payload: Prisma.InputJsonValue | null;
  readonly examDays: readonly string[];
}

@Injectable()
export class NotificationsRepository {
  constructor(private readonly txHost: TransactionHost) {}

  private get tx() {
    return (this.txHost as PrismaTxHost).tx;
  }

  /** ARC7: un solo tick a la vez; el lock se suelta al terminar la transacción. */
  async tryJobLock(key: string): Promise<boolean> {
    const rows = await this.tx.$queryRaw<{ ok: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS ok`;
    return rows[0]?.ok === true;
  }

  // ── Suscripciones ────────────────────────────────────────────────────────────────

  /** El mismo endpoint en otra cuenta (otro usuario en el mismo navegador) pasa a esta. */
  async upsertSubscription(userId: string, id: string, input: PushSubscriptionInput): Promise<void> {
    const data = {
      userId,
      deviceId: input.deviceId,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent,
      failures: 0,
    };
    await this.tx.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { id, endpoint: input.endpoint, ...data },
      update: data,
    });
  }

  async deleteSubscription(userId: string, endpoint: string): Promise<void> {
    await this.tx.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  async subscriptionsOf(userId: string): Promise<StoredSubscription[]> {
    const rows = await this.tx.pushSubscription.findMany({ where: { userId } });
    return rows.map((r) => ({ id: r.id, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth }));
  }

  async recordDelivery(id: string, result: 'ok' | 'gone' | 'failed', at: Date): Promise<void> {
    if (result === 'gone') await this.tx.pushSubscription.deleteMany({ where: { id } });
    else if (result === 'ok') {
      await this.tx.pushSubscription.updateMany({ where: { id }, data: { lastSuccessAt: at, failures: 0 } });
    } else {
      await this.tx.pushSubscription.updateMany({ where: { id }, data: { failures: { increment: 1 } } });
    }
  }

  // ── Fin de descanso (NT4) ───────────────────────────────────────────────────────

  /** Una sola fila por bloque (NT-T8): reprogramar cambia la hora si todavía no salió. */
  async scheduleBreakEnd(userId: string, id: string, input: BreakEndSchedule): Promise<void> {
    const key = { timerSessionId: input.timerSessionId, blockIndex: input.blockIndex };
    const existing = await this.tx.scheduledNotification.findUnique({
      where: { timerSessionId_blockIndex: key },
    });
    if (existing && existing.userId !== userId) return;
    if (existing?.sentAt != null) return;
    await this.tx.scheduledNotification.upsert({
      where: { timerSessionId_blockIndex: key },
      create: { id, userId, ...key, fireAt: input.fireAt },
      update: { fireAt: input.fireAt, cancelledAt: null },
    });
  }

  async cancelBreakEnd(
    userId: string,
    timerSessionId: string,
    blockIndex: number,
    now: number,
  ): Promise<void> {
    await this.tx.scheduledNotification.updateMany({
      where: { userId, timerSessionId, blockIndex, sentAt: null },
      data: { cancelledAt: now },
    });
  }

  async dueBreakEnds(now: number): Promise<{ id: string; userId: string; fireAt: number }[]> {
    const rows = await this.tx.scheduledNotification.findMany({
      where: { fireAt: { lte: now }, cancelledAt: null, sentAt: null },
      select: { id: true, userId: true, fireAt: true },
    });
    return rows.map((r) => ({ ...r, fireAt: num(r.fireAt) }));
  }

  /** `sentAt` marca el bloque como procesado: no se vuelve a evaluar aunque se suprima. */
  async claimBreakEnd(id: string, now: number): Promise<void> {
    await this.tx.scheduledNotification.update({ where: { id }, data: { sentAt: now } });
  }

  // ── Recordatorios (NT3, NT5) ────────────────────────────────────────────────────

  /** Cuentas con la sección `notifications` guardada, con las secciones que usa el cron. */
  async usersWithNotifications(): Promise<NotificationUser[]> {
    const rows = await this.tx.userSettings.findMany({
      where: { deletedAt: null, section: { in: SETTINGS_SECTIONS } },
      select: { userId: true, section: true, data: true },
    });
    const byUser = new Map<string, Record<string, unknown>>();
    for (const row of rows) byUser.set(row.userId, { ...byUser.get(row.userId), [row.section]: row.data });
    return [...byUser.entries()]
      .filter(([, settings]) => 'notifications' in settings)
      .map(([userId, settings]) => ({ userId, settings }));
  }

  async settingsOf(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.tx.userSettings.findMany({
      where: { userId, deletedAt: null, section: { in: SETTINGS_SECTIONS } },
      select: { section: true, data: true },
    });
    return Object.fromEntries(rows.map((r) => [r.section, r.data]));
  }

  async studyData(userId: string): Promise<StudyData> {
    const [notes, cards, logs, exams, topics, paused] = await Promise.all([
      this.tx.note.findMany({
        where: { userId, deletedAt: null },
        select: { id: true, deckId: true, topicId: true },
      }),
      this.tx.card.findMany({
        where: { userId, deletedAt: null },
        select: { id: true, noteId: true, createdAt: true, lapseBaseline: true },
      }),
      this.tx.reviewLog.findMany({ where: { userId } }),
      this.tx.exam.findMany({ where: { userId, deletedAt: null } }),
      this.tx.topic.findMany({ where: { userId, deletedAt: null }, select: { id: true, name: true } }),
      this.tx.deck.findMany({
        where: { userId, deletedAt: null, pausedAt: { not: null } },
        select: { id: true },
      }),
    ]);
    return {
      notes,
      pausedDeckIds: new Set(paused.map((d) => d.id)),
      cards: cards.map((c) => ({ ...c, createdAt: num(c.createdAt) })),
      logs: logs.map((l) =>
        ReviewLogSchema.parse({
          id: l.id,
          cardId: l.cardId,
          cardKind: l.cardKind,
          reviewedAt: num(l.reviewedAt),
          rating: l.rating,
          durationMs: l.durationMs,
          type: l.type,
          confidence: l.confidence,
          sessionId: l.sessionId,
          deviceId: l.deviceId,
          ...(l.answer === null ? {} : { answer: l.answer }),
        }),
      ),
      exams: exams.map((e) =>
        ExamSchema.parse({
          id: e.id,
          title: e.title,
          date: num(e.date),
          topicIds: e.topicIds,
          hlc: e.hlc,
          updatedAt: num(e.updatedAt),
          deletedAt: null,
        }),
      ),
      topicNames: new Map(topics.map((t) => [t.id, t.name])),
    };
  }

  async hasEventFor(userId: string, localDate: string, slot: 1 | 2): Promise<boolean> {
    return (await this.tx.notificationEvent.count({ where: { userId, localDate, slot } })) > 0;
  }

  /** §3d: recordatorios que ya salieron (o están saliendo) en su día local, para el tope. */
  async remindersOn(userId: string, localDate: string): Promise<number> {
    return this.tx.notificationEvent.count({
      where: { userId, localDate, status: { in: ['sent', 'pending'] } },
    });
  }

  /** Los recordatorios enviados: dan la serie de ignorados (§3f) y los exámenes ya avisados. */
  async sentReminders(userId: string): Promise<{ events: ReminderEvent[]; examDays: Set<string> }> {
    const rows = await this.tx.notificationEvent.findMany({
      where: { userId, status: 'sent' },
      select: { sentAt: true, openedAt: true, examDays: true },
    });
    return {
      events: rows.flatMap((r) =>
        r.sentAt === null
          ? []
          : [{ sentAt: num(r.sentAt), openedAt: r.openedAt === null ? null : num(r.openedAt) }],
      ),
      examDays: new Set(rows.flatMap((r) => r.examDays)),
    };
  }

  /** NT-T6: la unicidad (usuario, día, slot) reclama esa hora; si otro tick ganó, devuelve false. */
  async insertEvent(event: NewEvent): Promise<boolean> {
    const result = await this.tx.notificationEvent.createMany({
      data: [
        {
          id: event.id,
          userId: event.userId,
          kinds: [...event.kinds],
          localDate: event.localDate,
          slot: event.slot,
          scheduledFor: event.scheduledFor,
          status: event.status,
          reason: event.reason,
          // Parámetros del texto, no el texto: así se puede revisar qué se dijo (§6).
          ...(event.payload === null ? {} : { payloadKey: 'reminder', payloadParams: event.payload }),
          examDays: [...event.examDays],
        },
      ],
      skipDuplicates: true,
    });
    return result.count === 1;
  }

  async finishEvent(id: string, outcome: 'sent' | 'failed' | 'no_subscription', now: number): Promise<void> {
    await this.tx.notificationEvent.update({
      where: { id },
      data:
        outcome === 'sent'
          ? { status: 'sent', sentAt: now }
          : { status: 'failed', reason: outcome === 'no_subscription' ? outcome : null },
    });
  }

  /** NT7: solo la primera apertura cuenta. */
  async markOpened(userId: string, id: string, now: number): Promise<boolean> {
    const found = await this.tx.notificationEvent.findFirst({ where: { id, userId }, select: { id: true } });
    if (!found) return false;
    await this.tx.notificationEvent.updateMany({ where: { id, openedAt: null }, data: { openedAt: now } });
    return true;
  }

  async state(userId: string): Promise<{ backoffResetAt: number | null; questionAnsweredAt: number | null }> {
    const row = await this.tx.notificationState.findUnique({ where: { userId } });
    return {
      backoffResetAt: row?.backoffResetAt == null ? null : num(row.backoffResetAt),
      questionAnsweredAt: row?.backoffQuestionAnsweredAt == null ? null : num(row.backoffQuestionAnsweredAt),
    };
  }

  async saveState(
    userId: string,
    data: { backoffResetAt?: number; backoffQuestionAnsweredAt?: number },
  ): Promise<void> {
    await this.tx.notificationState.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  }
}
