import { describe, expect, it } from 'vitest';
import { newId, settingsRowId } from '../ids.js';
import { isMinuteInRange } from '../time.js';
import { GamificationConfigSchema, isGamificationOn } from '../config/gamification-config.js';
import { ENTITY_STRATEGY, opForEntity } from './entities.js';
import { MAX_MUTATIONS_PER_PUSH, MutationSchema, PullQuerySchema, PushRequestSchema } from './contracts.js';

const mutation = (entity: string, op: string) => ({ mutationId: newId(), entity, op, row: {} });

describe('contratos de sync (SYNC §3, §4)', () => {
  it('SY1: la operación debe coincidir con la estrategia de la entidad', () => {
    expect(MutationSchema.safeParse(mutation('reviewLog', 'append')).success).toBe(true);
    expect(MutationSchema.safeParse(mutation('deck', 'upsert')).success).toBe(true);
    expect(MutationSchema.safeParse(mutation('reviewLog', 'upsert')).success).toBe(false);
    expect(MutationSchema.safeParse(mutation('deck', 'append')).success).toBe(false);
  });

  it('el ReviewLog y los demás logs son solo de inserción', () => {
    for (const entity of ['reviewLog', 'timerBlockLog', 'rewardRedemption', 'aiFeedback'] as const) {
      expect(ENTITY_STRATEGY[entity]).toBe('append');
      expect(opForEntity(entity)).toBe('append');
    }
  });

  it(`limita el push a ${MAX_MUTATIONS_PER_PUSH} mutaciones`, () => {
    const make = (n: number) => ({
      deviceId: newId(),
      mutations: Array.from({ length: n }, () => mutation('deck', 'upsert')),
    });
    expect(PushRequestSchema.safeParse(make(MAX_MUTATIONS_PER_PUSH)).success).toBe(true);
    expect(PushRequestSchema.safeParse(make(MAX_MUTATIONS_PER_PUSH + 1)).success).toBe(false);
  });

  it('el cursor por defecto es 0 y el límite se convierte desde la query', () => {
    expect(PullQuerySchema.parse({ limit: '20' })).toEqual({ cursor: '0', limit: 20 });
    expect(PullQuerySchema.safeParse({ cursor: '-1' }).success).toBe(false);
  });
});

describe('IDs', () => {
  it('settingsRowId es determinista por usuario y sección', () => {
    const user = newId();
    expect(settingsRowId(user, 'study')).toBe(settingsRowId(user, 'study'));
    expect(settingsRowId(user, 'study')).not.toBe(settingsRowId(user, 'ui'));
  });
});

describe('rangos horarios', () => {
  it('un rango vacío no contiene minutos y uno normal no cruza la medianoche', () => {
    expect(isMinuteInRange(600, { start: '10:00', end: '10:00' })).toBe(false);
    expect(isMinuteInRange(600, { start: '09:00', end: '11:00' })).toBe(true);
    expect(isMinuteInRange(700, { start: '09:00', end: '11:00' })).toBe(false);
  });
});

describe('gamificación (UX10)', () => {
  it('queda apagada hasta que ella responda en el onboarding', () => {
    expect(isGamificationOn(GamificationConfigSchema.parse({}))).toBe(false);
    expect(isGamificationOn(GamificationConfigSchema.parse({ enabled: true }))).toBe(true);
  });
});
