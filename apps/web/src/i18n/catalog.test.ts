import { describe, expect, it } from 'vitest';
import bootText from './es/boot.json?raw';
import restText from './es/rest.json?raw';

/**
 * FRONTEND FE9: lo que se pinta antes de que llegue `rest.json` (el layout, Hoy y el aviso de
 * error del arranque). Una clave nueva en estos archivos va en `boot.json`.
 */
const SOURCES = import.meta.glob<string>(
  [
    '../main.tsx',
    '../app/RootLayout.tsx',
    '../ui/Loading.tsx',
    '../app/TabBar.tsx',
    '../app/OfflineBanner.tsx',
    '../app/UpdatePrompt.tsx',
    '../app/RouteError.tsx',
    '../features/today/TodayScreen.tsx',
    '../features/today/FewerNewOffer.tsx',
    '../features/notifications/NotificationsAtOpen.tsx',
    '../features/sleep/SleepCheckIn.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
);

type Tree = { readonly [key: string]: string | Tree };

// Como texto, tal como están en el archivo.
const boot = JSON.parse(bootText) as Tree;
const rest = JSON.parse(restText) as Tree;

const leaves = (tree: Tree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : leaves(value, `${prefix}${key}.`),
  );

const node = (tree: Tree, path: string): string | Tree | undefined =>
  path
    .split('.')
    .reduce<string | Tree | undefined>((at, key) => (typeof at === 'object' ? at[key] : undefined), tree);

/** La clave existe tal cual, con sus plurales (`_one`, `_other`) o, si es un prefijo dinámico, como sección. */
const inBoot = (key: string): boolean => {
  if (key.endsWith('.')) return typeof node(boot, key.slice(0, -1)) === 'object';
  return [key, `${key}_one`, `${key}_other`].some((k) => typeof node(boot, k) === 'string');
};

/** Claves literales de `t('…')`, y los prefijos de `t(\`a.b.${x}\`)` terminados en punto. */
function keysIn(code: string): string[] {
  const literal = [...code.matchAll(/\bt\(\s*['"]([a-zA-Z][\w.]*)['"]/g)].map((m) => m[1] ?? '');
  const dynamic = [...code.matchAll(/\bt\(\s*`([a-zA-Z][\w.]*\.)\$\{/g)].map((m) => m[1] ?? '');
  // Claves en constantes que luego pasan a `t(label)` (las pestañas).
  const constants = [...code.matchAll(/label:\s*['"]([a-z]+\.[\w.]+)['"]/g)].map((m) => m[1] ?? '');
  // `boot.error.boot` en main.tsx; no la ruta `./i18n/es/boot.json`.
  const boots = [...code.matchAll(/\bboot\.(?!json\b)([\w.]+)/g)].map((m) => m[1] ?? '');
  return [...literal, ...dynamic, ...constants, ...boots];
}

describe('catálogo en dos partes (FRONTEND FE9)', () => {
  it('ninguna clave está en boot.json y en rest.json a la vez', () => {
    const restKeys = new Set(leaves(rest));
    expect(leaves(boot).filter((key) => restKeys.has(key))).toEqual([]);
  });

  it.each(Object.entries(SOURCES))('%s solo usa claves de boot.json', (_file, code) => {
    const keys = keysIn(code);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => !inBoot(key))).toEqual([]);
  });
});
