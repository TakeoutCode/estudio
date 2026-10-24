# FRONTEND.md — apps/web (React + Vite PWA)

**Precedencia:** [STUDY-METHODS.md](STUDY-METHODS.md) gana sobre este documento. La lógica de estudio se llama desde `@estudio/srs` (ARCHITECTURE ARC2); la UI no la reimplementa. Diseño visual y textos en [UI-UX.md](UI-UX.md).

## 1. Estructura por features

```text
apps/web/src/
├─ app/          router (React Router 8, rutas lazy), providers, layout, error boundaries
├─ features/     study · timer · decks · notes · media · contrast · exercises · exams · plan · dashboard
│  │             sleep · ai-drafts · gamification · notifications · settings · backup · auth
│  └─ <feature>/ components/ hooks/ queries.ts commands.ts store.ts index.ts
├─ db/           schema.ts (versiones de Dexie), alive(), hlc local, outbox
├─ sync/         cliente push/pull, scheduler, Web Locks
├─ workers/      projection.worker.ts (replay, métricas, gamificación) vía Comlink
├─ ui/           componentes del sistema de diseño, sin lógica de features
├─ lib/          env.ts, i18n, cliente HTTP, media
└─ sw.ts         service worker (injectManifest)
```

**FE1 · DEBE** importar otra feature solo por su `index.ts`. `ui/` nunca importa de `features/`, y solo `queries.ts` (lecturas) y `commands.ts` (escrituras) tocan Dexie. *Razón:* hay un solo lugar donde garantizar el outbox y la exclusión de borrados.
```ts
// ❌ import { db } from '@/db'; await db.notes.update(id, { front });   // en un componente
// ✅ import { updateNote } from '@/features/notes';  await updateNote(id, { front });
```

## 2. Estado (Zustand) y datos (Dexie)

**FE2 · DEBE** usar Zustand solo para estado efímero: fase de la tarjeta (`prompt → attempted → revealed`), índice de la cola, modales, token de acceso en memoria y estado de sync. **NO DEBE** copiar datos de dominio a Zustand ni usar el middleware `persist`. *Razón:* una copia de lo que está en Dexie se desactualiza tras un pull, y lo persistente ya vive en Dexie o en `UserSettings`.
```ts
// ❌ useDeckStore.setState({ notes: await db.notes.toArray() });
// ✅ const notes = useLiveQuery(() => alive(db.notes.where('deckId').equals(deckId)).toArray(), [deckId]);
```

**FE3 · DEBE** hacer cada comando en una transacción de Dexie que escribe la entidad, avanza el HLC y agrega la entrada al outbox (SYNC SY2, SY6). *Razón:* una escritura sin outbox nunca llega a los otros dispositivos.
```ts
export async function renameDeck(id: DeckId, name: string) {
  await db.transaction('rw', [db.decks, db.outbox, db.meta], async () => {
    const hlc = await nextHlc();                                // tickHlc + persistir
    const row = DeckSchema.parse({ ...(await db.decks.get(id)), name, hlc, updatedAt: hlcWall(hlc) });
    await db.decks.put(row);
    await db.outbox.add({ mutationId: uuidv7(), op: 'upsert', entity: 'deck', row, createdAt: Date.now() });
  });
  syncScheduler.poke();
}
```

**FE4 · DEBE** ejecutar en `projection.worker.ts` el cálculo pesado: el `replay()` completo tras un pull o un cambio de `fsrs.requestRetention` (R2), la carga proyectada de Ajustes (LD8), las métricas y la gamificación. En el hilo principal solo va `applyReview()` de un paso, y `progressAfter()` sobre las respuestas de la sesión para las celebraciones (UI-UX UX10). *Razón:* recalcular miles de tarjetas bloquearía la sesión en el iPhone.
- `workers/projection-api.ts` tiene las funciones (se prueban sin Worker); `workers/projection.ts` crea el worker con Comlink y devuelve `null` donde no hay Worker, y entonces no se calcula.
- `ensureProjection()` (`sync/projection.ts`) revisa la proyección al guardar la configuración, tras un pull con cambios y al abrir la app. `meta.projectionSettings` guarda la `replaySettingsKey()` con que se armó `cardStates`; si difiere, `reprojectIfStale()` reconstruye todo en el worker y vuelve a proyectar en el hilo principal solo las tarjetas que cambiaron mientras tanto.

**FE5 · DEBE** leer el entorno solo en `lib/env.ts` con `WebEnvSchema`, que admite exactamente `VITE_API_URL`, `VITE_VAPID_PUBLIC_KEY` y `VITE_CLOUDINARY_CLOUD_NAME`. ESLint prohíbe `import.meta.env` fuera de ese archivo. *Razón:* todo `VITE_*` se publica en el bundle (AGENTS §5).

## 3. PWA y service worker

