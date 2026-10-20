import {
  type BackoffAnswer,
  type BreakEndCancel,
  type BreakEndSchedule,
  localDateOf,
  newId,
  NOTIFICATION_DELIVERY,
  type NotificationPrefs,
  NotificationPrefsSchema,
  type NotificationState,
  ProfileSettingsSchema,
  type PushPayload,
  type PushSubscriptionInput,
  type StudyConfig,
  StudyConfigSchema,
} from '@estudio/shared';
import {
  backoffState,
  type BackoffState,
  createScheduler,
  decideNotification,
  type PlannerCard,
  REMINDER_ORDER,
  reminderCandidates,
  reminderTimeCrossed,
  replayCards,
} from '@estudio/srs';
import { Transactional } from '@nestjs-cls/transactional';
import { Injectable, Logger } from '@nestjs/common';
import { UseCls } from 'nestjs-cls';
import { Clock } from '../../common/clock.js';
import { DomainError } from '../../common/domain-error.js';
import { type NewEvent, NotificationsRepository } from './notifications.repository.js';
import { PushSender } from './push-sender.js';
import { type ReminderParams, reminderBody, text } from './texts.js';

const REMINDER_LOCK = 'notifications:reminders';
const BREAK_END_LOCK = 'notifications:break-end';
const NO_BACKOFF: BackoffState = { active: false, lastReminderAt: null };

interface UserContext {
  readonly prefs: NotificationPrefs;
  readonly timeZone: string;
  readonly study: StudyConfig;
}

/** Lo que sale después del commit: el envío no ocurre dentro de la transacción. */
interface Outgoing {
  readonly userId: string;
  /** `null` en el fin de descanso: no es un recordatorio y no lleva evento (NT4). */
  readonly eventId: string | null;
  readonly payload: PushPayload;
  readonly ttlSec: number;
}

