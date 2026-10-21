import {
  cardIdFor,
  encodeHlc,
  MutationSchema,
  newId,
  type NoteContent,
  parseBackup,
  Rating,
  settingsRowId,
  sleepLogIdFor,
} from '@estudio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, EstudioDb } from '@/db/schema';
import { createExam } from '@/features/exams';
import { createNote } from '@/features/notes';
import { updateStudyConfig } from '@/features/settings';
import { logSleep } from '@/features/sleep';
import { answerCard } from '@/features/study';
import { importBackup } from './commands';
import { readBackup } from './queries';

const T0 = Date.UTC(2026, 9, 20, 15);
const MIN = 60_000;
const ME = '0192f1a0-0000-7000-8000-00000000c0de';
const OTHER = '0192f1a0-0000-7000-8000-00000000beef';

const basic = {
  kind: 'basic',
  front: '¿Qué nervio inerva el deltoides?',
  back: 'El axilar',
  explanation: '',
  reverse: true,
} as const satisfies NoteContent;

let target: EstudioDb;

/** Lo que tendría su teléfono: un mazo con tema, una nota con inversa, un repaso, un examen y su retención. */
async function studyOnSource() {
  await db.meta.put({ key: 'accountUserId', value: ME });
  const note = await createNote(
    { deck: { name: 'Hombro' }, content: basic, topic: { name: 'Plexo braquial', explanation: '' } },
    { now: T0 },
  );
  await answerCard(
    {
      cardId: cardIdFor(note.id, 0),
      rating: Rating.Good,
      durationMs: 5000,
      sessionId: newId(),
      confidence: null,
    },
    { now: T0 + MIN },
  );
  if (!note.topicId) throw new Error('la nota debía tener tema');
  await createExam({ title: 'Parcial', date: T0 + 7 * 86_400_000, topicIds: [note.topicId] }, { now: T0 });
  await updateStudyConfig((c) => ({ ...c, fsrs: { ...c.fsrs, requestRetention: 0.85 } }), { now: T0 });
  return note;
}

/** Como al bajar el archivo y volver a leerlo: JSON y validación (AG2). */
async function exportedBackup() {
  const { backup } = await readBackup(ME, T0 + 2 * MIN);
  const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
  if (!('backup' in parsed)) throw new Error('el respaldo exportado debía ser válido');
  return parsed.backup;
}

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
  target = new EstudioDb(`destino-${newId()}`);
});

afterEach(async () => {
  await target.delete();
});

