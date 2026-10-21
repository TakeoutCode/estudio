import { cardIdFor, newId, type PushResponse, PushResponseSchema } from '@estudio/shared';
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

const PHONE = '0192f1a0-0000-7000-8000-0000000000d1';

describe('notas de oclusión de imagen por sync (R10, LD1, BE2)', () => {
  let server: IntegrationApp;
  let user: { token: string };
  let other: { token: string };
  let now: number;

  const push = async (as: { token: string }, mutations: unknown[]): Promise<PushResponse> => {
    const res = await server
      .api()
      .post('/sync/push')
      .set('Authorization', `Bearer ${as.token}`)
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
  const asset = () => ({
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
  });
  const occlusion = (imageAssetId: string) => ({
    kind: 'image_occlusion',
    imageAssetId,
    prompt: '¿Qué hueso del carpo es?',
    alt: 'Mano derecha, vista palmar',
    mode: 'hide_all',
    groups: [
      { n: 1, label: 'Escafoides', rects: [{ x: 0.1, y: 0.3, w: 0.1, h: 0.05 }] },
      { n: 2, label: 'Semilunar', rects: [{ x: 0.3, y: 0.3, w: 0.1, h: 0.05 }] },
    ],
    explanation: '',
  });

  beforeAll(async () => {
    server = await startIntegrationApp();
    now = server.clock.now();
    user = await signIn(server, 'oclusion-a@ejemplo.mx');
    other = await signIn(server, 'oclusion-b@ejemplo.mx');
  });

  afterAll(async () => {
    await server.close();
  });

  it('la imagen tiene que ser suya; con ella, la nota y una Card por etiqueta vuelven por pull', async () => {
    const deck = deckRow(now, PHONE);
    const mine = asset();
    const foreign = asset();
    await push(other, [upsert('mediaAsset', foreign)]);
    const stolen = noteRow(now, PHONE, deck.id, { content: occlusion(foreign.id) });
    const note = noteRow(now, PHONE, deck.id, { content: occlusion(mine.id) });
    const cards = [1, 2].map((ordinal) =>
      cardRow(now, PHONE, note.id, { id: cardIdFor(note.id, ordinal), ordinal }),
    );

    const results = (
      await push(user, [
        upsert('deck', deck),
        upsert('mediaAsset', mine),
        upsert('note', stolen),
        upsert('note', note),
        ...cards.map((c) => upsert('card', c)),
      ])
    ).results;
    expect(results.map((r) => [r.status, r.code])).toEqual([
      ['applied', undefined],
      ['applied', undefined],
      ['rejected', 'not_found'],
      ['applied', undefined],
      ['applied', undefined],
      ['applied', undefined],
    ]);

    const res = await server
      .api()
      .get('/sync/pull?cursor=0&limit=500')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    const body = res.body as { changes: { entity: string; row: { id: string } }[] };
    expect(body.changes.find((c) => c.entity === 'note' && c.row.id === note.id)?.row).toEqual(note);
    expect(body.changes.filter((c) => c.entity === 'card').map((c) => c.row.id)).toEqual(
      cards.map((c) => c.id),
    );
  });

  it('una nota con un recuadro fuera de la imagen no pasa el esquema', async () => {
    const deck = deckRow(now, PHONE);
    const image = asset();
    const content = occlusion(image.id);
    const bad = noteRow(now, PHONE, deck.id, {
      content: {
        ...content,
        groups: [{ n: 1, label: 'Escafoides', rects: [{ x: 0.9, y: 0, w: 0.2, h: 0.1 }] }],
      },
    });
    const results = (
      await push(user, [upsert('deck', deck), upsert('mediaAsset', image), upsert('note', bad)])
    ).results;
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied', 'rejected']);
  });
});