**FE6 · DEBE** usar `vite-plugin-pwa` con `strategies: 'injectManifest'` (el SW propio maneja `push` y `notificationclick`) y `registerType: 'prompt'`. **NO DEBE** activar una versión nueva (`skipWaiting`) mientras haya una sesión de estudio o un bloque del temporizador en curso. *Razón:* no cortar un intento de recuperación (R13). Si llega un `426` (ARC6), la sync se pausa, lo respondido sigue en Dexie y la actualización se aplica al terminar la sesión.
- Candado (`lib/session-lock.ts`): la sesión de estudio lo retiene desde que empieza hasta que ella la termina, también tras "Salir" (la cola y la tarjeta a medias viven solo en memoria), y el simulacro mientras está en pantalla (fuera de ella se retoma desde Dexie). El temporizador corre dentro de la sesión; si la app se reinicia, sigue por sus marcas de tiempo (FE11). Con el candado puesto, el aviso dice "Se actualizará al terminar la sesión" y, al soltarse, la actualización se aplica sola. Con un `426`, además se le pide al navegador que busque la versión nueva (`registration.update()`).
- Manifest: `id`, `start_url: '/'`, `scope: '/'`, `display: 'standalone'`, `theme_color`, íconos de 192 y 512 px (incluido uno `maskable`) y `apple-touch-icon`.
- Push: el SW **siempre** muestra la notificación que recibe (iOS revoca la suscripción ante pushes silenciosos; ver NOTIFICATIONS.md).

## 4. Estrategia offline

**FE7 · DEBE** funcionar sin red en todo el estudio: sesión, temporizador, simulacros, edición de contenido, dashboard, exportar respaldo. Lo que necesita red (IA, login, suscribirse a push, subir media) se muestra deshabilitado con el texto "Requiere conexión" y nunca como error. *Razón:* local-first; ella estudia donde no hay señal.
- Precaché del app shell; las navegaciones caen a `index.html`.
- Llamar a `navigator.storage.persist()` tras la primera sesión completa (al ver el resumen final) y mostrar `navigator.storage.estimate()` en Ajustes › Sincronización y almacenamiento, con un botón para pedir el guardado persistente si el navegador no lo concedió (`lib/storage.ts`).
- Ante `QuotaExceededError` se libera primero la caché de media (de lo menos usado a lo más usado). **NO DEBE** borrarse nunca nada de Dexie para hacer espacio.

## 5. Multimedia

**FE8 · DEBE** referenciar la media por `MediaAsset.id`, nunca por URL, y construir la URL de Cloudinary al mostrarla (`f_auto,q_auto,w_<px según DPR>`). *Razón:* un audio grabado sin red se muestra desde su blob local y, al subirse, solo cambia el `publicId` del asset.
```tsx
// ❌ <img src={note.imageUrl} />
// ✅ <MediaImage assetId={note.imageAssetId} width={360} alt={t('notes.imageAlt', { title })} />
```
- Guardar: la nota y su `MediaAsset` (con `publicId` y `version` en `null`) se escriben en la misma transacción, y los bytes quedan en `db.pendingUploads` (un `ArrayBuffer` y su tipo; no se sincroniza). Mientras están ahí, `MediaImage` muestra esa copia con una URL `blob:`.
- Subida: en cada vuelta de sync, después del push y el pull (el asset ya está en el servidor y los repasos salen primero, R3), `uploadPendingMedia()` pide `POST /media/signature` y hace `fetch` directo a Cloudinary. Al terminar escribe `publicId` y `version` (LWW, con outbox) y borra la copia. Sin red o con un 5xx se detiene sin error; un 404 de la firma (el asset todavía no llegó) espera a la próxima vuelta sin contar intento; un 4xx de Cloudinary suma un intento. El audio va con `resource_type: 'video'` (así lo clasifica Cloudinary).
- Grabación: `MediaRecorder` con `isTypeSupported` (en iOS da `audio/mp4`). El blob espera en `db.pendingUploads` hasta que haya red.
- Video: archivo subido o enlace (embed con `youtube-nocookie.com`). Los enlaces no funcionan sin red y la UI lo indica.
- Caché en tiempo de ejecución con `CacheFirst` (caché `media`) para `res.cloudinary.com`, solo respuestas CORS (`crossorigin="anonymous"`), con expiración y `purgeOnQuotaError`, y precarga de las imágenes de las tarjetas de la sesión (`usePrefetchCardImages`, hasta 40) al empezarla. Se piden pocos anchos fijos (`deliveryWidth()`: 400, 800, 1200 o 1600 px, con DPR hasta 2) para que la precarga y la tarjeta usen la misma URL.
- Límites en el cliente antes de pedir la firma: imagen 10 MB (`IMAGE_MAX_BYTES` en `shared`, que también valida `MediaAsset.bytes`), audio 20 MB, video 100 MB. Son límites técnicos, no umbrales de estudio.
- Sin `VITE_CLOUDINARY_CLOUD_NAME`, una imagen ya subida muestra un aviso en lugar de verse; la variable se lee al abrir la app, así que su falta no rompe el build.

## 6. Rendimiento

