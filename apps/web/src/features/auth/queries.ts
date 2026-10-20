import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { accountUserId } from './commands';

/** Cuenta ligada a este dispositivo: `undefined` mientras carga, `null` si no hay. */
export const useAccountUserId = (): string | null | undefined => useLiveQuery(() => accountUserId(db), []);
