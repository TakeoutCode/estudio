# QUALITY.md — Pruebas, CI, seguridad, privacidad, respaldos y observabilidad

**Precedencia:** [STUDY-METHODS.md](STUDY-METHODS.md) gana sobre este documento. Las pruebas de lógica de estudio se nombran con la regla que verifican (`R1:`, `P2:`, `§3b:`), para que una regla sin prueba se note.

## 1. Estrategia de pruebas

| Nivel | Herramienta | Alcance |
|---|---|---|
| Unitarias | Vitest + fast-check | `srs` (replay, planificador, temporizador, calificación, notificaciones, métricas, gamificación), `shared` (esquemas, HLC) |
| Integración api | Vitest + Testcontainers (Postgres 17) + fakes de `AiProvider`, `MediaPurger` y `PushSender` (`MediaSigner` es una firma local y corre real) | sync, auth, cron, triggers, migraciones, seeder |
| Integración web | Vitest + `fake-indexeddb` + Testing Library | comandos (entidad + outbox), migraciones de Dexie, fases de la sesión |
| E2E | Playwright: proyecto `iphone` (`devices['iPhone 13']`, WebKit) y `desktop` (Chromium) | flujos completos sin red y entre dos contextos (dos "dispositivos") |

**QA1 · DEBE** usar en `srs` el reloj falso de Vitest o un `now` explícito. **NO DEBE** haber `sleep` ni reloj real en ninguna prueba. *Razón:* determinismo (AGENTS AG3).

## 2. Máquina de estados del temporizador (§3, R7, R8, R13, R21)

**QA2 · DEBE** cubrir la tabla completa estado × evento (`idle`, `focus`, `paused`, `break_short`, `break_long`, `ended` × `start`, `pause`, `resume`, `tick`, `cardDone`, `extend`, `takeBreak`, `skipBreak`, `stop`, `takeover`): una transición inválida devuelve el mismo estado y un error tipado. `takeBreak` es cuando ella pide el descanso: el fin de bloque en flexible y libre, o aceptar la sugerencia de P5. Además, estas propiedades con fast-check. *Razón:* los errores aparecen con secuencias que nadie escribe a mano.
- `remainingMs ≥ 0` y `activeMs` no decrece, aun si el reloj del dispositivo retrocede.
- Una pausa mayor que `timer.pauseTimeoutMin` marca el bloque como `interrupted` y no completa el ciclo. Lo mismo un hueco mayor entre ticks, que significa que la app estuvo cerrada o en segundo plano (§3, "cierre de la app a mitad").
- En modo estructurado, el fin de bloque espera la tarjeta en curso hasta `timer.endOfBlockGraceSec` (60) (R13). En flexible, `extend` funciona una vez por bloque. En libre, solo registra.
- Hay descanso largo después de `cyclesBeforeLong` bloques completados.
```ts
it('§3: pausa > pauseTimeout marca interrumpido', () => {
  const cfg = StudyConfigSchema.parse({}).timer;
  const s = run(cfg, [start(0), pause(60_000), resume(60_000 + cfg.pauseTimeoutMin * 60_000 + 1)]);
  expect(s.lastBlock?.outcome).toBe('interrupted');
});
```

## 3. Planificador y umbrales (P1-P8, AGENTS AG4)

**QA3 · DEBE** probar cada regla P con los valores iniciales **y** con otro valor de su clave, demostrando que el comportamiento cambia. *Razón:* es la prueba de que el umbral no está escrito como literal.
```ts
it('P2: 0 nuevas si vencidas > factor × capacidad (usa la config)', () => {
  const input = scenario({ due: 25, capacity: 10 });
  expect(plan(input, cfgWith({ overdueFactorForZeroNew: 2 })).newCount).toBe(0);
  expect(plan(input, cfgWith({ overdueFactorForZeroNew: 3 })).newCount).toBeGreaterThan(0);
});
```
También son obligatorias: P1 (fórmula con tiempos de arranque y luego con medianas de su historial), P3 (ventana de 3 días y `leechLapses`), P4 (ninguna racha de más de 5 del mismo tema, salvo un set de contraste, LD10), P5, P6 (sugerir, nunca bloquear), P7 (mapeo de confianza y `affectsScheduling`) y P8 (reparto de 3 a 7 días en orden de retrievability). Para `replay()`: el mismo log en cualquier orden de llegada da el mismo estado.

