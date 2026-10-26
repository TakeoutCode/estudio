import {
  newId,
  type PushPayload,
  PushResponseSchema,
  Rating,
  settingsRowId,
  startOfLocalDate,
} from '@estudio/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cardRow,
  deckRow,
  hlcAt,
  type IntegrationApp,
  noteRow,
  signIn,
  startIntegrationApp,
} from '../../test/integration-app.js';
import { NotificationsService } from './notifications.service.js';
import { PushSender, type PushResult, type PushTarget } from './push-sender.js';

const PHONE = '0192f1a0-0000-7000-8000-0000000000b1';
const TZ = 'America/Mexico_City';
const MIN = 60_000;
/** Hora local en CDMX (UTC-6, sin horario de verano) del día `day` contado desde el 20/10/2026. */
const local = (day: number, h: number, m = 0) => Date.UTC(2026, 9, 20 + day, h + 6, m);

class FakePushSender extends PushSender {
  readonly sent: { endpoint: string; payload: PushPayload; ttlSec: number }[] = [];
  readonly responses = new Map<string, PushResult>();

  send(target: PushTarget, payload: PushPayload, options: { ttlSec: number }): Promise<PushResult> {
    this.sent.push({ endpoint: target.endpoint, payload, ttlSec: options.ttlSec });
    return Promise.resolve(this.responses.get(target.endpoint) ?? 'ok');
  }

  to(endpoint: string) {
    return this.sent.filter((s) => s.endpoint === endpoint);
  }
}

interface Seeded {
  readonly token: string;
  readonly userId: string;
  readonly endpoint: string;
  readonly topicId: string;
}

interface EventRow {
  id: string;
  status: string;
  reason: string | null;
  kinds: string[];
  examDays: string[];
  openedAt: bigint | null;
}