**FE9 · DEBE** cumplir estos presupuestos, medidos en CI con Lighthouse y `size-limit`. *Razón:* el uso principal es en iPhone, a menudo con mala señal.
- JS inicial ≤ 170 KB gzip; la ruta de estudio carga sin el editor. `apps/web/.size-limit.ts` mide en CI lo que se baja antes de ver Hoy (entrada, `boot` y la ruta inicial con sus importaciones estáticas, según el manifiesto de Vite). Hoy mide unos 269 kB: el límite está en 270 kB para que no crezca mientras se baja a 170 (deuda: React DOM, Dexie, zod y el catálogo i18n entran en el arranque). Lo que no hace falta para la primera pantalla va con `lazy` (la gamificación de Hoy, la IA de la sesión).
- INP ≤ 100 ms de calificar a ver la siguiente tarjeta en un iPhone de 2020 o posterior.
- Listas de más de 100 elementos virtualizadas (`@tanstack/react-virtual`).
- Imágenes con `loading="lazy"`, salvo la tarjeta actual y la siguiente (que se precarga).
- Texto enriquecido: TipTap cargado solo en las rutas de edición y guardado como JSON de ProseMirror. En estudio se usa un renderizador liviano. **NO DEBE** usarse `dangerouslySetInnerHTML` sin pasar por DOMPurify.

## 7. Sesión de estudio y temporizador

**FE10 · DEBE** montar la respuesta en el DOM solo en la fase `revealed`, después de un intento registrado. *Razón:* R1; ocultarla con CSS no basta, porque se puede leer y el lector de pantalla la anuncia.
```tsx
// ❌ <div className={phase === 'revealed' ? '' : 'hidden'}>{answer}</div>
// ✅ {phase === 'revealed' && <Answer card={card} explanation={card.explanation} />}   // R4
```

**FE11 · DEBE** calcular el tiempo restante con `remainingMs(timer, serverNow())` de `srs`. Un `requestAnimationFrame` o un intervalo de 1 s solo sirve para repintar, y se recalcula en `visibilitychange`. Al pasar a segundo plano durante un descanso se programa el aviso de fin de descanso (`PUT /notifications/break-end`), y al volver se cancela (NOTIFICATIONS.md). *Razón:* §3; iOS congela los timers en segundo plano.

**FE12 · DEBE** implementar los atajos en un único hook: `Espacio`/`Enter` revelan, `1`-`4` califican y `?` muestra la ayuda. Se ignoran con el foco en `input`, `textarea` o `contenteditable`, y ningún atajo salta el intento (R1). *Razón:* en la PC se estudia con teclado, y en "escribir respuesta" las teclas son texto.

**FE13 · DEBE** capturar errores con un error boundary por ruta, `window.onerror` y `unhandledrejection`, guardarlos en `db.diagnostics` (mensaje, stack, ruta y versión de la app; nunca contenido ni respuestas) y enviarlos a `POST /diagnostics/errors` cuando haya red, hasta 20 por día. *Razón:* sin un servicio externo de errores (ADR-016), así se ven los fallos que ella encuentra sin que tenga que reportarlos.
- Filtro (`redactErrorText` y `redactRoute` en `shared`, que la API vuelve a aplicar): todo lo citado en el mensaje o el stack se tapa (los errores de JS a veces citan el valor que falló), los ids pasan a `:id`, la ruta va sin búsqueda y un valor lanzado que no es `Error` deja solo su tipo. La versión es `CONTRACT_VERSION`.
- `db/diagnostics.ts` guarda hasta 50 (los más viejos se van) y el mismo error en la misma ruta una vez por minuto; `sync/diagnostics.ts` los envía al final de cada vuelta de sync, y un fallo al enviarlos no cambia el estado de la sync.

## 8. Checklist de revisión

- [ ] ¿Alguna importación de Dexie fuera de `queries.ts` o `commands.ts`, o entre features sin pasar por `index.ts` (FE1)?
- [ ] ¿Datos de dominio en Zustand, o algún uso de `persist` (FE2)?
- [ ] ¿Algún comando que escribe sin HLC y sin outbox (FE3)?
- [ ] ¿Algún `replay()` completo o métrica calculada en el hilo principal (FE4)?
- [ ] ¿Algún `import.meta.env` fuera de `lib/env.ts`, o una variable `VITE_*` nueva (FE5)?
- [ ] ¿Una actualización del SW puede activarse a mitad de una sesión (FE6)?
- [ ] ¿La feature funciona sin red, o muestra "Requiere conexión" en lugar de un error (FE7)?
- [ ] ¿La media se referencia por `assetId` (FE8)?
- [ ] ¿Se cumplen los presupuestos de `size-limit` y de INP (FE9)?
- [ ] ¿La respuesta está fuera del DOM antes del intento (FE10)?
- [ ] ¿El temporizador calcula con marcas de tiempo, sin acumular ticks (FE11)?
- [ ] ¿Los errores capturados excluyen contenido de estudio antes de guardarse (FE13)?