## 4. Reglas de producto con prueba automática

| Regla | Prueba |
|---|---|
| R1 | E2E (`e2e/study.spec.ts`): antes de revelar, la respuesta no está en el DOM |
| R2 | Cambiar `requestRetention` cambia la carga proyectada |
| R3 | SY-T2 (`e2e/study.spec.ts`): cerrar la pestaña después de calificar no pierde el log; sin red, el repaso queda en el outbox y se envía al volver la red |
| R17, R19, R20 | `pnpm lint:copy` (UI-UX UX8) |
| R21 | Los minutos de una sesión con un hueco de 10 min suman solo hasta `metrics.inactivityCutoffSec` |
| §3 | NT-T1 a NT-T12 |
| §5 | Las métricas están ocultas con menos de `metrics.minReviewsToShow` repasos |
| Gamificación | Con `gamification.enabled = false`, ningún nodo con `data-gamification` en ninguna ruta (E2E, `e2e/gamification.spec.ts`); `Gamification.test.tsx` lo cubre también en la celebración de la sesión |
| UX4 | E2E (`e2e/a11y.spec.ts`): sin violaciones de axe (WCAG 2.2 AA) en claro y en oscuro, en las pantallas principales, un mazo, sus borradores de IA y el estudio |

## 5. CI (GitHub Actions)

**QA4 · DEBE** correr en cada PR, como checks obligatorios para fusionar a `main`, en este orden. *Razón:* AGENTS AG10; es la única barrera automática.
1. `pnpm install --frozen-lockfile` (con caché de pnpm y de Turbo).
2. `pnpm typecheck` y `pnpm lint`. Incluye `lint:copy`, los `no-restricted-imports` de ARC1 y `vitest/no-disabled-tests` y `no-focused-tests` como error, más `it.todo` y `test.todo` prohibidos con `no-restricted-properties`.
3. `pnpm test` con cobertura mínima: `srs` 90 % de líneas y ramas; módulos `sync` (api y web) 85 % de líneas y ramas (en la api, unitarias e integración juntas).
4. Integración de la api con Testcontainers (Docker de `ubuntu-latest`) y `prisma migrate deploy` desde cero.
5. `pnpm build`, `size-limit` y escaneo de `apps/web/dist` buscando `sk-`, `CLOUDINARY_API_SECRET` y `VAPID_PRIVATE`.
6. Playwright `iphone` y `desktop` (job `e2e`: un Postgres de servicio, y `playwright.config.ts` migra la base y levanta la api y la vista previa de la PWA), y Lighthouse sobre el preview de Vercel (pendiente: todavía no hay preview).
7. `gitleaks` y `pnpm audit --prod --audit-level high`.

Despliegue (ADR-018): un solo proyecto de Vercel con los servicios `web` y `api` y el daemon `scheduler` (`vercel.json`). Vercel crea un preview por PR con la web y la API; el daemon solo corre en producción, así que las previews no mandan avisos. El build de la API la compila y la empaqueta en un solo módulo ESM con sus dependencias (`apps/api/scripts/bundle-vercel.ts`), que Vercel usa tal cual: su runtime no permite `require()` de un módulo ESM, y varios paquetes CommonJS lo hacen con Nest 12. Ese servicio instala sin symlinks (`node-linker=hoisted`) para que `@node-rs/argon2`, nativo, quede junto a la función; `.vercelignore` evita que un `vercel deploy` suba `dist/` o los `.env` locales. En `main`, el build de la API aplica `prisma migrate deploy` antes de publicar (`apps/api/scripts/vercel-build.sh`); una migración que falla detiene el deploy. Las previews no migran: su base no debe ser la de producción.

## 6. Seguridad

**QA5 · DEBE** verificar con pruebas automáticas lo siguiente. *Razón:* BACKEND BE10-BE12 se rompen en silencio.
- CORS rechaza un origen fuera de `WEB_ORIGINS`.
- Reutilizar un refresh ya rotado revoca su familia.
- Login limitado a 5 por minuto.
- Un `userId` en el cuerpo se ignora.
- El trigger impide `UPDATE` y `DELETE` en `review_log`.
- La firma de Cloudinary fija `public_id = estudio/<userId>/<assetId>` y los formatos de imagen; no firma un asset de otra cuenta, borrado o que no llegó por push, y el handler rechaza un `MediaAsset` con otro `public_id` (`media.int.spec.ts`).

