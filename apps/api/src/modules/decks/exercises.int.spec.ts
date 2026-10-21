import { newId, type PushResponse, PushResponseSchema } from '@estudio/shared';
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

const PHONE = '0192f1a0-0000-7000-8000-0000000000e1';

describe('ejercicios como notas por sync (LD §2, BE2)', () => {
  let server: IntegrationApp;
  let user: { token: string };
  let now: number;

  const push = async (mutations: unknown[]): Promise<PushResponse> => {
    const res = await server
      .api()
      .post('/sync/push')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ deviceId: PHONE, mutations })
      .expect(200);
    return PushResponseSchema.parse(res.body);
  };
  const upsert = (entity: string, row: Record<string, unknown>) => ({
    mutationId: newId(),
    op: 'upsert',
    entity,
    row,
  });

  beforeAll(async () => {
    server = await startIntegrationApp();
    now = server.clock.now();
    user = await signIn(server, 'ejercicios-a@ejemplo.mx');
  });

  afterAll(async () => {
    await server.close();
  });

  it('V/F con justificación y pregunta abierta viajan con su Card; uno incompleto se rechaza', async () => {
    const deck = deckRow(now, PHONE);
    const tfj = noteRow(now, PHONE, deck.id, {
      content: {
        kind: 'true_false_justify',
        statement: 'El radial inerva el deltoides.',
        isTrue: false,
        justification: 'Lo inerva el axilar.',
        explanation: '',
      },
    });
    const open = noteRow(now, PHONE, deck.id, {
      content: { kind: 'open_question', question: '¿Por qué?', key: 'Por el axilar.', explanation: '' },
    });
    const incomplete = noteRow(now, PHONE, deck.id, {
      content: { kind: 'true_false_justify', statement: 'Sin valor', justification: 'x', explanation: '' },
    });
    const results = (
      await push([
        upsert('deck', deck),
        upsert('note', tfj),
        upsert('card', cardRow(now, PHONE, tfj.id)),
        upsert('note', open),
        upsert('note', incomplete),
      ])
    ).results;
    expect(results.map((r) => [r.status, r.code])).toEqual([
      ['applied', undefined],
      ['applied', undefined],
      ['applied', undefined],
      ['applied', undefined],
      ['rejected', 'validation_failed'],
    ]);

    const res = await server
      .api()
      .get('/sync/pull?cursor=0&limit=500')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    const body = res.body as { changes: { entity: string; row: unknown }[] };
    expect(body.changes.filter((c) => c.entity === 'note').map((c) => c.row)).toEqual([tfj, open]);
  });

  it('R10: etiquetar una imagen necesita una imagen suya, que viaja antes que la nota (BE2)', async () => {
    const deck = deckRow(now, PHONE);
    const image = {
      id: newId(),
      kind: 'image',
      mime: 'image/png',
      bytes: 90_000,
      width: 800,
      height: 600,
      publicId: null,
      version: null,
      hlc: hlcAt(now, PHONE),
      updatedAt: now,
      deletedAt: null,
    };
    const labels = (imageAssetId: string) =>
      noteRow(now, PHONE, deck.id, {
        content: {
          kind: 'label_image',
          imageAssetId,
          prompt: 'Nombra los huesos marcados.',
          alt: 'Mano derecha, vista palmar.',
          labels: [
            { n: 1, label: 'Escafoides', rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.1 }] },
            { n: 2, label: 'Semilunar', rects: [{ x: 0.4, y: 0.1, w: 0.2, h: 0.1 }] },
          ],
          explanation: '',
        },
      });
    const results = (
      await push([
        upsert('deck', deck),
        upsert('note', labels(image.id)), // la imagen todavía no llegó
        upsert('mediaAsset', image),
        upsert('note', labels(image.id)),
      ])
    ).results;
    expect(results.map((r) => [r.status, r.code])).toEqual([
      ['applied', undefined],
      ['rejected', 'not_found'],
      ['applied', undefined],
      ['applied', undefined],
    ]);
  });

  it('`exercise` ya no es una entidad de sync: el sobre se rechaza entero', async () => {
    await server
      .api()
      .post('/sync/push')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        deviceId: PHONE,
        mutations: [{ mutationId: newId(), op: 'upsert', entity: 'exercise', row: {} }],
      })
      .expect(422);
  });
});
