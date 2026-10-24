# BACKEND.md — apps/api (NestJS)

**Precedencia:** [STUDY-METHODS.md](STUDY-METHODS.md) gana sobre este documento. La API no decide nada de estudio: esa lógica vive en `@estudio/srs` (ARCHITECTURE ARC2). Aquí van orquestación, persistencia y seguridad. El protocolo de sync está en [SYNC.md](SYNC.md).

## 1. Módulos por dominio

| Módulo | Responsabilidad | HTTP | Handlers de sync |
|---|---|---|---|
| `auth` | registro por lista permitida, login, refresh rotativo, logout | `POST /auth/{register,login,refresh,logout}` | — |
| `users` | cuenta, ajustes por sección, borrado total (pide la contraseña; QUALITY QA6) | `DELETE /me` | `UserSettings` |
| `sync` | push/pull, idempotencia, cursor, registro de handlers, proyecciones (`replay`), purga diaria de borrados (SYNC §6) | `POST /sync/push`, `GET /sync/pull` | — |
| `decks` | mazos, subtemas, etiquetas, notas (también los ejercicios), tarjetas, grupos de contraste | — | `Deck`, `Topic`, `Tag`, `Note`, `Card`, `ContrastGroup` |
| `study` | repasos, sesiones, temporizador, autoexplicaciones, premios, sueño | — | `ReviewLog`, `StudySession`, `TimerSession`, `TimerBlockLog`, `SelfExplanation`, `Reward`, `RewardRedemption`, `SleepLog` |
| `exams` | exámenes y su alcance (un simulacro es una `StudySession` con `mode: 'exam'`) | — | `Exam` |
| `exercises` | ejercicios de aplicación: son notas (LD §2) y viajan con el handler `Note` de `decks`; el módulo queda para lo que no es sync (borradores de casos clínicos con IA, con la cuota y el reintento de `AiService`) | `POST /ai/clinical-cases` | — |
| `ai` | borradores, distractores y retroalimentación, cuota diaria (`ai_usage`) | `POST /ai/drafts`, `POST /ai/distractors`, `POST /ai/feedback` | `AiDraft`, `AiFeedback` |
| `media` | firma de subida; la imagen de un asset borrado se borra de Cloudinary antes de purgarlo (SYNC §6) | `POST /media/signature` | `MediaAsset` |
| `notifications` | suscripciones, cron, envíos programados | `POST/DELETE /push/subscriptions`, `POST /notifications/:id/opened`, `PUT/DELETE /notifications/break-end`, `GET /notifications/state`, `POST /notifications/backoff` | — |
| `health` | ping a la base, chequeos para alertas, errores del cliente (ADR-016) | `GET /health`, `GET /health/checks/:token`, `POST /diagnostics/errors` | — |

`users`, `study` y `health` se suman a los 8 módulos pedidos porque sus entidades no pertenecen a ninguno de ellos. Casi todo el CRUD de contenido entra por `/sync/push`, no por REST (local-first).

```text
src/modules/decks/
  decks.module.ts
  note.sync-handler.ts   # @SyncHandler('note'): esquema, referencias, upsert LWW
  decks.service.ts
  decks.repository.ts    # el único archivo del módulo que usa Prisma
```

`src/seed/` no es un módulo de Nest: es el mazo de desarrollo que carga `pnpm db:seed` desde `prisma/seed.ts`. Usa Prisma directo, escribe como indica SYNC §3 (Escrituras propias del servidor) y queda fuera del build (`tsconfig.build.json`).

## 2. Capas

**BE1 · DEBE** seguir controller → service → repository. El controller solo traduce HTTP (pipes, guards, `@CurrentUser`), el service aplica reglas y transacciones y el repository es el único que toca Prisma. **NO DEBE** un controller inyectar `PrismaService` ni un repository lanzar `HttpException`. *Razón:* reglas que se prueban sin HTTP y sin base.
```ts
// ❌ @Post() create(@Body() b: any) { return this.prisma.deck.create({ data: b }); }
// ✅
@Post('push')
push(@CurrentUser() user: AuthUser, @Body(new ZodPipe(PushRequestSchema)) body: PushRequest) {
  return this.sync.push(user.id, body);
}
```

