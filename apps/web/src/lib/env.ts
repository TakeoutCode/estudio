import { z } from 'zod';

// FRONTEND FE5: el único lugar que lee `import.meta.env`. Todo VITE_* termina en el bundle
// público, así que aquí solo existen estas tres variables (AGENTS §5).

const WebEnvSchema = z.object({
  VITE_API_URL: z.url({ protocol: /^https?$/ }),
  // Pasan a obligatorias cuando se implementen NOTIFICATIONS y media.
  VITE_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VITE_CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
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