describe('respaldo de ella: exportar e importar (QUALITY QA7)', () => {
  it('misma cuenta en otro dispositivo: conserva los ids, rehace la proyección y todo va al outbox', async () => {
    const note = await studyOnSource();
    const backup = await exportedBackup();
    expect(backup.entities.card).toHaveLength(2);
    expect(backup.entities.reviewLog).toHaveLength(1);

    const summary = await importBackup(backup, { userId: ME, database: target, now: T0 + 3 * MIN });

    expect(summary).toMatchObject({
      sameAccount: true,
      notes: 1,
      cards: 2,
      reviews: 1,
      exams: 1,
      imagesMissing: 0,
    });
    expect((await target.notes.get(note.id))?.content).toEqual(basic);
    const front = cardIdFor(note.id, 0);
    expect(await target.cardStates.get(front)).toMatchObject({ reps: 1 }); // ARC5
    expect(await target.cardStates.get(cardIdFor(note.id, 1))).toMatchObject({ reps: 0, phase: 'new' });
    const study = await target.userSettings.get(settingsRowId(ME, 'study'));
    expect(study?.section === 'study' && study.data.fsrs.requestRetention).toBe(0.85);
    const outbox = await target.outbox.toArray();
    for (const entry of outbox) expect(MutationSchema.safeParse(entry).success).toBe(true);
    // El mazo antes que su tema, la nota antes que sus Cards y el repaso al final (BE2).
    const order = outbox.sort((a, b) => a.mutationId.localeCompare(b.mutationId)).map((e) => e.entity);
    expect(order.indexOf('deck')).toBeLessThan(order.indexOf('topic'));
    expect(order.indexOf('note')).toBeLessThan(order.indexOf('card'));
    expect(order.at(-1)).toBe('reviewLog');
  });

  it('SY-T4: importar genera un deviceId nuevo y el reloj sigue por delante', async () => {
    await studyOnSource();
    const backup = await exportedBackup();
    await target.meta.put({ key: 'deviceId', value: newId() });
    const before = (await target.meta.get('deviceId'))?.value;
    await importBackup(backup, { userId: ME, database: target, now: T0 + 3 * MIN });
    const after = (await target.meta.get('deviceId'))?.value;
    expect(after).not.toBe(before);
    expect(String((await target.meta.get('hlc'))?.value)).toContain(String(after));
  });

  it('importar dos veces no duplica repasos; lo que no venía en el respaldo se queda', async () => {
    await studyOnSource();
    const backup = await exportedBackup();
    await importBackup(backup, { userId: ME, database: target, now: T0 + 3 * MIN });
    await createNote({ deck: { name: 'Codo' }, content: { ...basic, reverse: false } }, { database: target });
    const again = await importBackup(backup, { userId: ME, database: target, now: T0 + 4 * MIN });
    expect(again.reviews).toBe(0);
    expect(await target.reviewLogs.count()).toBe(1);
    expect(await target.notes.count()).toBe(2);
  });

  it('otra cuenta: ids nuevos y referencias consistentes; Cards, ajustes y noches con su id determinista', async () => {
    const note = await studyOnSource();
    await logSleep(4, { now: T0 });
    const backup = await exportedBackup();
    await importBackup(backup, { userId: OTHER, database: target, now: T0 + 3 * MIN });

    const [copy] = await target.notes.toArray();
    if (!copy) throw new Error('faltó la nota');
    expect(copy.id).not.toBe(note.id);
    const deck = await target.decks.get(copy.deckId);
    const topic = copy.topicId ? await target.topics.get(copy.topicId) : undefined;
    expect(deck?.name).toBe('Hombro');
    expect(topic?.deckId).toBe(deck?.id);
    const cards = await target.cards.toArray();
    expect(cards.map((c) => c.id).sort()).toEqual([cardIdFor(copy.id, 0), cardIdFor(copy.id, 1)].sort());
    const [log] = await target.reviewLogs.toArray();
    expect(log?.cardId).toBe(cardIdFor(copy.id, 0));
    const [exam] = await target.exams.toArray();
    expect(exam?.topicIds).toEqual([topic?.id]);
    expect(await target.userSettings.get(settingsRowId(OTHER, 'study'))).toBeDefined();
    expect(await target.userSettings.get(settingsRowId(ME, 'study'))).toBeUndefined();
    // §5: la noche viaja con su calidad y el id de la cuenta que importa (SYNC §1).
    expect(await target.sleepLogs.toArray()).toEqual([
      expect.objectContaining({ id: sleepLogIdFor(OTHER, '2026-10-20'), date: '2026-10-20', quality: 4 }),
    ]);
  });

  it('otra cuenta: la imagen de una oclusión no se trae (otra carpeta) y se cuenta como perdida', async () => {
    const backup = await exportedBackup();
    const assetId = newId();
    const asset = {
      id: assetId,
      kind: 'image',
      mime: 'image/png',
      bytes: 10,
      width: 10,
      height: 10,
      publicId: `estudio/${ME}/${assetId}`,
      version: 1,
      hlc: encodeHlc({ wall: 1_760_000_000_000, counter: 0, node: '0192f1a0-0000-7000-8000-000000000001' }),
      updatedAt: 1_760_000_000_000,
      deletedAt: null,
    } as const;
    const withImage = { ...backup, entities: { ...backup.entities, mediaAsset: [asset] } };
    const same = await importBackup(withImage, { userId: ME, database: target, now: T0 });
    expect(same.imagesMissing).toBe(0);
    expect((await target.mediaAssets.get(assetId))?.publicId).toBe(asset.publicId);

    const other = new EstudioDb(`otra-${newId()}`);
    const copied = await importBackup(withImage, { userId: OTHER, database: other, now: T0 });
    expect(copied.imagesMissing).toBe(1);
    const [image] = await other.mediaAssets.toArray();
    expect(image).toMatchObject({ publicId: null, version: null });
    await other.delete();
  });

  it('otra cuenta: las etiquetas llegan con ids nuevos y sus notas apuntan a ellas', async () => {
    await db.meta.put({ key: 'accountUserId', value: ME });
    const note = await createNote(
      { deck: { name: 'Columna' }, content: { ...basic, reverse: false }, tags: [{ name: 'Parcial 2' }] },
      { now: T0 },
    );
    const backup = await exportedBackup();
    expect(backup.entities.tag).toHaveLength(1);
    await importBackup(backup, { userId: OTHER, database: target, now: T0 + MIN });
    const [tag] = await target.tags.toArray();
    const [copy] = await target.notes.toArray();
    expect(tag?.name).toBe('Parcial 2');
    expect(tag?.id).not.toBe(note.tagIds[0]);
    expect(copy?.tagIds).toEqual([tag?.id]);
  });

  it('§3: un temporizador en curso no se revive; uno terminado sí', async () => {
    const backup = await exportedBackup();
    const timer = (state: 'focus' | 'ended') => ({
      id: newId(),
      state,
      mode: 'structured' as const,
      startedAt: state === 'ended' ? null : T0,
      pausedAt: null,
      pausedMs: 0,
      blockIndex: 0,
      completedBlocks: 0,
      plannedMs: 25 * MIN,
      extendedThisBlock: false,
      ownerDeviceId: newId(),
      lastSeenAt: null,
      endedReason: state === 'ended' ? ('user' as const) : null,
      hlc: encodeHlc({ wall: 1_760_000_000_000, counter: 0, node: '0192f1a0-0000-7000-8000-000000000001' }),
      updatedAt: 1_760_000_000_000,
      deletedAt: null,
    });
    const running = timer('focus');
    const ended = timer('ended');
    await importBackup(
      { ...backup, entities: { ...backup.entities, timerSession: [running, ended] } },
      { userId: ME, database: target, now: T0 },
    );
    expect((await target.timerSessions.toArray()).map((s) => s.id)).toEqual([ended.id]);
  });
});