**BE2 · DEBE** registrar cada entidad sincronizable con `@SyncHandler('<entity>')`, descubierto por `DiscoveryService`. *Razón:* así `sync` no importa los módulos de dominio (sin ciclos) y cada dominio valida sus propias invariantes.
```ts
@SyncHandler('note')
export class NoteSyncHandler implements LwwHandler<Note> {
  readonly schema = NoteSchema;
  constructor(private readonly repo: DecksRepository) {}
  // Dentro de la transacción y antes de registrar la mutación: un rechazo nunca vuelve como `duplicate`.
  async refs(userId: UserId, row: Note) { return (await this.repo.owns('deck', userId, row.deckId)) ? null : 'not_found'; }
  upsert(userId: UserId, row: Note) { return this.repo.upsertNoteLww(userId, row); } // upsertLwwSql (SYNC.md §3)
}
```

## 3. Validación, configuración y errores

**BE3 · DEBE** validar cuerpo y query con `ZodPipe` y los esquemas de `@estudio/shared`. **NO DEBE** usar class-validator ni DTOs duplicados (ADR-012). En `NODE_ENV=test`, un interceptor valida también cada respuesta contra su esquema. *Razón:* un solo contrato.
```ts
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}
  transform(value: unknown): z.output<S> {
    const r = this.schema.safeParse(value);
    if (!r.success) throw new DomainError('validation_failed', { issues: r.error.issues });
    return r.data;
  }
}
```

**BE4 · DEBE** parsear el entorno con zod al arrancar y fallar si falta algo. **NO DEBE** leer `process.env` fuera de `src/config/` (ESLint `n/no-process-env`). *Razón:* un secreto ausente debe romper el deploy, no la primera petición.
```ts
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.url(), DIRECT_DATABASE_URL: z.url(),          // pooler / directa (migraciones)
  JWT_ACCESS_SECRET: z.string().min(32), HEALTH_CHECK_TOKEN: z.string().min(32),
  WEB_ORIGINS: z.string().transform((s) => s.split(',')),
  ALLOWED_EMAILS: z.string().transform((s) => s.split(',').map((e) => e.trim().toLowerCase())),
  OPENAI_API_KEY: z.string().min(1), OPENAI_MODEL: z.string().min(1),
  AI_DAILY_REQUESTS: z.coerce.number().int().positive(), AI_DAILY_TOKENS: z.coerce.number().int().positive(),
  CLOUDINARY_URL: z.string().regex(CLOUDINARY_URL),             // obligatoria solo en producción (ADR-010)
  VAPID_PUBLIC_KEY: z.string().min(1), VAPID_PRIVATE_KEY: z.string().min(1), VAPID_SUBJECT: z.string().startsWith('mailto:'),
});
ConfigModule.forRoot({ isGlobal: true, validate: (env) => EnvSchema.parse(env) });
```
`OPENAI_API_KEY` y `OPENAI_MODEL` son opcionales en todo entorno y van juntas: la IA es opcional (LEARNING-DESIGN §8) y, sin ellas, `/ai/*` responde 503. `AI_DAILY_REQUESTS` y `AI_DAILY_TOKENS` tienen valores iniciales (30 y 200 000) y se ajustan según el presupuesto (QUALITY §10). `CLOUDINARY_URL`, las claves VAPID y `HEALTH_CHECK_TOKEN` son obligatorias solo en producción.

