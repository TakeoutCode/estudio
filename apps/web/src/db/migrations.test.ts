import { newId } from '@estudio/shared';
import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { EstudioDb } from './schema';

const names: string[] = [];

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

/** La base tal como la dejó la versión 1 publicada (fixture de SY-T10). */
function openVersion1(name: string): Dexie {
  const v1 = new Dexie(name);
  v1.version(1).stores({
    decks: 'id, updatedAt',
    reviewLogs: 'id, cardId, reviewedAt',
    cardStates: 'cardId, due',
    outbox: 'mutationId, createdAt, status',
    meta: 'key',
  });
  return v1;
}

describe('migraciones de Dexie (SYNC SY9, SY-T10)', () => {
  it('v1 → última: datos, outbox y reloj intactos; aparecen las tablas nuevas', async () => {
    const name = `migracion-${newId()}`;
    names.push(name);
    const deck = { id: newId(), name: 'Carpo', description: null, hlc: 'h', updatedAt: 1, deletedAt: null };
    const pending = {
      mutationId: newId(),
      op: 'upsert',
      entity: 'deck',
      row: deck,
      createdAt: 1,
      attempts: 0,
      status: 'pending',
    };
    const v1 = openVersion1(name);
    await v1.table('decks').add(deck);
    await v1.table('outbox').add(pending);
    await v1.table('meta').put({ key: 'hlc', value: 'reloj' });
    v1.close();

    const current = new EstudioDb(name);
    await current.open();
    expect(current.verno).toBe(15);
    expect(await current.decks.toArray()).toEqual([{ ...deck, pausedAt: null }]); // v9: activo
    expect(await current.outbox.toArray()).toEqual([pending]);
    expect(await current.meta.get('hlc')).toEqual({ key: 'hlc', value: 'reloj' });
    expect(await current.userSettings.count()).toBe(0);
    expect(await current.notes.count()).toBe(0);
    expect(await current.cards.count()).toBe(0);
    expect(await current.timerSessions.count()).toBe(0);
    expect(await current.timerBlockLogs.count()).toBe(0);
    current.close();
  });

  it('v2 → última: el cursor vuelve a 0 para bajar lo que la v2 ignoró; el resto intacto', async () => {
    const name = `migracion-${newId()}`;
    names.push(name);
    const v2 = openVersion1(name);
    v2.version(2).stores({ userSettings: 'id, section' });
    const log = { id: newId(), cardId: newId(), reviewedAt: 1 };
    const pending = { mutationId: newId(), op: 'append', entity: 'reviewLog', row: log, createdAt: 1 };
    await v2.table('reviewLogs').add(log);
    await v2.table('outbox').add(pending);
    await v2.table('meta').bulkPut([
      { key: 'syncCursor', value: '42' },
      { key: 'deviceId', value: 'dispositivo' },
    ]);
    v2.close();

    const current = new EstudioDb(name);
    await current.open();
    expect(current.verno).toBe(15);
    expect(await current.meta.get('syncCursor')).toEqual({ key: 'syncCursor', value: '0' });
    expect(await current.meta.get('deviceId')).toEqual({ key: 'deviceId', value: 'dispositivo' });
    expect(await current.reviewLogs.toArray()).toEqual([log]);
    expect(await current.outbox.toArray()).toEqual([pending]);
    current.close();
  });

  it('v3 → v4: el cursor vuelve a 0 para bajar el temporizador; las notas quedan', async () => {
    const name = `migracion-${newId()}`;
    names.push(name);
    const v3 = openVersion1(name);
    v3.version(2).stores({ userSettings: 'id, section' });
    v3.version(3).stores({ notes: 'id, deckId', cards: 'id, noteId' });
    const note = { id: newId(), deckId: newId(), deletedAt: null };
    await v3.table('notes').add(note);
    await v3.table('meta').put({ key: 'syncCursor', value: '77' });
    v3.close();

    const current = new EstudioDb(name);
    await current.open();
    expect(current.verno).toBe(15);
    expect(await current.meta.get('syncCursor')).toEqual({ key: 'syncCursor', value: '0' });
    expect(await current.notes.toArray()).toEqual([{ ...note, tagIds: [] }]); // v13: sin etiquetas
    current.close();
  });

  it('v4 → última: los bloques del temporizador quedan con extended: false (§5); el outbox intacto', async () => {
    const name = `migracion-${newId()}`;
    names.push(name);
    const v4 = openVersion1(name);
    v4.version(2).stores({ userSettings: 'id, section' });
    v4.version(3).stores({ notes: 'id, deckId', cards: 'id, noteId' });
    v4.version(4).stores({ timerSessions: 'id, state', timerBlockLogs: 'id, timerSessionId, endedAt' });
    const block = { id: newId(), timerSessionId: newId(), kind: 'focus', outcome: 'completed', endedAt: 5 };
    const pending = { mutationId: newId(), op: 'append', entity: 'timerBlockLog', row: block, createdAt: 5 };
    await v4.table('timerBlockLogs').add(block);
    await v4.table('outbox').add(pending);
    await v4.table('meta').put({ key: 'syncCursor', value: '9' });
    v4.close();

    const current = new EstudioDb(name);
    await current.open();
    expect(current.verno).toBe(15);
    expect(await current.timerBlockLogs.toArray()).toEqual([{ ...block, extended: false }]);
    expect(await current.outbox.toArray()).toEqual([pending]);
    current.close();
  });

  it('v5 → última: aparecen temas, autoexplicaciones (LD5), exámenes (R11) y simulacros (P7); el cursor vuelve a 0', async () => {
    const name = `migracion-${newId()}`;
    names.push(name);
    const v5 = openVersion1(name);
    v5.version(2).stores({ userSettings: 'id, section' });
    v5.version(3).stores({ notes: 'id, deckId', cards: 'id, noteId' });
    v5.version(4).stores({ timerSessions: 'id, state', timerBlockLogs: 'id, timerSessionId, endedAt' });
    v5.version(5).stores({});
    const note = { id: newId(), deckId: newId(), topicId: null, deletedAt: null };
    const pending = { mutationId: newId(), op: 'upsert', entity: 'note', row: note, createdAt: 3 };
    await v5.table('notes').add(note);
    await v5.table('outbox').add(pending);
    await v5.table('meta').put({ key: 'syncCursor', value: '120' });
    v5.close();

    const current = new EstudioDb(name);
    await current.open();
    expect(current.verno).toBe(15);
    expect(await current.meta.get('syncCursor')).toEqual({ key: 'syncCursor', value: '0' });
    expect(await current.notes.toArray()).toEqual([{ ...note, tagIds: [] }]); // v13: sin etiquetas
    expect(await current.outbox.toArray()).toEqual([pending]);
    expect(await current.topics.count()).toBe(0);
    expect(await current.selfExplanations.count()).toBe(0);
    expect(await current.exams.count()).toBe(0);
    expect(await current.studySessions.count()).toBe(0);
    current.close();
  });

  it('v8 → v9: los mazos quedan activos (pausedAt: null); el cursor vuelve a 0; el outbox intacto', async () => {
    const name = `migracion-${newId()}`;
    names.push(name);
    const v8 = openVersion1(name);
    v8.version(2).stores({ userSettings: 'id, section' });
    v8.version(3).stores({ notes: 'id, deckId', cards: 'id, noteId' });
    v8.version(4).stores({ timerSessions: 'id, state', timerBlockLogs: 'id, timerSessionId, endedAt' });
    v8.version(5).stores({});
    v8.version(6).stores({ topics: 'id, deckId', selfExplanations: 'id, topicId' });
    v8.version(7).stores({ exams: 'id, date' });
    v8.version(8).stores({ studySessions: 'id, examId' });
    const deck = { id: newId(), name: 'Carpo', description: null, hlc: 'h', updatedAt: 1, deletedAt: null };
    const pending = { mutationId: newId(), op: 'upsert', entity: 'deck', row: deck, createdAt: 1 };
    await v8.table('decks').add(deck);
    await v8.table('outbox').add(pending);
    await v8.table('meta').put({ key: 'syncCursor', value: '340' });
    v8.close();

    const current = new EstudioDb(name);
    await current.open();
    expect(current.verno).toBe(15);
    expect(await current.decks.toArray()).toEqual([{ ...deck, pausedAt: null }]);
    expect(await current.outbox.toArray()).toEqual([pending]); // la api completa el campo al recibirlo
    expect(await current.meta.get('syncCursor')).toEqual({ key: 'syncCursor', value: '0' });
    current.close();
  });

  it('v9 → v10: aparecen las imágenes y su cola de subida (FE8); el cursor vuelve a 0; lo demás intacto', async () => {
    const name = `migracion-${newId()}`;
    names.push(name);
    const v9 = openVersion1(name);
    v9.version(2).stores({ userSettings: 'id, section' });
    v9.version(3).stores({ notes: 'id, deckId', cards: 'id, noteId' });
    v9.version(4).stores({ timerSessions: 'id, state', timerBlockLogs: 'id, timerSessionId, endedAt' });
    v9.version(5).stores({});
    v9.version(6).stores({ topics: 'id, deckId', selfExplanations: 'id, topicId' });
    v9.version(7).stores({ exams: 'id, date' });
    v9.version(8).stores({ studySessions: 'id, examId' });
    v9.version(9).stores({});
    const deck = {
      id: newId(),
      name: 'Carpo',
      description: null,
      pausedAt: null,
      hlc: 'h',
      updatedAt: 1,
      deletedAt: null,
    };
    const pending = { mutationId: newId(), op: 'upsert', entity: 'deck', row: deck, createdAt: 1 };
    await v9.table('decks').add(deck);
    await v9.table('outbox').add(pending);
    await v9.table('meta').put({ key: 'syncCursor', value: '512' });
    v9.close();

    const current = new EstudioDb(name);
    await current.open();
    expect(current.verno).toBe(15);
    expect(await current.decks.toArray()).toEqual([deck]);
    expect(await current.outbox.toArray()).toEqual([pending]);
    expect(await current.mediaAssets.count()).toBe(0);
    expect(await current.pendingUploads.count()).toBe(0);
    expect(await current.meta.get('syncCursor')).toEqual({ key: 'syncCursor', value: '0' });
    current.close();
  });
});

