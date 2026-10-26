import { accountFor } from './accounts';
import { asOwnDevice, createBasicCard, expect, rows, signIn, test } from './fixtures';

interface LogRow {
  readonly id: string;
  readonly cardId: string;
}
interface CardStateRow {
  readonly cardId: string;
  readonly due: number;
  readonly stability: number;
  readonly reps: number;
}

/**
 * QUALITY §1 y SYNC SY-T1: dos dispositivos con la misma cuenta. Lo que crea uno llega al otro,
 * y el repaso que hace el segundo vuelve al primero con la misma proyección FSRS (ARC5).
 */
test('SY-T1: entre dos dispositivos, la tarjeta y su repaso llegan y dan el mismo estado', async ({
  account,
  browser,
}, testInfo) => {
  const phone = account.page;
  const outboxEmpty = (page: typeof phone) =>
    expect.poll(async () => (await rows<unknown>(page, 'outbox')).length, { timeout: 20_000 }).toBe(0);

  const deck = `Dos dispositivos ${testInfo.project.name} ${String(Date.now())}`;
  const deckId = await createBasicCard(phone, deck, '¿Hueso del talón?', 'Calcáneo');
  await outboxEmpty(phone); // SY8: la escritura dispara la sync

  // El segundo dispositivo entra con la misma cuenta y baja todo.
  const laptopContext = await browser.newContext(testInfo.project.use);
  await asOwnDevice(laptopContext);
  try {
    const laptop = await laptopContext.newPage();
    await signIn(laptop, accountFor(testInfo.project.name));
    await expect
      .poll(async () => (await rows<{ id: string }>(laptop, 'decks')).some((d) => d.id === deckId), {
        timeout: 20_000,
      })
      .toBe(true);

    await laptop.goto(`/study?mazo=${deckId}`);
    await expect(laptop.getByText('¿Hueso del talón?')).toBeVisible();
    await laptop.getByRole('button', { name: 'Mostrar respuesta' }).click();
    await laptop.getByRole('button', { name: 'Bien', exact: true }).click();
    await expect(laptop.getByRole('button', { name: 'Terminar por ahora' })).toBeVisible();
    await outboxEmpty(laptop);
    const notes = new Set(
      (await rows<{ id: string; deckId: string }>(laptop, 'notes'))
        .filter((n) => n.deckId === deckId)
        .map((n) => n.id),
    );
    const cards = new Set(
      (await rows<{ id: string; noteId: string }>(laptop, 'cards'))
        .filter((c) => notes.has(c.noteId))
        .map((c) => c.id),
    );
    const review = (await rows<LogRow>(laptop, 'reviewLogs')).find((log) => cards.has(log.cardId));
    if (!review) throw new Error('el repaso no quedó en el segundo dispositivo');

    // De vuelta en el primero: al abrir la app baja el repaso y proyecta lo mismo (SY4, ARC5).
    await phone.goto('/');
    await expect
      .poll(async () => (await rows<LogRow>(phone, 'reviewLogs')).some((log) => log.id === review.id), {
        timeout: 20_000,
      })
      .toBe(true);
    const state = async (page: typeof phone) =>
      (await rows<CardStateRow>(page, 'cardStates')).find((s) => s.cardId === review.cardId);
    const there = await state(laptop);
    expect(there?.reps).toBeGreaterThan(0);
    await expect.poll(() => state(phone)).toEqual(there);
  } finally {
    await laptopContext.close();
  }
});