Fuera de `src/config/` leen `process.env` solo `src/test/`, que fija el entorno antes de importar `ConfigModule`, y los scripts que corre la CLI de Prisma sin Nest (`prisma.config.ts`, `prisma/seed.ts`); el override de `eslint.config.js` los nombra. `SEED_EMAIL` la lee solo el seeder y no va en `EnvSchema`.

**BE5 · DEBE** lanzar `DomainError(code)` en los services y traducirlo en un filtro global a `application/problem+json` con un `code` estable de `ApiErrorCode` (shared), más `requestId`, sin stack en producción. *Razón:* el cliente traduce `code` a una clave i18n (AGENTS AG5); el texto del servidor nunca llega a la UI.

**BE6 · DEBE** loguear con `nestjs-pino` en JSON con `requestId`, `userId`, ruta, estado y duración. **NO DEBE** loguear contenido de estudio, filas de sync, prompts ni respuestas de IA. *Razón:* son datos personales de ella; para depurar bastan `entity`, `mutationId` y `status`.
```ts
LoggerModule.forRoot({ pinoHttp: { redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body', 'res.body'] } });
```

## 4. Datos y transacciones

**BE7 · DEBE** usar `@nestjs-cls/transactional` con el adaptador de Prisma y marcar con `@Transactional()` todo método de service que escriba más de una tabla. El push corre en una sola transacción que empieza con `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))` sobre el `userId`. **NO DEBE** llamar a OpenAI, Cloudinary ni servicios push dentro de una transacción. *Razón:* el lock serializa `server_seq` por usuario (ADR-005), y esperar a terceros con la transacción abierta retiene conexiones del pooler.

**BE8 · DEBE** usar Prisma Migrate con cambios en dos fases para lo destructivo (expandir → desplegar → contraer). Lo que Prisma no modela se agrega a mano en el SQL de la migración: la secuencia `sync_seq`, el trigger de solo inserción de `review_log` (que permite borrar solo con `SET LOCAL app.allow_purge = 'on'`, usado por `DELETE /me`) y los índices. **NO DEBE** usar `db push` ni editar migraciones ya aplicadas. *Razón:* una PWA vieja sigue enviando la forma anterior hasta que se actualiza (ARC6).
```prisma
model Note {
  id        String  @id @db.Uuid
  userId    String  @map("user_id") @db.Uuid
  deckId    String  @map("deck_id") @db.Uuid    // sin FK: lo valida el handler (BE2)
  kind      NoteKind
  content   Json
  hlc       String
  updatedAt BigInt  @map("updated_at")
  deletedAt BigInt? @map("deleted_at")
  serverSeq BigInt  @map("server_seq")      // sin DEFAULT: nextval('sync_seq') en cada escritura
  user      User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, serverSeq])
  @@map("note")
}
```
Solo hay FK hacia `User`. Entre entidades sincronizables no hay FK porque un lote puede traer al hijo antes que al padre; las referencias las verifica el handler, aunque el padre tenga `deletedAt`.

**BE9 · DEBE** escribir SQL crudo solo con `$queryRaw`/`$executeRaw` como plantilla o con `Prisma.sql`; los identificadores salen de constantes del código y pasan por `ident()`. **NO DEBE** usar `$queryRawUnsafe` ni `$executeRawUnsafe`, ni siquiera en pruebas. **NO DEBE** declarar `@default(dbgenerated("nextval('sync_seq')"))`: Prisma cree que la secuencia es suya y propone `DROP SEQUENCE` en cada diff. *Razón:* inyección SQL, y no perder la secuencia global de sync.

## 5. Seguridad y límites

