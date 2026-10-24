import { z } from 'zod';

// FRONTEND FE5: el único lugar que lee `import.meta.env`. Todo VITE_* termina en el bundle
// público, así que aquí solo existen estas tres variables (AGENTS §5).

const WebEnvSchema = z.object({
  // ADR-019: en Vercel, una ruta del mismo origen (`/api`); en local, la URL de la API en su
  // puerto (`http://localhost:3180/api`). Sin barra al final: las rutas empiezan con `/`.
  VITE_API_URL: z.union([z.url({ protocol: /^https?$/ }).regex(/[^/]$/), z.string().regex(/^(\/[\w-]+)+$/)]),
  // Sin clave VAPID, Ajustes dice que este navegador no permite avisos (NOTIFICATIONS NT8).
  VITE_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  // FE8: para armar la URL de cada imagen subida. Sin ella, una imagen ya subida muestra un
  // aviso en vez de romper la app (este parse corre al abrirla, no al compilar).
  VITE_CLOUDINARY_CLOUD_NAME: z
    .string()
    .regex(/^[a-z0-9_-]+$/i)
    .optional(),
});

export type WebEnv = z.output<typeof WebEnvSchema>;

const ALLOWED = new Set(Object.keys(WebEnvSchema.shape));

export function parseWebEnv(raw: Record<string, unknown>): WebEnv {
  const extra = Object.keys(raw).filter((key) => key.startsWith('VITE_') && !ALLOWED.has(key));
  if (extra.length > 0) throw new Error(`Variables VITE_ no permitidas: ${extra.join(', ')} (FRONTEND FE5)`);
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== ''));
  return WebEnvSchema.parse(cleaned);
}

export const env = parseWebEnv(import.meta.env);
