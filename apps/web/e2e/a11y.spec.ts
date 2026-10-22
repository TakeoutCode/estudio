import AxeBuilder from '@axe-core/playwright';
import { createBasicCard, expect, test } from './fixtures';

// UI-UX UX4: WCAG 2.2 AA en ambos temas, sin violaciones de axe. El tema por defecto es
// "Sistema" (UX5), así que se cambia con prefers-color-scheme.
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const MAIN = ['/', '/decks', '/exams', '/dashboard', '/settings', '/rewards', '/notes/new'];

test('UX4: sin violaciones de axe en las pantallas principales y los flujos, en claro y en oscuro', async ({
  account,
}, testInfo) => {
  const { page } = account;
  const deckId = await createBasicCard(
    page,
    `Axe ${testInfo.project.name} ${String(Date.now())}`,
    '¿Hueso del pulgar?',
    'Trapecio',
  );
  const routes = [...MAIN, `/decks/${deckId}`, `/decks/${deckId}/ia`, `/study?mazo=${deckId}`];
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const route of routes) {
      await page.goto(route);
      await page.getByRole('heading').first().waitFor();
      const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      const found = violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      expect(found, `${scheme} ${route}`).toEqual([]);
    }
  }
});
