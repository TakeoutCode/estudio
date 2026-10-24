import { EmailSchema } from '@estudio/shared';
import { z } from 'zod';

// Entorno validado al arrancar (BACKEND BE4): si falta algo, el deploy falla. Cada módulo
// nuevo agrega aquí sus variables (OpenAI, Cloudinary, VAPID, JWT...) cuando se implementa.

/** Origen serializado `scheme://host[:port]`, sin ruta: lo exigen CORS y CSRF. */
const OriginSchema = z
  .url({ protocol: /^https?$/ })
  .refine((value) => new URL(value).origin === value, 'origin_without_path');

const csv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item).min(1));

/** `cloudinary://<api_key>:<api_secret>@<cloud_name>`, como la da el panel de Cloudinary. */
export const CLOUDINARY_URL = /^cloudinary:\/\/([^:@\s]+):([^@\s]+)@([a-z0-9_-]+)$/i;

/** Variable opcional: vacía en el .env cuenta como ausente. */
const optional = (schema: z.ZodString) =>
  z
    .string()
    .optional()
    .transform((value) => (value === '' ? undefined : value))
    .pipe(schema.optional());

export const EnvSchema = z
  .object({
    // Sin NODE_ENV vale production, lo más estricto: en Vercel no se carga a mano, porque con
    // NODE_ENV=production pnpm no instala las devDependencies y el build falla (ADR-018).
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DIRECT_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    // CORS y CSRF para la web en otro origen (local: :5180). En Vercel comparten origen (ADR-019)
    // y una request del mismo origen pasa sin estar en la lista.
    WEB_ORIGINS: csv(OriginSchema),
    // BE12: proxies delante de la API que agregan X-Forwarded-For (Vercel: 1, que deja solo la IP
    // del cliente). Con 0, la IP es la del socket; detrás de un proxy, todas las peticiones
    // compartirían el límite por IP.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    MIN_CONTRACT: z.coerce.number().int().min(1).default(1), // ARC6
    JWT_ACCESS_SECRET: z.string().min(32), // BE10
    ALLOWED_EMAILS: csv(EmailSchema), // ADR-007: registro cerrado
    // NOTIFICATIONS NT8: Web Push con VAPID. Fuera de producción son opcionales y, si faltan,
    // los avisos quedan registrados sin enviarse.
    VAPID_PUBLIC_KEY: optional(z.string().min(1)),
    VAPID_PRIVATE_KEY: optional(z.string().min(1)),
    VAPID_SUBJECT: optional(z.string().startsWith('mailto:')),
    // ADR-010, ARC8: `cloudinary://<api_key>:<api_secret>@<cloud_name>`; el secreto solo vive
    // aquí. Fuera de producción es opcional y, sin ella, la firma responde 503 y las imágenes
    // esperan sin subirse en el dispositivo que las tiene.
    CLOUDINARY_URL: optional(z.string().regex(CLOUDINARY_URL, 'cloudinary_url_format')),
    // QUALITY QA8: secreto de la ruta que consulta el monitor de disponibilidad. Fuera de
    // producción es opcional y, sin él, GET /health/checks/:token responde 404.
    HEALTH_CHECK_TOKEN: optional(z.string().min(32)),
    // LEARNING-DESIGN §8 y ADR-011: la IA es opcional en todo entorno (la captura manual
    // siempre existe). Sin clave, /ai/* responde 503 y la web lo dice sin culpa.
    OPENAI_API_KEY: optional(z.string().min(1)),
    OPENAI_MODEL: optional(z.string().min(1)),
    // LD17: cuota diaria por usuario, por día local de ella. Parámetros de costo, no de estudio.
    AI_DAILY_REQUESTS: z.coerce.number().int().positive().default(30),
    AI_DAILY_TOKENS: z.coerce.number().int().positive().default(200_000),
  })
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      (env.VAPID_PUBLIC_KEY !== undefined &&
        env.VAPID_PRIVATE_KEY !== undefined &&
        env.VAPID_SUBJECT !== undefined),
    { path: ['VAPID_PUBLIC_KEY'], message: 'vapid_required_in_production' },
  )
  .refine((env) => env.NODE_ENV !== 'production' || env.CLOUDINARY_URL !== undefined, {
    path: ['CLOUDINARY_URL'],
    message: 'cloudinary_required_in_production',
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.HEALTH_CHECK_TOKEN !== undefined, {
    path: ['HEALTH_CHECK_TOKEN'],
    message: 'health_check_token_required_in_production',
  })
  .refine((env) => (env.OPENAI_API_KEY === undefined) === (env.OPENAI_MODEL === undefined), {
    path: ['OPENAI_MODEL'],
    message: 'openai_key_and_model_together',
  });

export type Env = z.output<typeof EnvSchema>;

/** Para `ConfigModule.forRoot({ validate })`: devuelve el entorno ya transformado. */
export const validateEnv = (raw: Record<string, unknown>): Env => EnvSchema.parse(raw);
