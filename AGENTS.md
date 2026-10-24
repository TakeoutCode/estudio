# AGENTS.md — estudio

Guía para personas y agentes que modifican este repo. **Precedencia:** [docs/STUDY-METHODS.md](docs/STUDY-METHODS.md) gana sobre este y cualquier otro documento; si algo de aquí lo contradice, aplica STUDY-METHODS y se corrige este archivo. Las reglas de estudio se citan por número (R1-R22, P1-P8).

## 1. Mapa del monorepo

```text
estudio/
├─ apps/web          @estudio/web     React + TS + Vite (PWA), Tailwind, Zustand (estado UI), Dexie (datos locales)
├─ apps/api          @estudio/api     NestJS + Prisma + Postgres (Neon); en Vercel, función bajo /api y daemon del cron
├─ packages/shared   @estudio/shared  esquemas zod, tipos, contratos HTTP y sync, HLC, esquemas de configuración
├─ packages/srs      @estudio/srs     ts-fsrs, planificador (P1-P8), temporizador (§3), calificación, métricas,
│                                     gamificación, política de avisos: solo funciones puras
├─ packages/config   @estudio/config  tsconfig base, ESLint flat config, Prettier
└─ docs/             reglas del proyecto (ver §3)
```

Dependencias permitidas: `web → shared, srs` · `api → shared, srs` · `srs → shared, ts-fsrs` · `shared → zod, uuid`. Ningún paquete importa de `apps/*` y `web` nunca importa de `api`. Detalle y razones en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 2. Comandos

Requisitos: pnpm 10 (`corepack enable`) y Docker: Postgres local en el puerto 5433 (`pnpm db:up`) y Testcontainers en las pruebas de integración de la api. pnpm descarga Node 24 LTS solo para este repo (`useNodeVersion` en `pnpm-workspace.yaml`) y corre todos los scripts con él; `.nvmrc` dice lo mismo para CI y Vercel, y `Dockerfile.scheduler` usa la misma versión. Antes del primer `pnpm dev`: copia `apps/api/.env.example` a `.env` y `apps/web/.env.example` a `.env`.

| Tarea | Comando |
|---|---|
| Instalar | `pnpm install` |
| Base local | `pnpm db:up` y luego `pnpm db:migrate` |
| Datos de desarrollo | `pnpm db:seed`: mazo "Huesos del esqueleto" (206 huesos) en la cuenta de `SEED_EMAIL` o del primer correo de `ALLOWED_EMAILS`, que ya debe estar registrada. No pisa un mazo existente y no corre con `NODE_ENV=production` (LD16) |
| Desarrollo | `pnpm dev` (web :5180, api :3180 bajo `/api` y con el cron en el mismo proceso; puertos propios para no compartir origen con otros proyectos) · uno solo: `pnpm dev --filter @estudio/web` |
| Pruebas | `pnpm test` · un paquete: `pnpm test --filter @estudio/srs` · e2e: `pnpm test:e2e`, con un Postgres vacío en `E2E_DATABASE_URL` (ver `apps/web/playwright.config.ts`) |
| Calidad | `pnpm lint` (ESLint + `lint:copy`) · `pnpm typecheck` |
| Build | `pnpm build` |
| Prisma | dev: `pnpm db:migrate --name <cambio>` · cliente: `pnpm db:generate` · prod: `pnpm db:deploy`, solo desde el build de producción de Vercel (`apps/api/scripts/vercel-build.sh`) |

## 3. Qué leer antes de tocar cada área

| Área | Leer primero |
|---|---|
| Cualquier lógica de estudio: cola, calificación, FSRS, planificador, temporizador, métricas | **docs/STUDY-METHODS.md** → docs/LEARNING-DESIGN.md |
| `packages/srs` | STUDY-METHODS.md, LEARNING-DESIGN.md, QUALITY.md (pruebas de máquinas de estado) |
| Sync, esquema de Dexie, modelos Prisma sincronizables | SYNC.md |
| `apps/api` | BACKEND.md, ARCHITECTURE.md |
| `apps/web` | FRONTEND.md, UI-UX.md |
| Textos, métricas visibles, gamificación | UI-UX.md + STUDY-METHODS §5, R19, R20 |
| Notificaciones | NOTIFICATIONS.md + STUDY-METHODS §3, R12, R19 |
| IA | LEARNING-DESIGN.md (sección IA) + BACKEND.md (módulo `ai`) |
| Pruebas, CI, despliegue, respaldos | QUALITY.md |