describe('migraciones de Dexie: grupos de contraste (R9, LD10)', () => {
  it('v10 → v11: aparecen los grupos de contraste; el cursor vuelve a 0; lo demás intacto', async () => {
    const name = `migracion-${newId()}`;
    names.push(name);
    const v10 = openVersion1(name);
    v10.version(2).stores({ userSettings: 'id, section' });
    v10.version(3).stores({ notes: 'id, deckId', cards: 'id, noteId' });
    v10.version(4).stores({ timerSessions: 'id, state', timerBlockLogs: 'id, timerSessionId, endedAt' });
    v10.version(5).stores({});
    v10.version(6).stores({ topics: 'id, deckId', selfExplanations: 'id, topicId' });
    v10.version(7).stores({ exams: 'id, date' });
    v10.version(8).stores({ studySessions: 'id, examId' });
    v10.version(9).stores({});
    v10.version(10).stores({ mediaAssets: 'id', pendingUploads: 'assetId' });
    const pending = { mutationId: newId(), op: 'upsert', entity: 'deck', row: {}, createdAt: 1 };
    await v10.table('outbox').add(pending);
    await v10
      .table('pendingUploads')
      .add({ assetId: newId(), data: new Uint8Array([1]).buffer, mime: 'image/png' });
    await v10.table('meta').put({ key: 'syncCursor', value: '900' });
    v10.close();

    const current = new EstudioDb(name);
    await current.open();
    expect(current.verno).toBe(15);
    expect(await current.contrastGroups.count()).toBe(0);
    expect(await current.outbox.toArray()).toEqual([pending]);
    expect(await current.pendingUploads.count()).toBe(1);
    expect(await current.meta.get('syncCursor')).toEqual({ key: 'syncCursor', value: '0' });
    current.close();
  });
});

