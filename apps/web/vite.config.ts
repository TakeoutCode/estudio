/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Puerto propio: otro proyecto en el mismo origen (localhost:5173) comparte service
  // worker, IndexedDB y cookies con esta app y puede dejarla en blanco.
  server: { port: 5180, strictPort: true },
  preview: { port: 5181, strictPort: true },
  // FRONTEND FE4: el worker de proyección es un módulo ES (Safari 15+).
  worker: { format: 'es' },
  plugins: [
    react(),
    tailwindcss(),
    // FRONTEND FE6: service worker propio (push y clics) y actualización solo cuando ella acepta.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      includeManifestIcons: false, // los íconos ya entran por globPatterns
      manifest: {
        id: '/',
        name: 'Estudio',
        short_name: 'Estudio',
        description: 'Repaso espaciado y práctica para tus exámenes',
        lang: 'es',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#fefcfd',
        theme_color: '#fefcfd',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,woff2}'] },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    env: { VITE_API_URL: 'http://localhost:3180/api' },
    // Con la cobertura activa (QA4) una pantalla con el worker de proyección pasa de 5 s.
    testTimeout: 15_000,
    // QUALITY QA4: el módulo sync de la web, al menos 85 % de líneas y ramas.
    coverage: {
      provider: 'v8',
      include: ['src/sync/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: { lines: 85, branches: 85 },
    },
  },
});