/** Ajustes ya validados; una sección que falta toma sus valores iniciales (avisos apagados). */
function contextOf(settings: Readonly<Record<string, unknown>>): UserContext | null {
  const prefs = NotificationPrefsSchema.safeParse(settings.notifications ?? {});
  const profile = ProfileSettingsSchema.safeParse(settings.profile ?? {});
  const study = StudyConfigSchema.safeParse(settings.study ?? {});
  if (!prefs.success || !profile.success || !study.success) return null;
  return { prefs: prefs.data, timeZone: profile.data.timeZone, study: study.data };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly repo: NotificationsRepository,
    private readonly sender: PushSender,
    private readonly clock: Clock,
  ) {}

  // ── Desde la app ────────────────────────────────────────────────────────────────

  @Transactional()
  async subscribe(userId: string, input: PushSubscriptionInput): Promise<void> {
    await this.repo.upsertSubscription(userId, newId(), input);
  }

  @Transactional()
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.repo.deleteSubscription(userId, endpoint);
  }

  /** NT4: al pasar a segundo plano durante un descanso. */
  @Transactional()
  async scheduleBreakEnd(userId: string, input: BreakEndSchedule): Promise<void> {
    await this.repo.scheduleBreakEnd(userId, newId(), input);
  }

  /** NT4, NT-T7: al volver a la app ya no hace falta avisar. */
  @Transactional()
  async cancelBreakEnd(userId: string, input: BreakEndCancel): Promise<void> {
    await this.repo.cancelBreakEnd(userId, input.timerSessionId, input.blockIndex, this.clock.now());
  }

  /** NT7: la app abrió desde un recordatorio; reinicia la serie de ignorados. */
  @Transactional()
  async markOpened(userId: string, eventId: string): Promise<void> {
    if (!(await this.repo.markOpened(userId, eventId, this.clock.now()))) throw new DomainError('not_found');
  }

  /**
   * NT7: modo reducido y si hay que preguntarle. Se pregunta una vez por cada entrada al modo
   * reducido; si eligió "Cada N días", no se vuelve a preguntar.
   */
  async state(userId: string): Promise<NotificationState> {
    const [settings, sent, stored] = await Promise.all([
      this.repo.settingsOf(userId),
      this.repo.sentReminders(userId),
      this.repo.state(userId),
    ]);
    const prefs = contextOf(settings)?.prefs;
    if (!prefs?.enabled) return { backoff: false, askBackoffQuestion: false };
    const { active } = backoffState(sent.events, this.clock.now(), prefs, stored.backoffResetAt);
    const answered = stored.questionAnsweredAt;
    const resetAt = stored.backoffResetAt;
    return {
      backoff: active,
      askBackoffQuestion: active && (answered === null || (resetAt !== null && answered <= resetAt)),
    };
  }

  /** NT7: "Como antes" reinicia la serie; "Desactivar" lo guarda la app en sus ajustes. */
  @Transactional()
  async answerBackoff(userId: string, { choice }: BackoffAnswer): Promise<void> {
    const now = this.clock.now();
    await this.repo.saveState(
      userId,
      choice === 'as_before'
        ? { backoffResetAt: now, backoffQuestionAnsweredAt: now }
        : { backoffQuestionAnsweredAt: now },
    );
  }

  // ── Cron (BE14) ─────────────────────────────────────────────────────────────────

  /** NT3: recordatorios de las cuentas cuya hora cayó en `(since, now]`. */
  @UseCls()
  async runReminderTick(now: number, since: number): Promise<void> {
    for (const item of await this.claimReminders(now, since)) await this.deliver(item, now);
  }

  /** NT4: fines de descanso vencidos. */
  @UseCls()
  async runBreakEndTick(now: number): Promise<void> {
    for (const item of await this.claimBreakEnds(now)) await this.deliver(item, now);
  }

  /**
   * ARC7: bajo advisory lock, registra un evento por cuenta y día (enviado o suprimido con su
   * motivo, §6). Devuelve los que hay que enviar.
   */
  @Transactional()
  async claimReminders(now: number, since: number): Promise<Outgoing[]> {
    if (!(await this.repo.tryJobLock(REMINDER_LOCK))) return [];
    const outgoing: Outgoing[] = [];
    for (const user of await this.repo.usersWithNotifications()) {
      const ctx = contextOf(user.settings);
      const time = ctx?.prefs.dailyReminderTime ?? null;
      if (!ctx?.prefs.enabled || time === null) continue;
      if (!reminderTimeCrossed(since, now, ctx.timeZone, time)) continue;
      const localDate = localDateOf(now, ctx.timeZone);
      if (await this.repo.hasEventFor(user.userId, localDate)) continue;
      const item = await this.claimReminder(user.userId, ctx, now, localDate).catch((error: unknown) => {
        // Datos de una cuenta que no validan no frenan a las demás. BE6: solo el id.
        this.logger.error({ err: error, userId: user.userId }, 'No se pudo calcular un recordatorio');
        return null;
      });
      if (item) outgoing.push(item);
    }
    return outgoing;
  }

  private async claimReminder(
    userId: string,
    ctx: UserContext,
    now: number,
    localDate: string,
  ): Promise<Outgoing | null> {
    const event = await this.reminderEvent(userId, ctx, now, localDate);
    if (!(await this.repo.insertEvent(event)) || event.payload === null) return null;
    return {
      userId,
      eventId: event.id,
      payload: { title: text('title'), body: reminderBody(event.payload), tag: 'reminder', url: `/?aviso=${event.id}` },
      ttlSec: NOTIFICATION_DELIVERY.reminderTtlSeconds,
    };
  }

  /** NT2, NT3, NT5: qué califica, qué decide la política y qué dice el aviso. */
  private async reminderEvent(
    userId: string,
    ctx: UserContext,
    now: number,
    localDate: string,
  ): Promise<NewEvent & { readonly payload: ReminderParams | null }> {
    const [data, sent, stored] = await Promise.all([
      this.repo.studyData(userId),
      this.repo.sentReminders(userId),
      this.repo.state(userId),
    ]);
    const liveNotes = new Map(data.notes.map((n) => [n.id, n.topicId]));
    const cards = data.cards.filter((c) => liveNotes.has(c.noteId));
    const states = replayCards(
      cards.map((c) => ({ cardId: c.id, createdAt: c.createdAt })),
      data.logs,
      ctx.study,
    );
    const plannerCards: PlannerCard[] = cards.flatMap((card, i) => {
      const state = states[i];
      return state ? [{ state, topicId: liveNotes.get(card.noteId) ?? null, lapseBaseline: card.lapseBaseline }] : [];
    });
    const candidates = reminderCandidates({
      cards: plannerCards,
      logs: data.logs,
      config: ctx.study,
      scheduler: createScheduler(ctx.study.fsrs),
      exams: data.exams,
      notifiedExamDays: sent.examDays,
      prefs: ctx.prefs,
      now,
      timeZone: ctx.timeZone,
    });
    const backoff = backoffState(sent.events, now, ctx.prefs, stored.backoffResetAt);

    const qualifies = {
      exam_soon: candidates.examSoon.length > 0,
      study_plan: candidates.studyPlan !== null,
      daily_reminder: true, // el mínimo de pendientes lo decide la política (§3b)
    };
    const decisions = REMINDER_ORDER.filter((kind) => qualifies[kind]).map((kind) => ({
      kind,
      decision: decideNotification({
        kind,
        nowUtc: now,
        timeZone: ctx.timeZone,
        prefs: ctx.prefs,
        // Sin evento hoy (`hasEventFor`): todavía no salió ningún recordatorio en su día.
        remindersSentToday: 0,
        dueCount: candidates.dueToday.count,
        backoff,
      }),
    }));
    const sending = new Set(decisions.filter((d) => d.decision.send).map((d) => d.kind));
    const base = { id: newId(), userId, localDate, scheduledFor: now };

    if (sending.size === 0) {
      const skipped = decisions.find((d) => !d.decision.send)?.decision;
      return {
        ...base,
        kinds: decisions.map((d) => d.kind),
        status: 'suppressed',
        reason: skipped && !skipped.send ? skipped.reason : null,
        payload: null,
        examDays: [],
      };
    }

    const topicNames = (ids: readonly string[]) =>
      ids.flatMap((id) => {
        const name = data.topicNames.get(id);
        return name === undefined ? [] : [name];
      });
    const examTitles = new Map(data.exams.map((e) => [e.id, e.title]));
    const examSoon = sending.has('exam_soon') ? candidates.examSoon : [];
    const plan = sending.has('study_plan') ? candidates.studyPlan : null;
    return {
      ...base,
      kinds: [...sending],
      status: 'pending',
      reason: null,
      payload: {
        examSoon: examSoon.map((e) => ({ title: examTitles.get(e.examId) ?? '', days: e.days })),
        studyPlan: plan ? { count: plan.newToday, topics: topicNames(plan.topicIds) } : null,
        due: sending.has('daily_reminder')
          ? { count: candidates.dueToday.count, topics: topicNames(candidates.dueToday.topicIds) }
          : null,
      },
      examDays: examSoon.map((e) => `${e.examId}:${String(e.days)}`),
    };
  }

  /** NT4: se procesa una sola vez; fuera de horas silenciosas y si sigue siendo útil. */
  @Transactional()
  async claimBreakEnds(now: number): Promise<Outgoing[]> {
    if (!(await this.repo.tryJobLock(BREAK_END_LOCK))) return [];
    const ttlMs = NOTIFICATION_DELIVERY.breakEndTtlSeconds * 1000;
    const outgoing: Outgoing[] = [];
    for (const due of await this.repo.dueBreakEnds(now)) {
      await this.repo.claimBreakEnd(due.id, now);
      if (now - due.fireAt > ttlMs) continue; // el poller no corrió a tiempo: ya no sirve
      const ctx = contextOf(await this.repo.settingsOf(due.userId));
      if (!ctx) continue;
      const decision = decideNotification({
        kind: 'break_end',
        nowUtc: now,
        timeZone: ctx.timeZone,
        prefs: ctx.prefs,
        remindersSentToday: 0, // §3g: el fin de descanso no cuenta para el tope
        dueCount: 0,
        backoff: NO_BACKOFF,
      });
      if (!decision.send) continue;
      outgoing.push({
        userId: due.userId,
        eventId: null,
        payload: { title: text('breakEnd'), body: text('breakEndBody'), tag: 'break', url: '/study' },
        ttlSec: NOTIFICATION_DELIVERY.breakEndTtlSeconds,
      });
    }
    return outgoing;
  }

  /** NT5: a todos sus dispositivos; cuenta 1 aunque llegue a varios. 404/410 borra (NT-T9). */
  private async deliver(item: Outgoing, now: number): Promise<void> {
    try {
      const subscriptions = await this.repo.subscriptionsOf(item.userId);
      let delivered = false;
      for (const subscription of subscriptions) {
        const result = await this.sender.send(subscription, item.payload, { ttlSec: item.ttlSec });
        await this.repo.recordDelivery(subscription.id, result, new Date(now));
        delivered ||= result === 'ok';
      }
      if (item.eventId === null) return;
      const outcome = subscriptions.length === 0 ? 'no_subscription' : delivered ? 'sent' : 'failed';
      await this.repo.finishEvent(item.eventId, outcome, now);
    } catch (error: unknown) {
      // BE6: sin contenido del aviso en el log.
      this.logger.error({ err: error, userId: item.userId }, 'No se pudo entregar un aviso');
    }
  }
}
