// FRONTEND FE6: los PNG del manifest y el apple-touch-icon salen de los SVG de public/, porque
// iOS no usa SVG en la pantalla de inicio. Se corre a mano al cambiar un ícono (`pnpm icons`).
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const PUBLIC = new URL('../public/', import.meta.url);
const ROUNDED_BACKGROUND = '<rect width="512" height="512" rx="112"';

interface Target {
  readonly from: string;
  readonly to: string;
  readonly size: number;
  /** iOS recorta sus propias esquinas y pinta de negro lo transparente: el fondo va completo. */
  readonly fullBleed?: boolean;
}

const TARGETS: readonly Target[] = [
  { from: 'icon.svg', to: 'icon-192.png', size: 192 },
  { from: 'icon.svg', to: 'icon-512.png', size: 512 },
  { from: 'icon-maskable.svg', to: 'icon-maskable-512.png', size: 512 },
  { from: 'icon.svg', to: 'apple-touch-icon.png', size: 180, fullBleed: true },
];

async function svgFor(target: Target): Promise<string> {
  const svg = await readFile(new URL(target.from, PUBLIC), 'utf8');
  if (!target.fullBleed) return svg;
  if (!svg.includes(ROUNDED_BACKGROUND)) throw new Error(`${target.from} cambió: no encuentro su fondo`);
  return svg.replace(ROUNDED_BACKGROUND, '<rect width="512" height="512"');
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const target of TARGETS) {
    const src = `data:image/svg+xml;base64,${Buffer.from(await svgFor(target)).toString('base64')}`;
    await page.setViewportSize({ width: target.size, height: target.size });
    // `setContent` espera el evento load, que incluye la imagen.
    await page.setContent(
      `<body style="margin:0"><img src="${src}" width="${target.size}" height="${target.size}"></body>`,
    );
    await writeFile(new URL(target.to, PUBLIC), await page.screenshot({ omitBackground: true }));
    console.log(`public/${target.to} (${target.size}×${target.size})`);
  }
} finally {
  await browser.close();
}
