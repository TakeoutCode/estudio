import { type BrowserContext, test as base, expect, type Page } from '@playwright/test';
import { accountFor, E2E_API, E2E_PASSWORD } from './accounts';

export interface Account {
  readonly context: BrowserContext;
  /** La pestaña abierta; una prueba que la cierra deja aquí la nueva. */
  page: Page;
}

let devices = 0;

/**
 * BE12 limita el login a 5 por minuto por IP. Cada contexto ("dispositivo") llega a la API con su
 * propia IP en X-Forwarded-For, como detrás del proxy de Vercel (la API de las pruebas corre con
 * TRUST_PROXY_HOPS=1): así los logins de las pruebas no se cruzan y no hace falta esperar.
 */
export async function asOwnDevice(context: BrowserContext): Promise<void> {
  devices += 1;
  const ip = `198.51.100.${String(devices)}`; // TEST-NET-2, RFC 5737
  await context.route(`${E2E_API}/**`, (route) =>
    route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }),
  );
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: '¿Primera vez aquí? Crea tu cuenta' }).click();
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña (12 caracteres o más)').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  // Crear una cuenta que ya existe responde igual (BE10) y luego entra con la misma contraseña.
  const outcome = await Promise.race([
    page
      .getByLabel('Correo')
      .waitFor({ state: 'detached', timeout: 30_000 })
      .then(() => 'in' as const),
    page
      .getByText('Hubo varios intentos seguidos')
      .waitFor({ timeout: 30_000 })
      .then(() => 'limited' as const),
  ]);
  // Con una IP por dispositivo (asOwnDevice) el límite por IP no se alcanza: si pasa, es un error.
  if (outcome === 'limited') throw new Error('BE12 limitó el login de las pruebas');
  // UX10: la pregunta de la gamificación sale una sola vez por cuenta; aquí se apaga (lo verifica
  // gamification.spec). En otra corrida contra la misma base ya no aparece.
  const no = page.getByRole('button', { name: 'No, gracias' });
  const asked = await no
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (asked) {
    await no.click();
    await expect(no).toHaveCount(0);
  }
}

/**
 * Cada proyecto inicia sesión una sola vez y todas sus pruebas usan esa sesión. Si una prueba
 * falla, Playwright reinicia el worker y vuelve a entrar.
 */
export const test = base.extend<object, { account: Account }>({
  account: [
    async ({ browser }, use, workerInfo) => {
      const context = await browser.newContext(workerInfo.project.use);
      await asOwnDevice(context);
      const page = await context.newPage();
      await signIn(page, accountFor(workerInfo.project.name));
      await use({ context, page });
      await context.close();
    },
    { scope: 'worker', timeout: 240_000 },
  ],
});

export { expect };

/** Filas de una tabla de Dexie leídas con IndexedDB, para ver lo guardado en el dispositivo. */
export function rows<T>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(
    (name) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open('estudio');
        open.onerror = () => {
          reject(new Error('no se pudo abrir IndexedDB'));
        };
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction(name, 'readonly').objectStore(name).getAll();
          request.onsuccess = () => {
            resolve(request.result as T[]);
            db.close();
          };
          request.onerror = () => {
            reject(new Error(`no se pudo leer ${name}`));
          };
        };
      }),
    store,
  );
}

/** Crea una tarjeta básica en un mazo nuevo desde el editor y devuelve el id del mazo. */
export async function createBasicCard(
  page: Page,
  deck: string,
  front: string,
  back: string,
): Promise<string> {
  await page.goto('/notes/new');
  const deckSelect = page.getByRole('combobox', { name: 'Mazo', exact: true });
  // Sin mazos, "Mazo nuevo…" ya viene elegido.
  if ((await deckSelect.inputValue()) !== 'new') await deckSelect.selectOption('new');
  await page.getByLabel('Nombre del mazo nuevo').fill(deck);
  await page.getByLabel('Pregunta').fill(front);
  await page.getByLabel('Respuesta').fill(back);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect
    .poll(async () => (await rows<{ name: string }>(page, 'decks')).some((d) => d.name === deck))
    .toBe(true);
  const decks = await rows<{ id: string; name: string }>(page, 'decks');
  const found = decks.find((d) => d.name === deck);
  if (!found) throw new Error(`sin mazo ${deck}`);
  return found.id;
}