En la web, cabeceras de Vercel (servicio `web` en `vercel.json`): `Content-Security-Policy` con `default-src 'self'; img-src 'self' blob: data: https://res.cloudinary.com; media-src 'self' blob: https://res.cloudinary.com; connect-src 'self' https://api.cloudinary.com https://res.cloudinary.com; frame-src https://www.youtube-nocookie.com` (la API entra por `'self'`: está en el mismo origen, ADR-019) (`res.cloudinary.com` en `connect-src` porque el service worker descarga las imágenes para guardarlas, FRONTEND §5), además de `Referrer-Policy: strict-origin-when-cross-origin` y `Permissions-Policy` (micrófono solo `self`). Renovate actualiza dependencias semanalmente.

## 7. Privacidad

**QA6 · DEBE** cumplir: ninguna analítica de terceros ni rastreadores; logs y errores sin contenido de estudio; ningún servicio externo de errores (ADR-016): los errores del cliente llegan ya filtrados a `POST /diagnostics/errors` (FRONTEND FE13); `ai_usage` sin contenido. `DELETE /me` purga Postgres (con bypass del trigger) y la carpeta de Cloudinary, y una prueba de integración lo comprueba. *Razón:* son datos personales de una sola persona, y ella decide sobre ellos.
- `DELETE /me` pide la contraseña en el cuerpo (otra contraseña: `403`, para que la web no lo confunda con una sesión vencida) y tiene el límite del login. Borra primero la carpeta `estudio/<userId>/` de Cloudinary, fuera de la transacción (BE7): si falla responde `503` y Postgres queda intacto. Después, en una transacción con el lock del usuario, `SET LOCAL app.allow_purge = 'on'` y `DELETE FROM "user"`, que borra todo en cascada (`users.int.spec.ts`).
- En la web (Ajustes › Borrar tu cuenta, requiere conexión), solo si el servidor respondió `204` se vacían todas las tablas de Dexie y la caché `media` del service worker, y se cierra la sesión.

## 8. Respaldos

**QA7 · DEBE** mantener tres capas y probar la restauración. *Razón:* un respaldo que nunca se restauró no está probado.
- **Neon:** restauración a un punto en el tiempo según la retención del plan contratado (verificarla y anotarla aquí).
- **Volcado semanal:** el workflow `.github/workflows/backup.yml` (lunes 09:00 UTC) hace `pg_dump` con Postgres 17, lo restaura en un Postgres efímero y compara las filas de cada tabla (`.github/backup/row-counts.sql`; una tabla que cambió durante el volcado no se compara), lo cifra con `age` (la clave privada la guardas tú fuera de GitHub) y lo sube como artifact privado con 90 días de retención (ADR-017). Usa los secretos `BACKUP_DATABASE_URL` (la URL directa de Neon, mejor de solo lectura) y `BACKUP_AGE_RECIPIENT` (la clave pública). Además, cada mes se restaura uno en una rama de Neon y se compara el conteo de filas.
- **Respaldo de ella** (Ajustes › Respaldo, sin red): JSON `{ format: 'estudio-backup', version, exportedAt, userId, entities }` con todas las entidades vivas y todos los `ReviewLog` (`BackupSchema` en `shared`), más un CSV por tabla (`notes`, `cards`, `review_logs`, `exams`) para planillas, juntos en un `.zip` sin compresión (`lib/zip.ts`). Los CSV llevan BOM, fechas en su zona horaria y un `'` delante de lo que empieza con `=`, `+`, `-` o `@`, para que no se ejecute como fórmula. La media va como `publicId`. Las imágenes que aún no se suben no van en el respaldo: la sección lo avisa y se suben solas con conexión.
- **Importar:** se valida con zod (`parseBackup`; un respaldo de una versión más nueva se rechaza con su propio aviso) y se muestra qué trae antes de confirmar. Si es la misma cuenta, conserva los `id`; si es otra, se reasignan todos de forma consistente (las `Card` y `UserSettings` con su id determinista) y se omite lo que referencia algo que no vino; sus imágenes no se traen, porque son de otra carpeta. Cada fila LWW lleva un HLC nuevo, así que lo del respaldo reemplaza su versión actual; lo que no está en él se queda, y los `ReviewLog` que ya existían no se duplican. Un temporizador que no terminó no se revive. Siempre se genera un `deviceId` nuevo (SY-T4), todo entra por el outbox como cualquier escritura y la proyección de lo importado se rehace en la misma transacción.

