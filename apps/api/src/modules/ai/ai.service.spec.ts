import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../../common/clock.js';
import { DomainError } from '../../common/domain-error.js';
import type { AppConfig } from '../../config/app-config.js';
import { HealthMetrics } from '../health/health-metrics.js';
import type { AiProvider, AiResult } from './ai-provider.js';
import type { AiRepository, UsageRow } from './ai.repository.js';
import { AiService } from './ai.service.js';
import { strictJsonSchema } from './strict-json-schema.js';
import { AiNoteDraftSchema } from '@estudio/shared';
import { z } from 'zod';

const USER = '0192f1a0-0000-7000-8000-00000000c0de';
/** 23:30 del 20 de octubre en CDMX: ya es 21 en UTC. */
const NOW = Date.UTC(2026, 9, 21, 5, 30);

const draft = {
  kind: 'basic',
  front: '¿Qué nervio inerva el deltoides?',
  back: 'El axilar',
  explanation: '',
  sourceQuote: 'El deltoides está inervado por el nervio axilar',
  options: null,
};

class FakeRepo {
  readonly usage: UsageRow[] = [];
  profile: unknown = { timeZone: 'America/Mexico_City' };
  profileOf = () => Promise.resolve(this.profile);
  usageOn = (userId: string, localDate: string) => {
    const rows = this.usage.filter((u) => u.userId === userId && u.localDate === localDate);
    return Promise.resolve({
      requests: rows.filter((u) => u.attempt === 1).length,
      tokens: rows.reduce((sum, u) => sum + u.inputTokens + u.outputTokens, 0),
    });
  };
  recordUsage = (row: UsageRow) => {
    this.usage.push(row);
    return Promise.resolve();
  };
}

const ok = (output: unknown): AiResult => ({
  status: 'ok',
  output,
  model: 'm',
  inputTokens: 100,
  outputTokens: 50,
});
const failed = (status: 'refused' | 'invalid' | 'timeout' | 'error'): AiResult => ({
  status,
  model: 'm',
  inputTokens: 10,
  outputTokens: 0,
});

function setup(results: AiResult[], { requests = 30, tokens = 200_000, configured = true } = {}) {
  const repo = new FakeRepo();
  const run = vi.fn<AiProvider['run']>(() => Promise.resolve(results.shift() ?? failed('error')));
  const provider = { configured, run } as unknown as AiProvider;
  const clock: Clock = { now: () => NOW };
  const metrics = new HealthMetrics(clock);
  metrics.recordCronTick(NOW);
  const config = {
    get: (key: string) => ({ AI_DAILY_REQUESTS: requests, AI_DAILY_TOKENS: tokens })[key],
  } as unknown as AppConfig;
  const service = new AiService(repo as unknown as AiRepository, provider, metrics, config, clock);
  return { service, repo, run, metrics };
}

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof DomainError ? error.code : 'otro';
  }
  return null;
};

describe('LD14-LD17: borradores de notas', () => {
  it('sin IA configurada responde 503 sin gastar nada', async () => {
    const { service, run } = setup([], { configured: false });
    expect(await code(service.draftNotes(USER, { sourceText: 'texto' }))).toBe('unavailable');
    expect(run).not.toHaveBeenCalled();
  });

  it('LD15: devuelve los válidos y cuenta los descartados; el registro no guarda contenido (BE6)', async () => {
    const { service, repo, run } = setup([ok({ drafts: [draft, { ...draft, front: '' }, { nada: 1 }] })]);
    expect(
      await service.draftNotes(USER, { sourceText: 'El deltoides está inervado por el nervio axilar.' }),
    ).toEqual({
      drafts: [draft],
      discarded: 2,
    });
    const task = run.mock.calls[0]?.[0];
    expect(task?.input).toBe('El deltoides está inervado por el nervio axilar.');
    expect(task?.schema).toEqual(strictJsonSchema(z.object({ drafts: z.array(AiNoteDraftSchema) }).strict()));
    expect(repo.usage).toEqual([
      {
        userId: USER,
        localDate: '2026-10-20', // AG6: su día, no el de UTC
        task: 'note_drafts',
        attempt: 1,
        model: 'm',
        status: 'ok',
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 0,
      },
    ]);
    expect(JSON.stringify(repo.usage)).not.toContain('deltoides');
  });

  it('LD17: un reintento ante rechazo, timeout o salida inválida; el reintento no cuenta como otro pedido', async () => {
    const { service, repo } = setup([failed('refused'), ok({ drafts: [draft] })]);
    expect((await service.draftNotes(USER, { sourceText: 'texto' })).drafts).toHaveLength(1);
    expect(repo.usage.map((u) => [u.attempt, u.status])).toEqual([
      [1, 'refused'],
      [2, 'ok'],
    ]);
    expect((await repo.usageOn(USER, '2026-10-20')).requests).toBe(1);

    const twice = setup([failed('timeout'), ok({ otra: 'forma' })]);
    expect(await code(twice.service.draftNotes(USER, { sourceText: 'texto' }))).toBe('unavailable');
    expect(twice.repo.usage.map((u) => u.status)).toEqual(['timeout', 'invalid']);
  });

  it('LD17: con la cuota del día agotada (pedidos o tokens) responde 429 sin llamar al modelo', async () => {
    const byRequests = setup([ok({ drafts: [] }), ok({ drafts: [] })], { requests: 1 });
    await byRequests.service.draftNotes(USER, { sourceText: 'uno' });
    expect(await code(byRequests.service.draftNotes(USER, { sourceText: 'dos' }))).toBe('ai_quota_exceeded');
    expect(byRequests.run).toHaveBeenCalledTimes(1);

    const byTokens = setup([ok({ drafts: [] }), ok({ drafts: [] })], { tokens: 150 });
    await byTokens.service.draftNotes(USER, { sourceText: 'uno' });
    expect(await code(byTokens.service.draftNotes(USER, { sourceText: 'dos' }))).toBe('ai_quota_exceeded');
  });

  it('QA8: avisa al monitor cuando el gasto del día pasa del 80 % de la cuota', async () => {
    const low = setup([ok({ drafts: [] })], { requests: 10 });
    await low.service.draftNotes(USER, { sourceText: 'uno' });
    expect(low.metrics.failing(NOW)).toEqual([]);
    const high = setup([ok({ drafts: [] })], { tokens: 160 });
    await high.service.draftNotes(USER, { sourceText: 'uno' });
    expect(high.metrics.failing(NOW)).toEqual(['ai_budget']);
  });
});