**BE10 · DEBE** implementar la autenticación así. *Razón:* es una sola cuenta con datos personales y entra desde un iPhone que bloquea cookies de terceros.
- Contraseñas con argon2id `{ memoryCost: 19456, timeCost: 2, parallelism: 1 }` (mínimo de OWASP).
- Registro solo si el correo está en `ALLOWED_EMAILS` (ADR-007), con la misma respuesta exista o no la cuenta.
- Access JWT HS256 de 15 min con `iss` y `aud`, guardado solo en memoria del cliente.
- Refresh opaco de 256 bits, guardado como SHA-256 y rotado en cada uso. Reutilizar uno ya rotado revoca toda su familia (la sesión de ese dispositivo).
- Cookie del refresh: `HttpOnly; Secure; SameSite=Lax; Path=/auth` (`Secure` solo en producción: en desarrollo la API corre en http://localhost), sin atributo `Domain` (queda solo en `api.<dominio>`). La web vive en `app.<dominio>` y la API en `api.<dominio>`, el mismo sitio, porque Safari bloquea las cookies de terceros (ADR-015).

**BE11 · DEBE** aplicar un `JwtAuthGuard` global con `@Public()` explícito y tomar el `userId` solo del token. **NO DEBE** aceptar `userId` en el cuerpo ni en la query. *Razón:* evita leer o escribir datos de otra cuenta (ADR-007).
```ts
// ❌ this.sync.push(body.userId, body);
// ✅ this.sync.push(user.id, body);            // user = @CurrentUser()
```

**BE12 · DEBE** usar las cabeceras de seguridad nativas de Nest 12 (`app.useSecurityHeaders()`, mismos valores que helmet 8), `app.enableCsrfProtection({ trustedOrigins: WEB_ORIGINS })`, CORS con la lista exacta de `WEB_ORIGINS` y `credentials: true`, un límite de cuerpo (1 MB, 2 MB en `/sync/push`) y `@nestjs/throttler` global (login y registro: 5/min por IP y, además, 10 cada 15 min por correo con `EmailThrottleGuard`, para que repartir intentos entre IP no sirva). Detrás del proxy de Railway, `TRUST_PROXY_HOPS=1` hace que la IP sea la que agrega el proxy al final de `X-Forwarded-For` (lo que el cliente escribe antes no cuenta); sin eso, todas las peticiones compartirían un solo límite. La cuota de IA se cuenta en la tabla `ai_usage` por día local de ella, no con throttler. *Razón:* el throttler en memoria se reinicia con cada deploy.

**BE13 · DEBE** poner a los terceros detrás de puertos (`AiProvider`, `MediaSigner`, `MediaPurger`, `PushSender`), cada uno con implementación real y una falsa para pruebas, con timeouts explícitos (IA 30 s, push 10 s, Cloudinary 10 s) y reintentos solo ante 429/5xx con backoff. *Razón:* pruebas de integración sin red y sin costo.

**BE14 · DEBE** correr el cron y los envíos programados con `@nestjs/schedule` bajo advisory lock (ARC7) y pasar `now` explícito a `srs`. *Razón:* un redeploy solapado no debe duplicar avisos (§3). Detalle en NOTIFICATIONS.md.

## 6. Checklist de revisión

- [ ] ¿Algún controller con Prisma, o algún repository que lance `HttpException` (BE1)?
- [ ] ¿La entidad nueva tiene `@SyncHandler`, valida referencias y tiene sus columnas de sync e índice `(user_id, server_seq)` (BE2, BE8)?
- [ ] ¿Toda entrada pasa por `ZodPipe` con un esquema de `shared` (BE3)?
- [ ] ¿Algún `process.env` fuera de `config/`, o una variable nueva sin agregar a `EnvSchema` (BE4)?
- [ ] ¿Errores con `code` de `ApiErrorCode` y logs sin contenido de ella (BE5, BE6)?
- [ ] ¿Alguna llamada a un tercero dentro de `@Transactional()` (BE7)?
- [ ] ¿La migración es reversible en dos fases y conserva trigger, secuencia e índices (BE8)?
- [ ] ¿Algún `$queryRawUnsafe` (BE9)?
- [ ] ¿Algún `userId` leído del cliente (BE11)?
- [ ] ¿Algún tercero sin puerto, timeout o fake (BE13)?
