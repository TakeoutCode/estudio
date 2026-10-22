import { createBasicCard, expect, rows, test } from './fixtures';

interface LogRow {
  readonly cardId: string;
  readonly rating: number;
}
interface OutboxRow {
  readonly entity: string;
}

test.describe('sesión de estudio (QUALITY §4)', () => {
  test('R1: antes de revelar, la respuesta no está en el DOM; SY-T2: cerrar la pestaña no pierde el repaso', async ({
    account,
  }, testInfo) => {
    const { context, page } = account;
    const answer = `El escafoides ${testInfo.project.name}`;
    const deckId = await createBasicCard(
      page,
      `R1 ${testInfo.project.name} ${String(Date.now())}`,
      '¿Hueso del carpo que más se fractura?',
      answer,
    );
    const before = (await rows<LogRow>(page, 'reviewLogs')).length;

    await page.goto(`/study?mazo=${deckId}`);
    await expect(page.getByText('¿Hueso del carpo que más se fractura?')).toBeVisible();
    // FE10: ni oculta con CSS; el texto no existe hasta revelar.
    expect(await page.content()).not.toContain(answer);
    await page.getByRole('button', { name: 'Mostrar respuesta' }).click();
    await expect(page.getByText(answer)).toBeVisible();
    await page.getByRole('button', { name: 'Bien', exact: true }).click();
    // SY6: el siguiente estado (la nueva vuelve en su paso de aprendizaje) sale después de guardar.
    await expect(page.getByRole('button', { name: 'Terminar por ahora' })).toBeVisible();
    // SY-T2: la pestaña se cierra justo después de calificar.
    await page.close();

    const reopened = await context.newPage();
    await reopened.goto('/');
    expect((await rows<LogRow>(reopened, 'reviewLogs')).length).toBe(before + 1);
    account.page = reopened;
  });

  test('FE7, SY-T1: sin red se estudia y se guarda; al volver la red, el outbox se vacía', async ({
    account,
  }, testInfo) => {
    const { context, page } = account;
    const deckId = await createBasicCard(
      page,
      `Sin red ${testInfo.project.name} ${String(Date.now())}`,
      '¿Hueso del pulgar?',
      'Trapecio',
    );
    await page.goto(`/study?mazo=${deckId}`);
    await expect(page.getByText('¿Hueso del pulgar?')).toBeVisible();
    await context.setOffline(true);
    try {
      await page.getByRole('button', { name: 'Mostrar respuesta' }).click();
      await page.getByRole('button', { name: 'Bien', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Terminar por ahora' })).toBeVisible();
      // R3: guardado en el dispositivo, esperando a la red.
      expect((await rows<OutboxRow>(page, 'outbox')).map((e) => e.entity)).toContain('reviewLog');
    } finally {
      await context.setOffline(false);
    }
    // SY8: el evento `online` dispara la sync.
    await expect
      .poll(async () => (await rows<OutboxRow>(page, 'outbox')).length, { timeout: 20_000 })
      .toBe(0);
  });
});
