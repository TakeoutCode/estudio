# QUALITY.md — Pruebas, CI, seguridad, privacidad, respaldos y observabilidad

**Precedencia:** [STUDY-METHODS.md](STUDY-METHODS.md) gana sobre este documento. Las pruebas de lógica de estudio se nombran con la regla que verifican (`R1:`, `P2:`, `§3b:`), para que una regla sin prueba se note.

## 1. Estrategia de pruebas

| Nivel | Herramienta | Alcance |
|---|---|---|
| Unitarias | Vitest + fast-check | `srs` (replay, planificador, temporizador, calificación, notificaciones, métricas, gamificación), `shared` (esquemas, HLC) |
| Integración api | Vitest + Testcontainers (Postgres 17) + fakes de `AiProvider`, `MediaSigner` y `PushSender` | sync, auth, cron, triggers, migraciones, seeder |
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
También son obligatorias: P1 (fórmula con tiempos de arranque y luego con medianas de su historial), P3 (ventana de 3 días y `leechLapses`), P4 (ninguna racha de más de 5 del mismo tema), P5, P6 (sugerir, nunca bloquear), P7 (mapeo de confianza y `affectsScheduling`) y P8 (reparto de 3 a 7 días en orden de retrievability). Para `replay()`: el mismo log en cualquier orden de llegada da el mismo estado.

## 4. Reglas de producto con prueba automática

| Regla | Prueba |
|---|---|
| R1 | E2E: antes de revelar, la respuesta no está en el DOM |
| R2 | Cambiar `requestRetention` cambia la carga proyectada |
| R3 | SY-T2: cerrar la pestaña después de calificar no pierde el log |
| R17, R19, R20 | `pnpm lint:copy` (UI-UX UX8) |
| R21 | Los minutos de una sesión con un hueco de 10 min suman solo hasta `metrics.inactivityCutoffSec` |
| §3 | NT-T1 a NT-T12 |
| §5 | Las métricas están ocultas con menos de `metrics.minReviewsToShow` repasos |
| Gamificación | Con `gamification.enabled = false`, ningún nodo con `data-gamification` en ninguna ruta (E2E) |

## 5. CI (GitHub Actions)

**QA4 · DEBE** correr en cada PR, como checks obligatorios para fusionar a `main`, en este orden. *Razón:* AGENTS AG10; es la única barrera automática.
1. `pnpm install --frozen-lockfile` (con caché de pnpm y de Turbo).
2. `pnpm typecheck` y `pnpm lint`. Incluye `lint:copy`, los `no-restricted-imports` de ARC1 y `vitest/no-disabled-tests` y `no-focused-tests` como error, más `it.todo` y `test.todo` prohibidos con `no-restricted-properties`.
3. `pnpm test` con cobertura mínima: `srs` 90 % de líneas y ramas; módulos `sync` (api y web) 85 %.
4. Integración de la api con Testcontainers (Docker de `ubuntu-latest`) y `prisma migrate deploy` desde cero.
5. `pnpm build`, `size-limit` y escaneo de `apps/web/dist` buscando `sk-`, `CLOUDINARY_API_SECRET` y `VAPID_PRIVATE`.
6. Playwright `iphone` y `desktop`, y Lighthouse sobre el preview de Vercel.
7. `gitleaks` y `pnpm audit --prod --audit-level high`.

Despliegue: Vercel crea un preview por PR. Railway despliega desde `main` con `prisma migrate deploy` antes del arranque. Una migración que falla detiene el deploy.

## 6. Seguridad

**QA5 · DEBE** verificar con pruebas automáticas lo siguiente. *Razón:* BACKEND BE10-BE12 se rompen en silencio.
- CORS rechaza un origen fuera de `WEB_ORIGINS`.
- Reutilizar un refresh ya rotado revoca su familia.
- Login limitado a 5 por minuto.
- Un `userId` en el cuerpo se ignora.
- El trigger impide `UPDATE` y `DELETE` en `review_log`.
- La firma de Cloudinary fija `public_id = estudio/<userId>/<assetId>` y los formatos de imagen; no firma un asset de otra cuenta, borrado o que no llegó por push, y el handler rechaza un `MediaAsset` con otro `public_id` (`media.int.spec.ts`).

