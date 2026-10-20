import type { Topic } from '@estudio/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';

/** El tema a editar; `null` si no existe o está borrado. */
export const useTopic = (id: string | undefined): Topic | null | undefined =>
  useLiveQuery(async () => {
    if (!id) return null;
    const topic = await db.topics.get(id);
    return topic?.deletedAt === null ? topic : null;
  }, [id]);