describe('migraciones de Dexie: registro de sueño (§5)', () => {
  it('v11 → v12: aparece el registro de sueño; el cursor vuelve a 0; lo demás intacto', async () => {
    const name = `migracion-${newId()}`;
    names.push(name);
    const v11 = openVersion1(name);
    v11.version(2).stores({ userSettings: 'id, section' });
    v11.version(3).stores({ notes: 'id, deckId', cards: 'id, noteId' });
    v11.version(4).stores({ timerSessions: 'id, state', timerBlockLogs: 'id, timerSessionId, endedAt' });
    v11.version(5).stores({});
    v11.version(6).stores({ topics: 'id, deckId', selfExplanations: 'id, topicId' });
    v11.version(7).stores({ exams: 'id, date' });
    v11.version(8).stores({ studySessions: 'id, examId' });
    v11.version(9).stores({});
    v11.version(10).stores({ mediaAssets: 'id', pendingUploads: 'assetId' });
    v11.version(11).stores({ contrastGroups: 'id' });
    const group = { id: newId(), name: 'Pares craneales', noteIds: [newId(), newId()] };
    const pending = { mutationId: newId(), op: 'upsert', entity: 'contrastGroup', row: group, createdAt: 1 };
    await v11.table('contrastGroups').add(group);
    await v11.table('outbox').add(pending);
    await v11.table('meta').put({ key: 'syncCursor', value: '1200' });
    v11.close();

    const current = new EstudioDb(name);
    await current.open();
    expect(current.verno).toBe(15);
    expect(await current.sleepLogs.count()).toBe(0);
    expect(await current.contrastGroups.toArray()).toEqual([group]);
    expect(await current.outbox.toArray()).toEqual([pending]);
    expect(await current.meta.get('syncCursor')).toEqual({ key: 'syncCursor', value: '0' });
    current.close();
  });
});

