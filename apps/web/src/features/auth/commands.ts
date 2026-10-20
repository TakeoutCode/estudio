import { z } from 'zod';
import { db, type EstudioDb } from '@/db/schema';

const ACCOUNT_KEY = 'accountUserId';
const CURSOR_KEY = 'syncCursor';

export type AccountDb = EstudioDb;

/** Este dispositivo tiene datos de otra cuenta que todavía no se enviaron. */
export class AccountMismatchError extends Error {
  constructor() {
    super('account_mismatch');
    this.name = 'AccountMismatchError';
  }
}

/** Cuenta a la que pertenecen los datos locales; `null` si nunca inició sesión aquí. */
export async function accountUserId(database: EstudioDb = db): Promise<string | null> {
  const stored = z.uuid().safeParse((await database.meta.get(ACCOUNT_KEY))?.value);
  return stored.success ? stored.data : null;
}

/**
 * Liga los datos locales a la cuenta que inicia sesión. Si eran de otra cuenta se borran,
 * salvo que tengan cambios sin enviar: perderlos nunca es silencioso (SYNC SY8).
 */
export async function bindDeviceToAccount(userId: string, database: EstudioDb = db): Promise<void> {
  await database.transaction('rw', database.tables, async () => {
    const current = await accountUserId(database);
    if (current && current !== userId) {
      if ((await database.outbox.count()) > 0) throw new AccountMismatchError();
      for (const table of database.tables) if (table.name !== 'meta') await table.clear();
      await database.meta.delete(CURSOR_KEY);
    }
    await database.meta.put({ key: ACCOUNT_KEY, value: userId });
  });
}
