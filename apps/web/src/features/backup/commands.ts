import {
  type Backup,
  cardIdFor,
  CONTRAST_MEMBERS,
  newId,
  type Note,
  settingsRowId,
  SYNC_ROW_SCHEMAS,
  type SyncedEntity,
  type SyncedRow,
} from '@estudio/shared';
import { hlcWall, nextHlc, renewDeviceId } from '@/db/clock';
import { projectCards } from '@/db/projection';
import { db as defaultDb, type EstudioDb, syncedTables, TABLE_FOR } from '@/db/schema';
import { writeAndQueue } from '@/db/write';
import { syncScheduler } from '@/sync';

// QUALITY QA7: importar un respaldo. Todo entra por el outbox como cualquier escritura (FE3),
// con un HLC nuevo: lo del respaldo reemplaza la versión que haya, aquí y en el servidor. Lo que
// no está en el respaldo se queda. Funciona sin red y se envía cuando vuelva.

export interface ImportSummary {
  /** Mismo origen: conservó los ids. Otra cuenta: se copiaron con ids nuevos. */
  readonly sameAccount: boolean;
  readonly notes: number;
  readonly cards: number;
  readonly reviews: number;
  readonly exams: number;
  /** Notas de oclusión cuya imagen no viene en el respaldo ni está en este dispositivo. */
  readonly imagesMissing: number;
}

/**
 * Ids de destino. Con la misma cuenta son los mismos; con otra, uno nuevo por cada id, igual
 * en todas las referencias. Una referencia a algo que no vino en el respaldo queda en `null`.
 */
class IdMap {
  private readonly ids = new Map<string, string>();
  constructor(private readonly same: boolean) {}

  own(id: string, next: () => string = newId): string {
    if (this.same) return id;
    let mapped = this.ids.get(id);
    if (!mapped) {
      mapped = next();
      this.ids.set(id, mapped);
    }
    return mapped;
  }

  ref(id: string): string | null {
    return this.same ? id : (this.ids.get(id) ?? null);
  }
}

/** Orden de escritura: lo referenciado antes, así el outbox lo envía primero (BE2). */
const ORDER = [
  'mediaAsset',
  'deck',
  'topic',
  'note',
  'card',
  'contrastGroup',
  'exam',
  'studySession',
  'selfExplanation',
  'userSettings',
  'timerSession',
  'timerBlockLog',
  'reviewLog',
] as const satisfies readonly SyncedEntity[];