## 4. Reglas

**AG1 · DEBE** usar TS `strict` + `noUncheckedIndexedAccess`; **NO DEBE** usar `any` ni `@ts-ignore` (sí `@ts-expect-error: <motivo>`). *Razón:* los contratos de sync y FSRS fallan en silencio con tipos laxos.

**AG2 · DEBE** validar con los esquemas zod de `@estudio/shared` todo dato que cruce un límite: HTTP, sync, lectura de IndexedDB tras migrar, respuesta de IA, importación de respaldo. *Razón:* una sola definición evita que cliente y servidor diverjan.
```ts
// ❌ const body = req.body as PushRequest;
// ✅ @Body(new ZodPipe(PushRequestSchema)) body: PushRequest
```

**AG3 · DEBE** mantener `@estudio/srs` puro: `now`, `config` e historial entran como parámetros; sin `Date.now()`, `Math.random()`, Dexie, `fetch` ni logs. *Razón:* pruebas deterministas, y reproducir el ReviewLog debe dar el mismo estado en todos los dispositivos (SYNC.md).
```ts
// ❌ export const remainingMs = (t: TimerState) => t.plannedMs - (Date.now() - t.startedAt);
// ✅ export const remainingMs = (t: TimerState, now: number) => t.plannedMs - activeMs(t, now);
```

**AG4 · DEBE** declarar cada umbral, sea de STUDY-METHODS (P1-P8, R21, §3, §5) o de diseño (ejercicios, avisos, gamificación), en un esquema de `packages/shared/src/config/` (`StudyConfig`, `NotificationPrefs`, `GamificationConfig`) con nombre, valor inicial, rango y comentario `// Pn · hipótesis` o `// diseño · sin evidencia`; **NO DEBE** escribir el número en la lógica. *Razón:* son hipótesis a calibrar con sus datos (§4, §6).
```ts
// ❌ srs:    if (due > capacity * 2) newCount = 0;
// ✅ shared: overdueFactorForZeroNew: z.number().min(1).max(5).default(2), // P2 · hipótesis
//    srs:    if (due > capacity * cfg.planner.overdueFactorForZeroNew) newCount = 0;
```

**AG5 · DEBE** pasar toda cadena visible (UI y notificaciones) por i18n, con el catálogo `es` como fuente; **NO DEBE** dejar literales en JSX ni en payloads push. *Razón:* i18n listo, y `lint:copy` revisa el tono (UI-UX.md).
```tsx
// ❌ <button>Mostrar respuesta</button>
// ✅ <button>{t('study.reveal')}</button>
```

**AG6 · DEBE** guardar instantes como epoch ms UTC y convertir a su zona horaria (`UserSettings.profile.timeZone`) solo en la UI y en el cron. *Razón:* "vencidas hoy" y horas silenciosas (R12) dependen de la zona de ella, no de la del servidor.

**AG7 · DEBE** generar en el cliente un UUIDv7 para toda entidad sincronizable. *Razón:* se crea offline y el push es idempotente por ID (SYNC.md).

**AG8 · DEBE** nombrar archivos en `kebab-case`, componentes en `PascalCase`, identificadores en inglés y textos de UI en español; exportaciones con nombre (default solo si la herramienta lo exige). *Razón:* búsquedas y refactors predecibles.

**AG9 · DEBE** usar Conventional Commits con scope de paquete o dominio: descripción en español, imperativo, ≤72 caracteres, un cambio lógico por commit y la migración en el mismo commit que el código que la usa. *Razón:* historial legible y `git bisect` útil.
```text
✅ feat(srs): limitar nuevas por sesión según presupuesto (P1)
✅ fix(sync): ignorar push duplicado con el mismo mutation_id
❌ cambios varios
```

**AG10 · NO DEBE** usar `--no-verify`, desactivar hooks ni fusionar con CI en rojo. *Razón:* hooks y CI son la única barrera automática para AG4 y §5.

## 5. Lo que NUNCA se hace