describe('migraciones de Dexie: etiquetas', () => {
  it('v12 → v13: aparecen las etiquetas, las notas quedan sin ninguna y se filtran por etiqueta', async () => {
    const name = `migracion-${newId()}`;
    names.push(name);
    const v12 = openVersion1(name);
    v12.version(2).stores({ userSettings: 'id, section' });
    v12.version(3).stores({ notes: 'id, deckId', cards: 'id, noteId' });
    v12.version(4).stores({ timerSessions: 'id, state', timerBlockLogs: 'id, timerSessionId, endedAt' });
    v12.version(5).stores({});
    v12.version(6).stores({ topics: 'id, deckId', selfExplanations: 'id, topicId' });
    v12.version(7).stores({ exams: 'id, date' });
    v12.version(8).stores({ studySessions: 'id, examId' });
    v12.version(9).stores({});
    v12.version(10).stores({ mediaAssets: 'id', pendingUploads: 'assetId' });
    v12.version(11).stores({ contrastGroups: 'id' });
    v12.version(12).stores({ sleepLogs: 'id, date' });
    const note = { id: newId(), deckId: newId(), topicId: null, deletedAt: null };
    const pending = { mutationId: newId(), op: 'upsert', entity: 'note', row: note, createdAt: 1 };
    await v12.table('notes').add(note);
    await v12.table('outbox').add(pending);
    await v12.table('meta').put({ key: 'syncCursor', value: '1500' });
    v12.close();

    const current = new EstudioDb(name);
    await current.open();
    expect(current.verno).toBe(15);
    expect(await current.tags.count()).toBe(0);
    expect(await current.notes.toArray()).toEqual([{ ...note, tagIds: [] }]);
    expect(await current.outbox.toArray()).toEqual([pending]); // la api completa el campo al recibirlo
    expect(await current.meta.get('syncCursor')).toEqual({ key: 'syncCursor', value: '0' });
    const tagId = newId();
    await current.notes.update(note.id, { tagIds: [tagId] });
    expect((await current.notes.where('tagIds').equals(tagId).toArray()).map((n) => n.id)).toEqual([note.id]);
    current.close();
  });
});