## 9. Observabilidad

**QA8 · DEBE** exponer `GET /health` (ping a la base) y `GET /health/checks/:token`, que responde 503 con solo los nombres de los chequeos que fallan, sin datos. Un monitor de disponibilidad externo (por ejemplo UptimeRobot) consulta ambos cada 5 min y te avisa por correo. Un chequeo falla cuando:
- falla más del 5 % de los push de sync en una hora;
- el cron no corre en 15 min;
- la tasa de 410 en Web Push supera el 20 %;
- el gasto de IA del día pasa del 80 % de la cuota;
- el `p95` de `/sync/push` supera 1 s.
Logs JSON de pino en los logs de Vercel (función `api` y daemon `scheduler`) con `requestId`, incluidos los errores del cliente (FE13). En Hobby duran 1 h: lo que tiene que avisar más tarde va por estos chequeos. *Razón:* con una sola usuaria, un fallo de sync o de avisos puede pasar semanas sin que nadie lo note.
- Los nombres son `database`, `sync_push_errors`, `sync_push_slow`, `cron_stale`, `web_push_gone` y `ai_budget` (`HealthChecksSchema` en `shared`); con otro token (o sin `HEALTH_CHECK_TOKEN`, que es obligatorio solo en producción) la ruta responde 404.
- Las muestras viven en Postgres (`health_sample`; `HealthMetrics` y `HEALTH_LIMITS` en el módulo `health`) porque las escriben la función de la API y el daemon `scheduler`, que no comparten memoria (ADR-018). Un push de sync falla solo con un error del servidor (5xx), no con un 4xx del cliente; push y p95 se juzgan desde 20 envíos en la hora, la tasa de 410 en 24 h y desde 5 envíos, para que con una usuaria un fallo suelto no alarme. El cron cuenta como detenido si su último tick tiene más de 15 min o si nunca corrió; cada tick purga las muestras de más de 24 h.
- `ai_budget`: `AiService` mide tras cada pedido qué parte de la cuota del día de ella ya se usó (pedidos o tokens, lo que sea mayor) y el chequeo falla por encima de 80 %.

## 10. Checklist previo a producción

- [ ] Dominio propio en el proyecto de Vercel, con HTTPS: la web en `/` y la API en `/api` (ADR-019). Root Directory del proyecto vacío (la raíz del repo): los daemons no funcionan con un subdirectorio.
- [ ] Par de claves `age` generado y la privada guardada fuera de GitHub; secretos `BACKUP_DATABASE_URL` y `BACKUP_AGE_RECIPIENT` cargados y el workflow de respaldo corrido una vez a mano; `HEALTH_CHECK_TOKEN` cargado y el monitor configurado.
- [ ] Todas las variables de `EnvSchema` cargadas en Vercel para Production (las leen la función `api` y el daemon `scheduler`), sin `NODE_ENV` (la API asume `production`; cargarla hace que pnpm no instale las devDependencies y el build falla), con `TRUST_PROXY_HOPS=1` y `WEB_ORIGINS` con el dominio (plantilla: `.env.vercel`, que no se versiona); de las `VITE_*`, solo las 3, con `VITE_API_URL=/api`. Las de Preview, con una base que no sea la de producción.
- [ ] `ALLOWED_EMAILS` con su correo; registro abierto deshabilitado.
- [ ] Claves VAPID generadas y respaldadas (si se pierden, todas las suscripciones dejan de servir).
- [ ] `prisma migrate deploy` aplicado; trigger, secuencia e índices verificados en Neon.
- [ ] CI en verde con todos los checks de QA4 obligatorios.
- [ ] Prueba manual en iPhone: instalar, estudiar sin red, reconectar, recibir el recordatorio, temporizador en segundo plano.
- [ ] Restauración probada: Neon a un punto en el tiempo, volcado semanal y respaldo JSON.
- [ ] Alertas de QA8 activas y probadas una vez.
- [ ] Cuota de IA y `OPENAI_MODEL` definidos, con un presupuesto mensual anotado.
