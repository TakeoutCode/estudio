import { fileDate, saveFile } from '@/lib/download';
import { createZip } from '@/lib/zip';
import { readBackup } from './queries';
import { buildSpreadsheets } from './spreadsheets';

/** QA7: el respaldo completo, el único que se puede importar. */
export async function downloadBackup(userId: string, now = Date.now()): Promise<void> {
  const { backup } = await readBackup(userId, now);
  saveFile(
    `estudio-respaldo-${fileDate(now)}.json`,
    new Blob([JSON.stringify(backup)], { type: 'application/json' }),
  );
}

/** QA7: un CSV por tabla, juntos en un ZIP para que el iPhone los guarde de una vez. */
export async function downloadSpreadsheets(userId: string, now = Date.now()): Promise<void> {
  const { backup, cardStates, timeZone } = await readBackup(userId, now);
  const encoder = new TextEncoder();
  const zip = createZip(
    buildSpreadsheets(backup, cardStates, timeZone).map((sheet) => ({
      name: sheet.name,
      data: encoder.encode(sheet.text),
    })),
    new Date(now),
  );
  saveFile(`estudio-planillas-${fileDate(now)}.zip`, new Blob([zip], { type: 'application/zip' }));
}