| Nunca | Razón |
|---|---|
| Poner secretos (OpenAI, `CLOUDINARY_API_SECRET`, VAPID privada, JWT, `DATABASE_URL`) en `apps/web` o en variables `VITE_*` | Todo `VITE_*` termina en el bundle público |
| Saltar, borrar o debilitar pruebas de sync (`.skip`, `.only` y `.todo` fallan en lint) | Un fallo de sync pierde repasos sin aviso (R3) |
| Escribir umbrales del planificador, temporizador, métricas o notificaciones como números sueltos | AG4; §4 los declara hipótesis |
| Presentar cualquier ritmo (25/5, 50/10, 52/17, 90/20…) como "científicamente óptimo", "ideal" o "el mejor" | R17; los presets son opciones (R7, R8) |
| Revelar la respuesta sin un intento registrado | R1 |
| Ofrecer releer, subrayar o resumir como modo principal o contarlo como repaso | R15 |
| Cuestionarios de estilos de aprendizaje; cifras de olvido o mejora sin fuente enlazada | R16, R20 |
| Contar como estudio el tiempo con la app abierta sin responder | R21 |
| Calcular el tiempo restante acumulando ticks de `setInterval` | §3: marcas de tiempo; iOS congela los timers en segundo plano |
| Actualizar o borrar filas de `ReviewLog`; borrar físicamente entidades sincronizadas | Log solo de inserción y `deleted_at` (SYNC.md) |
| Notificación de "racha en riesgo", más de 2 recordatorios al día, avisos en horas silenciosas o con culpa | §3, R12, R19 |
| Ranking, penalizaciones, XP por tiempo, racha que se rompe, cuentas regresivas de urgencia u otros patrones oscuros | R19, §5; la gamificación no está investigada (§6) y siempre se puede apagar |
| Llamar a OpenAI desde el cliente o guardar contenido de IA sin que ella lo revise | Clave solo en el servidor; borrador obligatorio (LEARNING-DESIGN.md) |
| `prisma db push` contra Neon o editar una migración ya aplicada | En producción solo `migrate deploy` desde el build de producción |
| Usar "atrasada", rojo de alarma o lenguaje de culpa para la carga | §5: "pendientes" |
| Cambiar STUDY-METHODS.md para que encaje con el código | Es la fuente de verdad; solo cambia por decisión explícita y con fuente |

## 6. Definición de "hecho"

- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde local y en CI.
- [ ] Lógica nueva en `srs` con pruebas de bordes: mínimo y máximo de cada clave de `StudyConfig` usada, `now` en cambio de día y de zona horaria.
- [ ] Cambio de esquema = migración Prisma + nueva versión de Dexie con `upgrade()` + prueba de migración con datos previos.
- [ ] Contrato nuevo = esquema zod en `shared` usado por web y api.
- [ ] Si toca lógica de estudio: el PR cita las R/P aplicadas y no contradice STUDY-METHODS.
- [ ] Textos en el catálogo `es` y `lint:copy` en verde.
- [ ] Probado en viewport 390×844 con WebKit, con teclado y sin red si es un flujo de estudio.
- [ ] Sin violaciones nuevas de axe.
- [ ] Docs al día si cambió un contrato, una regla o un valor inicial de `StudyConfig`.

## 7. Checklist de revisión

- [ ] ¿Algún número mágico en `srs`, planificador, temporizador o notificaciones? → `StudyConfig`.
- [ ] ¿`Date.now()`, `Math.random()` o I/O dentro de `packages/srs`?
- [ ] ¿Algún secreto, o un `VITE_*` fuera de la lista permitida (`VITE_API_URL`, `VITE_VAPID_PUBLIC_KEY`, `VITE_CLOUDINARY_CLOUD_NAME`)?
- [ ] ¿Alguna ruta que revele la respuesta sin intento (R1)?
- [ ] ¿Escrituras en `ReviewLog` que no sean `INSERT`? ¿`DELETE` físico de entidades sincronizadas?
- [ ] ¿Textos con "óptimo", "atrasada", "racha perdida", culpa o comparación con otras personas?
- [ ] ¿Algo de gamificación visible con `gamification.enabled = false`?
- [ ] ¿Pruebas de sync omitidas, debilitadas o con tiempo real en lugar de reloj falso?
- [ ] ¿El doc de `/docs` del área quedó al día?