describe('avisos (NOTIFICATIONS.md, BE14)', () => {
  const sender = new FakePushSender();
  let server: IntegrationApp;
  let service: NotificationsService;

  const auth = (as: { token: string }) => `Bearer ${as.token}`;
  const push = async (as: { token: string }, mutations: unknown[]) => {
    const res = await server
      .api()
      .post('/sync/push')
      .set('Authorization', auth(as))
      .send({ deviceId: PHONE, mutations })
      .expect(200);
    const results = PushResponseSchema.parse(res.body).results;
    expect(results.filter((r) => r.status !== 'applied')).toEqual([]);
  };
  const upsert = (entity: string, row: Record<string, unknown>) => ({
    mutationId: newId(),
    op: 'upsert',
    entity,
    row,
  });
  const append = (entity: string, row: Record<string, unknown>) => ({
    mutationId: newId(),
    op: 'append',
    entity,
    row,
  });

  /** Una cuenta con `due` tarjetas vencidas de un tema y una suscripción; `pausedAt` pausa su mazo. */
  const seed = async (
    email: string,
    {
      time,
      due,
      notifications = {},
      pausedAt = null,
    }: { time: string; due: number; notifications?: Record<string, unknown>; pausedAt?: number | null },
  ): Promise<Seeded> => {
    const user = await signIn(server, email);
    const wall = local(-40, 12);
    const meta = { hlc: hlcAt(wall, PHONE), updatedAt: wall, deletedAt: null };
    const settings = (section: 'profile' | 'notifications', data: Record<string, unknown>) =>
      upsert('userSettings', { id: settingsRowId(user.userId, section), section, data, ...meta });
    const deck = deckRow(wall, PHONE, { pausedAt });
    const topic = { id: newId(), deckId: deck.id, name: 'Huesos del carpo', explanation: '', ...meta };
    const notes = Array.from({ length: due }, () => noteRow(wall, PHONE, deck.id, { topicId: topic.id }));
    const cards = notes.map((n) => cardRow(wall, PHONE, n.id));
    const logs = cards.map((c) =>
      append('reviewLog', {
        id: newId(),
        cardId: c.id,
        cardKind: 'basic',
        reviewedAt: local(-30, 12),
        rating: Rating.Easy,
        durationMs: 5000,
        type: 'learn',
        confidence: null,
        sessionId: newId(),
        deviceId: PHONE,
      }),
    );
    await push(user, [
      settings('profile', { timeZone: TZ }),
      settings('notifications', { enabled: true, dailyReminderTime: time, ...notifications }),
      upsert('deck', deck),
      upsert('topic', topic),
      ...notes.map((n) => upsert('note', n)),
      ...cards.map((c) => upsert('card', c)),
      ...logs,
    ]);
    const endpoint = `https://push.ejemplo.mx/${email}`;
    await subscribe(user, endpoint);
    return { ...user, endpoint, topicId: topic.id };
  };
  const subscribe = (as: { token: string }, endpoint: string) =>
    server
      .api()
      .post('/push/subscriptions')
      .set('Authorization', auth(as))
      .send({
        deviceId: PHONE,
        endpoint,
        keys: { p256dh: 'clave-p256dh', auth: 'clave-auth' },
        userAgent: null,
      })
      .expect(204);
  const events = (userId: string) => server.prisma.$queryRaw<EventRow[]>`
    SELECT id, status, reason, kinds, exam_days AS "examDays", opened_at AS "openedAt"
    FROM notification_event WHERE user_id = ${userId}::uuid ORDER BY local_date, slot`;
  /** El tick del cron que termina a las `h:m` locales del día `day`. */
  const tick = (day: number, h: number, m: number) =>
    service.runReminderTick(local(day, h, m), local(day, h, m) - 5 * MIN);

  beforeAll(async () => {
    server = await startIntegrationApp({ pushSender: sender });
    service = server.app.get(NotificationsService);
  });

  afterAll(async () => {
    await server.close();
  });

  it('NT3, NT5, NT-T11: a su hora, un solo aviso con el examen y las pendientes, a cada dispositivo', async () => {
    const user = await seed('avisos-a@ejemplo.mx', { time: '19:00', due: 12 });
    const tablet = 'https://push.ejemplo.mx/avisos-a-tablet';
    await subscribe(user, tablet);
    const exam = { id: newId(), title: 'Parcial de Anatomía', date: startOfLocalDate('2026-10-27', TZ) };
    const wall = local(-1, 12);
    await push(user, [
      upsert('exam', {
        ...exam,
        topicIds: [user.topicId],
        hlc: hlcAt(wall, PHONE),
        updatedAt: wall,
        deletedAt: null,
      }),
    ]);

    await tick(0, 18, 55);
    expect(sender.to(user.endpoint)).toEqual([]);
    await tick(0, 19, 0);

    const [event] = await events(user.userId);
    const payload: PushPayload = {
      title: 'Estudio',
      body: 'Parcial de Anatomía en 7 días · 12 tarjetas pendientes · Huesos del carpo',
      tag: 'reminder',
      url: `/?aviso=${event?.id ?? ''}`,
    };
    expect(sender.to(user.endpoint)).toEqual([{ endpoint: user.endpoint, payload, ttlSec: 14_400 }]);
    expect(sender.to(tablet)).toEqual([{ endpoint: tablet, payload, ttlSec: 14_400 }]);
    expect(event).toMatchObject({
      status: 'sent',
      reason: null,
      kinds: ['exam_soon', 'daily_reminder'],
      examDays: [`${exam.id}:7`],
    });

    await tick(0, 19, 5);
    expect(await events(user.userId)).toHaveLength(1);
    expect(sender.to(user.endpoint)).toHaveLength(1);
  });

  it('NT-T1, §6: con 9 pendientes no se envía y queda registrado con su motivo', async () => {
    const user = await seed('avisos-b@ejemplo.mx', { time: '19:10', due: 9 });
    await tick(0, 19, 10);
    expect(sender.to(user.endpoint)).toEqual([]);
    expect(await events(user.userId)).toMatchObject([
      { status: 'suppressed', reason: 'below_min_due', kinds: ['daily_reminder'] },
    ]);
  });

  it('las pendientes de un mazo en pausa no cuentan: con 12 ahí no se envía (como en Hoy)', async () => {
    const user = await seed('avisos-h@ejemplo.mx', { time: '19:15', due: 12, pausedAt: local(-2, 12) });
    await tick(0, 19, 15);
    expect(sender.to(user.endpoint)).toEqual([]);
    expect(await events(user.userId)).toMatchObject([
      { status: 'suppressed', reason: 'below_min_due', kinds: ['daily_reminder'] },
    ]);
  });

  it('§3d: con una segunda hora llega otro aviso si sigue habiendo pendientes; el tope del día manda', async () => {
    const user = await seed('avisos-i@ejemplo.mx', {
      time: '08:00',
      due: 12,
      notifications: { secondReminderTime: '19:30' },
    });
    await tick(0, 8, 0);
    await tick(0, 19, 30);
    expect(sender.to(user.endpoint)).toHaveLength(2);
    expect(await events(user.userId)).toMatchObject([{ status: 'sent' }, { status: 'sent' }]);

    // Con un tope de 1 al día, la segunda hora queda registrada como suprimida por el tope.
    const capped = await seed('avisos-j@ejemplo.mx', {
      time: '08:05',
      due: 12,
      notifications: { secondReminderTime: '19:35', maxRemindersPerDay: 1 },
    });
    await tick(0, 8, 5);
    await tick(0, 19, 35);
    expect(sender.to(capped.endpoint)).toHaveLength(1);
    expect(await events(capped.userId)).toMatchObject([
      { status: 'sent' },
      { status: 'suppressed', reason: 'daily_cap' },
    ]);
  });

  it('NT-T6: dos ticks a la vez dejan un solo evento y un solo envío', async () => {
    const user = await seed('avisos-c@ejemplo.mx', { time: '19:20', due: 10 });
    await Promise.all([tick(0, 19, 20), tick(0, 19, 20)]);
    expect(await events(user.userId)).toMatchObject([{ status: 'sent' }]);
    expect(sender.to(user.endpoint)).toHaveLength(1);
  });

  it('NT-T9: un 410 borra la suscripción y el evento queda fallido; sin suscripción, suprimido', async () => {
    const user = await seed('avisos-d@ejemplo.mx', { time: '19:30', due: 10 });
    sender.responses.set(user.endpoint, 'gone');
    await tick(0, 19, 30);
    expect(await events(user.userId)).toMatchObject([{ status: 'failed' }]);
    const left = await server.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM push_subscription WHERE user_id = ${user.userId}::uuid`;
    expect(left[0]?.n).toBe(0n);

    await tick(1, 19, 30);
    expect(await events(user.userId)).toMatchObject([
      { status: 'failed' },
      { status: 'suppressed', reason: 'no_subscription' },
    ]);
  });

  it('NT7, §3f: 3 ignorados activan el modo reducido; se pregunta una vez; abrir reinicia', async () => {
    const seeded = await seed('avisos-e@ejemplo.mx', { time: '19:40', due: 10 });
    for (const day of [0, 1, 2, 3]) await tick(day, 19, 40);
    expect((await events(seeded.userId)).map((e) => [e.status, e.reason])).toEqual([
      ['sent', null],
      ['sent', null],
      ['sent', null],
      ['suppressed', 'backoff'],
    ]);

    server.clock.value = local(3, 20);
    const user = await signIn(server, 'avisos-e@ejemplo.mx'); // el token anterior ya venció
    const state = async () => {
      const res = await server.api().get('/notifications/state').set('Authorization', auth(user)).expect(200);
      return res.body as unknown;
    };
    expect(await state()).toEqual({ backoff: true, askBackoffQuestion: true });
    const answer = (choice: string) =>
      server.api().post('/notifications/backoff').set('Authorization', auth(user)).send({ choice });
    await answer('reduced').expect(204);
    expect(await state()).toEqual({ backoff: true, askBackoffQuestion: false });
    await answer('as_before').expect(204);
    expect(await state()).toEqual({ backoff: false, askBackoffQuestion: false });
    await answer('nunca').expect(422);

    const [first] = await events(user.userId);
    const other = await signIn(server, 'avisos-f@ejemplo.mx');
    const open = (as: { token: string }, id: string) =>
      server.api().post(`/notifications/${id}/opened`).set('Authorization', auth(as));
    await open(other, first?.id ?? '').expect(404);
    await open(user, 'no-es-un-id').expect(422);
    await open(user, first?.id ?? '').expect(204);
    const opened = (await events(user.userId))[0]?.openedAt;
    expect(opened).toBe(BigInt(local(3, 20)));
    server.clock.advance(MIN);
    await open(user, first?.id ?? '').expect(204);
    expect((await events(user.userId))[0]?.openedAt).toBe(opened);
  });

  it('NT4, NT-T3, NT-T7, NT-T8: el fin de descanso sale una vez, solo en segundo plano y de día', async () => {
    const user = await seed('avisos-g@ejemplo.mx', { time: '08:00', due: 0 });
    const timerSessionId = newId();
    const schedule = (blockIndex: number, fireAt: number) =>
      server
        .api()
        .put('/notifications/break-end')
        .set('Authorization', auth(user))
        .send({ timerSessionId, blockIndex, fireAt })
        .expect(204);
    const cancel = (blockIndex: number) =>
      server
        .api()
        .delete('/notifications/break-end')
        .set('Authorization', auth(user))
        .send({ timerSessionId, blockIndex })
        .expect(204);

    await schedule(0, local(1, 12, 5));
    await schedule(0, local(1, 12, 6)); // la reprogramó: una sola fila por bloque
    await schedule(1, local(1, 12, 6));
    await cancel(1); // volvió a la app antes de que terminara
    await schedule(2, local(1, 23));

    await service.runBreakEndTick(local(1, 12, 5));
    expect(sender.to(user.endpoint)).toEqual([]);
    await service.runBreakEndTick(local(1, 12, 6));
    await service.runBreakEndTick(local(1, 12, 7));
    expect(sender.to(user.endpoint)).toEqual([
      {
        endpoint: user.endpoint,
        payload: { title: 'Terminó el descanso', body: 'Sigue cuando quieras.', tag: 'break', url: '/study' },
        ttlSec: 300,
      },
    ]);
    await schedule(0, local(1, 12, 30)); // ya salió: no se vuelve a programar
    await service.runBreakEndTick(local(1, 12, 30));
    await service.runBreakEndTick(local(1, 23)); // horas silenciosas (R12)
    expect(sender.to(user.endpoint)).toHaveLength(1);
    expect(await events(user.userId)).toEqual([]); // no cuenta como recordatorio (§3g)

    // §2: cada bloque guarda cómo terminó, también lo que se suprimió.
    await schedule(3, local(2, 12));
    await service.runBreakEndTick(local(2, 12) + 6 * MIN); // pasó el TTL de 5 min
    const outcomes = await server.prisma.$queryRaw<
      { block_index: number; status: string; reason: string | null }[]
    >`
      SELECT block_index, status, reason FROM scheduled_notification
      WHERE timer_session_id = ${timerSessionId}::uuid ORDER BY block_index`;
    expect(outcomes).toEqual([
      { block_index: 0, status: 'sent', reason: null },
      { block_index: 1, status: 'suppressed', reason: 'foreground' },
      { block_index: 2, status: 'suppressed', reason: 'quiet_hours' },
      { block_index: 3, status: 'suppressed', reason: 'expired' },
    ]);
  });

  it('NT8: la suscripción exige https y sesión; borrarla deja de enviar a ese dispositivo', async () => {
    const user = await signIn(server, 'avisos-f@ejemplo.mx');
    const body = { deviceId: PHONE, keys: { p256dh: 'p', auth: 'a' }, userAgent: null };
    await server
      .api()
      .post('/push/subscriptions')
      .set('Authorization', auth(user))
      .send({ ...body, endpoint: 'http://push.ejemplo.mx/x' })
      .expect(422);
    await server
      .api()
      .post('/push/subscriptions')
      .send({ ...body, endpoint: 'https://push.ejemplo.mx/x' })
      .expect(401);
    await subscribe(user, 'https://push.ejemplo.mx/f');
    await server
      .api()
      .delete('/push/subscriptions')
      .set('Authorization', auth(user))
      .send({ endpoint: 'https://push.ejemplo.mx/f' })
      .expect(204);
    const left = await server.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM push_subscription WHERE user_id = ${user.userId}::uuid`;
    expect(left[0]?.n).toBe(0n);
  });
});
