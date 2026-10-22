import { expect, test } from './fixtures';

// QUALITY §4 y UX10: apagada (la cuenta respondió "No, gracias"), ninguna ruta muestra nada de
// la gamificación. Cada nodo de gamificación lleva `data-gamification`.
const ROUTES = ['/', '/decks', '/exams', '/dashboard', '/settings', '/rewards', '/study'] as const;

test('UX10: con la gamificación apagada, ningún nodo data-gamification en ninguna ruta', async ({
  account,
}) => {
  const { page } = account;
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(page.locator('[data-gamification]'), route).toHaveCount(0);
  }
});
