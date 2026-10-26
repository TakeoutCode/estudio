import {
  AiDistractorsResponseSchema,
  AiDraftResponseSchema,
  AiExplanationCheckSchema,
  AiOpenFeedbackSchema,
  newId,
} from '@estudio/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiOk, FakeAiProvider } from '../../test/fake-ai-provider.js';
import { type IntegrationApp, signIn, startIntegrationApp } from '../../test/integration-app.js';

const SOURCE = 'El deltoides está inervado por el nervio axilar, rama del fascículo posterior.';
const draft = {
  kind: 'basic',
  front: '¿Qué nervio inerva el deltoides?',
  back: 'El axilar',
  explanation: 'Rama del fascículo posterior del plexo braquial.',
  sourceQuote: 'El deltoides está inervado por el nervio axilar',
  options: null,
};

describe('IA con un proveedor falso (QUALITY §1, LD14-LD17)', () => {
  let server: IntegrationApp;
  const ai = new FakeAiProvider();
  let a: { token: string; userId: string };
  let b: { token: string; userId: string };

  beforeAll(async () => {
    server = await startIntegrationApp({ aiProvider: ai });
    a = await signIn(server, 'ia-a@ejemplo.mx');
    b = await signIn(server, 'ia-b@ejemplo.mx');
  });
  afterAll(() => server.close());

  const usage = (userId: string) =>
    server.prisma.$queryRaw<{ row: Record<string, unknown> }[]>`
      SELECT to_jsonb(u) AS "row" FROM "ai_usage" u WHERE u."user_id" = ${userId}::uuid ORDER BY u."created_at", u."attempt"`;

  it('LD16, LD17: devuelve borradores y registra tokens y estado, nunca su texto (BE6)', async () => {
    ai.reply(aiOk({ drafts: [draft, { ...draft, front: '' }] }));
    const res = await server
      .api()
      .post('/ai/drafts')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ sourceText: SOURCE })
      .expect(200);
    const body = AiDraftResponseSchema.parse(res.body);
    expect(body).toEqual({ drafts: [draft], discarded: 1 });
    expect(ai.tasks.at(-1)?.input).toBe(SOURCE);

    const rows = await usage(a.userId);
    expect(rows.map((r) => [r.row.task, r.row.attempt, r.row.status, r.row.input_tokens])).toEqual([
      ['note_drafts', 1, 'ok', 120],
    ]);
    expect(JSON.stringify(rows)).not.toContain('deltoides');
  });

  it('LD17: una salida inválida se reintenta una vez y después responde 503', async () => {
    ai.reply(aiOk({ nada: 1 }), aiOk({ drafts: 'no' }));
    const res = await server
      .api()
      .post('/ai/drafts')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ sourceText: SOURCE })
      .expect(503);
    expect(res.body).toMatchObject({ code: 'unavailable' });
    const rows = await usage(b.userId);
    expect(rows.map((r) => [r.row.attempt, r.row.status])).toEqual([
      [1, 'invalid'],
      [2, 'invalid'],
    ]);
  });

  it('LD17: con la cuota del día agotada responde 429 sin llamar al modelo', async () => {
    const { userId } = b;
    const today = (await usage(userId))[0]?.row.local_date as string;
    const used = (await usage(userId)).filter((r) => r.row.attempt === 1).length;
    for (let i = used; i < 30; i += 1) {
      await server.prisma.$executeRaw`
        INSERT INTO "ai_usage" ("id", "user_id", "local_date", "task", "attempt", "model", "status",
          "input_tokens", "output_tokens", "latency_ms")
        VALUES (${newId()}::uuid, ${userId}::uuid, ${today}, 'note_drafts', 1, 'm', 'ok', 1, 1, 1)`;
    }
    const calls = ai.tasks.length;
    const res = await server
      .api()
      .post('/ai/drafts')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ sourceText: SOURCE })
      .expect(429);
    expect(res.body).toMatchObject({ code: 'ai_quota_exceeded' });
    expect(ai.tasks).toHaveLength(calls);
  });

  it('LD14: retroalimentación, revisión de su explicación y distractores responden su contrato', async () => {
    const auth = { Authorization: `Bearer ${a.token}` };
    const feedback = { covered: ['Nombra el axilar'], missing: [], misconceptions: [], suggestion: '' };
    ai.reply(aiOk(feedback));
    const fb = await server
      .api()
      .post('/ai/feedback')
      .set(auth)
      .send({ question: '¿Qué inerva el axilar?', key: 'Deltoides y redondo menor', answer: 'El deltoides' })
      .expect(200);
    expect(AiOpenFeedbackSchema.parse(fb.body)).toEqual(feedback);

    const check = { verdict: 'partial', missing: ['Redondo menor'], misconceptions: [], suggestion: '' };
    ai.reply(aiOk(check));
    const ec = await server
      .api()
      .post('/ai/explanation-check')
      .set(auth)
      .send({
        question: '¿Qué inerva el axilar?',
        key: 'Deltoides y redondo menor',
        explanation: 'El deltoides',
      })
      .expect(200);
    expect(AiExplanationCheckSchema.parse(ec.body)).toEqual(check);

    // La correcta y lo que ya escribió no vuelven como distractores.
    ai.reply(aiOk({ distractors: ['Radial', 'axilar', 'Musculocutáneo', 'Mediano'] }));
    const ds = await server
      .api()
      .post('/ai/distractors')
      .set(auth)
      .send({
        question: '¿Qué nervio inerva el deltoides?',
        correct: 'Axilar',
        existing: ['Mediano'],
        context: null,
      })
      .expect(200);
    expect(AiDistractorsResponseSchema.parse(ds.body).distractors).toEqual(['Radial', 'Musculocutáneo']);
  });
});
