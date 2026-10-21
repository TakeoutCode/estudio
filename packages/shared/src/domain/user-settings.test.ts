import { describe, expect, it } from 'vitest';
import { CredentialsSchema } from '../auth.js';
import { newId } from '../ids.js';
import { encodeHlc } from '../sync/hlc.js';
import { isSyncedEntity, SYNC_ROW_SCHEMAS } from '../sync/row-schemas.js';
import { UserSettingsSchema } from './user-settings.js';

const meta = () => ({
  id: newId(),
  hlc: encodeHlc({ wall: 1_760_000_000_000, counter: 0, node: newId() }),
  updatedAt: 1_760_000_000_000,
  deletedAt: null,
});

describe('UserSettings por sección (SYNC §1)', () => {
  it('completa cada sección con sus valores iniciales', () => {
    const study = UserSettingsSchema.parse({ ...meta(), section: 'study', data: {} });
    expect(study.section === 'study' && study.data.fsrs.requestRetention).toBe(0.9);
    const profile = UserSettingsSchema.parse({ ...meta(), section: 'profile', data: {} });
    expect(profile.section === 'profile' && profile.data.timeZone).toBe('America/Mexico_City');
  });

  it('rechaza datos inválidos de su sección (R2: retención fuera de rango)', () => {
    const r = UserSettingsSchema.safeParse({
      ...meta(),
      section: 'study',
      data: { fsrs: { requestRetention: 0.99 } },
    });
    expect(r.success).toBe(false);
  });

  it('rechaza una zona horaria que no existe y una sección desconocida', () => {
    expect(
      UserSettingsSchema.safeParse({ ...meta(), section: 'profile', data: { timeZone: 'Marte/Olympus' } })
        .success,
    ).toBe(false);
    expect(UserSettingsSchema.safeParse({ ...meta(), section: 'otra', data: {} }).success).toBe(false);
  });
});

describe('esquemas de fila sincronizables', () => {
  it('viajan mazos, temas, notas, tarjetas, exámenes, grupos de contraste, imágenes, ajustes, autoexplicaciones, simulacros, temporizador, sueño, etiquetas y logs por ahora', () => {
    expect(Object.keys(SYNC_ROW_SCHEMAS).sort()).toEqual([
      'card',
      'contrastGroup',
      'deck',
      'exam',
      'mediaAsset',
      'note',
      'reviewLog',
      'selfExplanation',
      'sleepLog',
      'studySession',
      'tag',
      'timerBlockLog',
      'timerSession',
      'topic',
      'userSettings',
    ]);
    expect(isSyncedEntity('card')).toBe(true);
    expect(isSyncedEntity('topic')).toBe(true);
    expect(isSyncedEntity('exam')).toBe(true);
    expect(isSyncedEntity('studySession')).toBe(true);
    expect(isSyncedEntity('exercise')).toBe(false);
  });
});

describe('credenciales (BE10)', () => {
  it('normaliza el correo y exige 12 caracteres de contraseña', () => {
    expect(CredentialsSchema.parse({ email: ' Ella@Ejemplo.MX ', password: 'x'.repeat(12) }).email).toBe(
      'ella@ejemplo.mx',
    );
    expect(CredentialsSchema.safeParse({ email: 'ella@ejemplo.mx', password: 'corta' }).success).toBe(false);
  });
});
