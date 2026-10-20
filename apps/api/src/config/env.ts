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

/** Variable opcional: vacía en el .env cuenta como ausente. */
const optional = (schema: z.ZodString) =>
  z
    .string()
    .optional()
    .transform((value) => (value === '' ? undefined : value))
    .pipe(schema.optional());

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DIRECT_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    WEB_ORIGINS: csv(OriginSchema),
    MIN_CONTRACT: z.coerce.number().int().min(1).default(1), // ARC6
    JWT_ACCESS_SECRET: z.string().min(32), // BE10
    ALLOWED_EMAILS: csv(EmailSchema), // ADR-007: registro cerrado
    // NOTIFICATIONS NT8: Web Push con VAPID. Fuera de producción son opcionales y, si faltan,
    // los avisos quedan registrados sin enviarse.
    VAPID_PUBLIC_KEY: optional(z.string().min(1)),
    VAPID_PRIVATE_KEY: optional(z.string().min(1)),
    VAPID_SUBJECT: optional(z.string().startsWith('mailto:')),
  })
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      (env.VAPID_PUBLIC_KEY !== undefined &&
        env.VAPID_PRIVATE_KEY !== undefined &&
        env.VAPID_SUBJECT !== undefined),
    { path: ['VAPID_PUBLIC_KEY'], message: 'vapid_required_in_production' },
  );

export type Env = z.output<typeof EnvSchema>;

/** Para `ConfigModule.forRoot({ validate })`: devuelve el entorno ya transformado. */
export const validateEnv = (raw: Record<string, unknown>): Env => EnvSchema.parse(raw);