En la web, cabeceras de Vercel: `Content-Security-Policy` con `default-src 'self'; img-src 'self' blob: data: https://res.cloudinary.com; media-src 'self' blob: https://res.cloudinary.com; connect-src 'self' https://api.<dominio> https://api.cloudinary.com https://res.cloudinary.com; frame-src https://www.youtube-nocookie.com` (`res.cloudinary.com` en `connect-src` porque el service worker descarga las imágenes para guardarlas, FRONTEND §5), además de `Referrer-Policy: strict-origin-when-cross-origin` y `Permissions-Policy` (micrófono solo `self`). Renovate actualiza dependencias semanalmente.

## 7. Privacidad

**QA6 · DEBE** cumplir: ninguna analítica de terceros ni rastreadores; logs y errores sin contenido de estudio; ningún servicio externo de errores (ADR-016): los errores del cliente llegan ya filtrados a `POST /diagnostics/errors` (FRONTEND FE13); `ai_usage` sin contenido. `DELETE /me` purga Postgres (con bypass del trigger) y la carpeta de Cloudinary, y una prueba de integración lo comprueba. *Razón:* son datos personales de una sola persona, y ella decide sobre ellos.

## 8. Respaldos

**QA7 · DEBE** mantener tres capas y probar la restauración. *Razón:* un respaldo que nunca se restauró no está probado.
- **Neon:** restauración a un punto en el tiempo según la retención del plan contratado (verificarla y anotarla aquí).
- **Volcado semanal:** un workflow programado de GitHub Actions hace `pg_dump`, lo cifra con `age` (la clave privada la guardas tú fuera de GitHub) y lo sube como artifact privado con 90 días de retención (ADR-017). Cada mes se restaura en una rama de Neon y se compara el conteo de filas.
- **Respaldo de ella** (Ajustes › Respaldo, sin red): JSON `{ format: 'estudio-backup', version, exportedAt, userId, entities }` con todas las entidades vivas y todos los `ReviewLog`, más un CSV por tabla (`notes`, `cards`, `review_logs`, `exams`) para planillas. La media va como `publicId`; los blobs sin subir van en un `.zip` opcional.
- **Importar:** se valida con zod. Si es la misma cuenta, conserva los `id`; si es otra, se reasignan todos de forma consistente. Siempre se genera un `deviceId` nuevo (SY-T4), y entra por el outbox como cualquier escritura.

## 9. Observabilidad

**QA8 · DEBE** exponer `GET /health` (ping a la base) y `GET /health/checks/:token`, que responde 503 con solo los nombres de los chequeos que fallan, sin datos. Un monitor de disponibilidad externo (por ejemplo UptimeRobot) consulta ambos cada 5 min y te avisa por correo. Un chequeo falla cuando:
- falla más del 5 % de los push de sync en una hora;
- el cron no corre en 15 min;
- la tasa de 410 en Web Push supera el 20 %;
- el gasto de IA del día pasa del 80 % de la cuota;
- el `p95` de `/sync/push` supera 1 s.
Logs JSON de pino en Railway con `requestId`, incluidos los errores del cliente (FE13). *Razón:* con una sola usuaria, un fallo de sync o de avisos puede pasar semanas sin que nadie lo note.

## 10. Checklist previo a producción

- [ ] Dominio propio configurado: `app.<dominio>` en Vercel y `api.<dominio>` en Railway, con HTTPS (ADR-015).
- [ ] Par de claves `age` generado y la privada guardada fuera de GitHub; `HEALTH_CHECK_TOKEN` cargado y el monitor configurado.
- [ ] Todas las variables de `EnvSchema` cargadas en Railway, y solo las 3 `VITE_*` en Vercel.
- [ ] `ALLOWED_EMAILS` con su correo; registro abierto deshabilitado.
- [ ] Claves VAPID generadas y respaldadas (si se pierden, todas las suscripciones dejan de servir).
- [ ] `prisma migrate deploy` aplicado; trigger, secuencia e índices verificados en Neon.
- [ ] CI en verde con todos los checks de QA4 obligatorios.
- [ ] Prueba manual en iPhone: instalar, estudiar sin red, reconectar, recibir el recordatorio, temporizador en segundo plano.
- [ ] Restauración probada: Neon a un punto en el tiempo, volcado semanal y respaldo JSON.
- [ ] Alertas de QA8 activas y probadas una vez.
- [ ] Cuota de IA y `OPENAI_MODEL` definidos, con un presupuesto mensual anotado.