describe('migraciones de Dexie: premios (UX10)', () => {
  it('v13 → v14: aparecen premios y canjes; el cursor vuelve a 0; lo demás intacto', async () => {
    const name = `migracion-${newId()}`;
    names.push(name);
    const v13 = openVersion1(name);
    v13.version(2).stores({ userSettings: 'id, section' });
    v13.version(3).stores({ notes: 'id, deckId', cards: 'id, noteId' });
    v13.version(4).stores({ timerSessions: 'id, state', timerBlockLogs: 'id, timerSessionId, endedAt' });
    v13.version(5).stores({});
    v13.version(6).stores({ topics: 'id, deckId', selfExplanations: 'id, topicId' });
    v13.version(7).stores({ exams: 'id, date' });
    v13.version(8).stores({ studySessions: 'id, examId' });
    v13.version(9).stores({});
    v13.version(10).stores({ mediaAssets: 'id', pendingUploads: 'assetId' });
    v13.version(11).stores({ contrastGroups: 'id' });
    v13.version(12).stores({ sleepLogs: 'id, date' });
    v13.version(13).stores({ tags: 'id', notes: 'id, deckId, *tagIds' });
    const tag = { id: newId(), name: 'Huesos', deletedAt: null };
    const pending = { mutationId: newId(), op: 'upsert', entity: 'tag', row: tag, createdAt: 1 };
    await v13.table('tags').add(tag);
    await v13.table('outbox').add(pending);
    await v13.table('meta').put({ key: 'syncCursor', value: '1800' });
    v13.close();

    const current = new EstudioDb(name);
    await current.open();
    expect(current.verno).toBe(15);
    expect(await current.rewards.count()).toBe(0);
    expect(await current.rewardRedemptions.count()).toBe(0);
    expect(await current.tags.toArray()).toEqual([tag]);
    expect(await current.outbox.toArray()).toEqual([pending]);
    expect(await current.meta.get('syncCursor')).toEqual({ key: 'syncCursor', value: '0' });
    current.close();
  });
});

describe('migraciones de Dexie: diagnósticos (FE13)', () => {
  it('v14 → v15: aparece la tabla de errores; el cursor y el outbox no cambian', async () => {
    const name = `migracion-${newId()}`;
    names.push(name);
    const v14 = openVersion1(name);
    v14.version(2).stores({ userSettings: 'id, section' });
    v14.version(3).stores({ notes: 'id, deckId', cards: 'id, noteId' });
    v14.version(4).stores({ timerSessions: 'id, state', timerBlockLogs: 'id, timerSessionId, endedAt' });
    v14.version(5).stores({});
    v14.version(6).stores({ topics: 'id, deckId', selfExplanations: 'id, topicId' });
    v14.version(7).stores({ exams: 'id, date' });
    v14.version(8).stores({ studySessions: 'id, examId' });
    v14.version(9).stores({});
    v14.version(10).stores({ mediaAssets: 'id', pendingUploads: 'assetId' });
    v14.version(11).stores({ contrastGroups: 'id' });
    v14.version(12).stores({ sleepLogs: 'id, date' });
    v14.version(13).stores({ tags: 'id', notes: 'id, deckId, *tagIds' });
    v14.version(14).stores({ rewards: 'id', rewardRedemptions: 'id, rewardId' });
    const reward = { id: newId(), name: 'Un postre', cost: 5, deletedAt: null };
    const pending = { mutationId: newId(), op: 'upsert', entity: 'reward', row: reward, createdAt: 1 };
    await v14.table('rewards').add(reward);
    await v14.table('outbox').add(pending);
    await v14.table('meta').put({ key: 'syncCursor', value: '2100' });
    v14.close();

    const current = new EstudioDb(name);
    await current.open();
    expect(current.verno).toBe(15);
    expect(await current.diagnostics.count()).toBe(0);
    expect(await current.rewards.toArray()).toEqual([reward]);
    expect(await current.outbox.toArray()).toEqual([pending]);
    expect(await current.meta.get('syncCursor')).toEqual({ key: 'syncCursor', value: '2100' });
    current.close();
  });
});