export async function importBackup(
  backup: Backup,
  { userId, database = defaultDb, now = Date.now() }: { userId: string; database?: EstudioDb; now?: number },
): Promise<ImportSummary> {
  const same = backup.userId === userId;
  const ids = new IdMap(same);
  const { entities } = backup;
  const counts = { notes: 0, cards: 0, reviews: 0, exams: 0, imagesMissing: 0 };
  const touchedCards: string[] = [];

  const result = await database.transaction(
    'rw',
    [...syncedTables(database), database.outbox, database.pendingUploads],
    async () => {
      await renewDeviceId(database); // SY-T4
      const write = async <E extends SyncedEntity>(entity: E, row: unknown): Promise<SyncedRow<E>> => {
        const parsed = SYNC_ROW_SCHEMAS[entity].parse(row) as SyncedRow<E>;
        await writeAndQueue(database, entity, parsed, now);
        return parsed;
      };
      const stamp = async () => {
        const hlc = await nextHlc(database, now);
        return { hlc, updatedAt: hlcWall(hlc) };
      };
      const append = async (
        entity: 'reviewLog' | 'timerBlockLog',
        row: Readonly<Record<string, unknown>> & { readonly id: string },
      ) => {
        const table = database.table<{ id: string }, string>(TABLE_FOR[entity]);
        if (await table.get(row.id)) return false; // ya estaba: el log es de solo inserción
        await write(entity, row);
        return true;
      };

      for (const entity of ORDER) {
        switch (entity) {
          case 'mediaAsset':
            for (const asset of entities.mediaAsset) {
              const id = ids.own(asset.id);
              // QUALITY §6: otra cuenta no puede apuntar a esta carpeta de Cloudinary.
              const keep = same && asset.publicId !== null;
              const local = await database.pendingUploads.get(id);
              if (!keep && !local) counts.imagesMissing += 1;
              await write('mediaAsset', {
                ...asset,
                id,
                publicId: keep ? asset.publicId : null,
                version: keep ? asset.version : null,
                ...(await stamp()),
              });
            }
            break;
          case 'deck':
            for (const deck of entities.deck)
              await write('deck', { ...deck, id: ids.own(deck.id), ...(await stamp()) });
            break;
          case 'topic':
            for (const topic of entities.topic) {
              const deckId = ids.ref(topic.deckId);
              if (deckId)
                await write('topic', { ...topic, id: ids.own(topic.id), deckId, ...(await stamp()) });
            }
            break;
          case 'note':
            for (const note of entities.note) {
              const content = remapContent(note, ids);
              const deckId = ids.ref(note.deckId);
              if (!content || !deckId) continue;
              const topicId = note.topicId === null ? null : ids.ref(note.topicId);
              await write('note', {
                ...note,
                id: ids.own(note.id),
                deckId,
                topicId,
                content,
                ...(await stamp()),
              });
              counts.notes += 1;
            }
            break;
          case 'card':
            for (const card of entities.card) {
              const noteId = ids.ref(card.noteId);
              if (!noteId) continue;
              // SYNC §1: el id de una Card sale de su nota y su lado.
              const id = ids.own(card.id, () => cardIdFor(noteId, card.ordinal));
              await write('card', { ...card, id, noteId, ...(await stamp()) });
              touchedCards.push(id);
              counts.cards += 1;
            }
            break;
          case 'contrastGroup':
            // LD10: el brazo y la semilla del sorteo viajan con el grupo.
            for (const group of entities.contrastGroup) {
              const noteIds = group.noteIds.flatMap((n) => ids.ref(n) ?? []);
              if (noteIds.length < CONTRAST_MEMBERS.min) continue;
              await write('contrastGroup', { ...group, id: ids.own(group.id), noteIds, ...(await stamp()) });
            }
            break;
          case 'exam':
            for (const exam of entities.exam) {
              const topicIds = exam.topicIds.flatMap((t) => ids.ref(t) ?? []);
              if (topicIds.length === 0) continue;
              await write('exam', { ...exam, id: ids.own(exam.id), topicIds, ...(await stamp()) });
              counts.exams += 1;
            }
            break;
          case 'studySession':
            for (const session of entities.studySession) {
              const examId = ids.ref(session.examId);
              const items = session.items.flatMap((item) => {
                const cardId = ids.ref(item.cardId);
                const topicId = item.topicId === null ? null : ids.ref(item.topicId);
                return cardId ? [{ ...item, cardId, topicId }] : [];
              });
              if (!examId || items.length === 0) continue;
              await write('studySession', {
                ...session,
                id: ids.own(session.id),
                examId,
                items,
                ...(await stamp()),
              });
            }
            break;
          case 'selfExplanation':
            for (const explanation of entities.selfExplanation) {
              const topicId = ids.ref(explanation.topicId);
              if (topicId) {
                await write('selfExplanation', {
                  ...explanation,
                  id: ids.own(explanation.id),
                  topicId,
                  ...(await stamp()),
                });
              }
            }
            break;
          case 'userSettings':
            for (const settings of entities.userSettings) {
              await write('userSettings', {
                ...settings,
                id: settingsRowId(userId, settings.section),
                ...(await stamp()),
              });
            }
            break;
          case 'timerSession':
            // Solo las terminadas: revivir un temporizador en curso pisaría el de ahora (§3).
            for (const session of entities.timerSession) {
              if (session.state !== 'ended') continue;
              await write('timerSession', { ...session, id: ids.own(session.id), ...(await stamp()) });
            }
            break;
          case 'timerBlockLog':
            for (const block of entities.timerBlockLog) {
              const timerSessionId = ids.ref(block.timerSessionId);
              if (timerSessionId)
                await append('timerBlockLog', { ...block, id: ids.own(block.id), timerSessionId });
            }
            break;
          case 'reviewLog':
            for (const log of entities.reviewLog) {
              const cardId = ids.ref(log.cardId);
              if (!cardId) continue;
              const row = {
                ...log,
                id: ids.own(log.id),
                cardId,
                sessionId: ids.ref(log.sessionId) ?? log.sessionId,
              };
              if (await append('reviewLog', row)) {
                counts.reviews += 1;
                touchedCards.push(cardId);
              }
            }
            break;
        }
      }
      // ARC5: la proyección de lo importado, en la misma transacción.
      await projectCards(database, new Set(touchedCards));
      return { sameAccount: same, ...counts };
    },
  );
  syncScheduler.poke();
  return result;
}

/** Las referencias dentro del contenido: la imagen de una oclusión. */
function remapContent(note: Note, ids: IdMap): Note['content'] | null {
  if (note.content.kind !== 'image_occlusion') return note.content;
  const imageAssetId = ids.ref(note.content.imageAssetId);
  return imageAssetId ? { ...note.content, imageAssetId } : null;
}
