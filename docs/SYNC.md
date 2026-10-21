# SYNC.md — Protocolo de sincronización

**Precedencia:** [STUDY-METHODS.md](STUDY-METHODS.md) gana sobre este documento. Aplica R3 (cada repaso se guarda al responder), §3 (el estado del temporizador vive en local y en el servidor) y R21. Decisiones de base: ADR-003 a ADR-006 en [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Estrategia por entidad

**SY1 · DEBE** declarar la estrategia de cada entidad en `ENTITY_STRATEGY` (shared). Cliente y handler leen ese mismo mapa. *Razón:* una entidad sin estrategia declarada se sincroniza de forma distinta en cada lado.

| Estrategia | Entidades | Regla |
|---|---|---|
| LWW por HLC | `Deck`, `Topic`, `Tag`, `Note`, `Card`, `Exercise`, `Exam`, `ContrastGroup`, `MediaAsset`, `UserSettings`, `StudySession`, `TimerSession`, `SelfExplanation`, `AiDraft`, `Reward`, `SleepLog` | Gana la fila con `hlc` mayor; borrar = escribir `deletedAt` |
| Solo inserción | `ReviewLog`, `TimerBlockLog`, `RewardRedemption`, `AiFeedback` | `INSERT … ON CONFLICT (id) DO NOTHING`; un trigger impide `UPDATE` y `DELETE` |
| Proyección (no viaja) | `cardStates`, XP y monedas, métricas | Se recalcula con `srs` a partir de las anteriores (ARC5) |

Columnas comunes: `id` (UUIDv7 del cliente), `userId` (lo pone el servidor desde el JWT), `hlc`, `updatedAt` (ms, la parte de reloj del HLC), `deletedAt` (ms o null) y `serverSeq` (solo en el servidor). `UserSettings` es una fila por sección (`profile`, `study`, `notifications`, `gamification`, `ui`) con `id = uuidv5(userId, sección)`, para que editar la retención en el iPhone y la hora del recordatorio en la PC no choquen. Por la misma razón, cada `Card` tiene `id = uuidv5(noteId, ordinal)` (`cardIdFor`): dos dispositivos sin red que activan la inversa de la misma nota escriben la misma fila en lugar de duplicarla. Estas dos y las filas que el servidor crea fuera de un push (§3) son las excepciones a AGENTS AG7.

## 2. Reloj lógico híbrido (HLC)

**SY2 · DEBE** avanzar el HLC con `tickHlc` en cada escritura local y con `receiveHlc` al aplicar cada fila remota, y comparar en SQL con `COLLATE "C"`. *Razón:* los relojes del iPhone y de la PC se desfasan (ADR-004), y con otra intercalación de texto el orden no es byte a byte.
```ts
// packages/shared/src/sync/hlc.ts — puro, `now` inyectado
export const encodeHlc = ({ wall, counter, node }: Hlc) =>
  `${wall.toString().padStart(13, '0')}:${counter.toString(36).padStart(4, '0')}:${node}`;
export const tickHlc = (last: Hlc, now: number): Hlc =>
  now > last.wall ? { wall: now, counter: 0, node: last.node } : { ...last, counter: last.counter + 1 };
```
`node` es el `deviceId` (un UUID, de ancho fijo); el servidor usa el UUID nil para sus propias escrituras.

## 3. Push (idempotente)

```ts
export const MutationSchema = z.object({
  mutationId: z.uuid(), op: z.enum(['upsert', 'append']), entity: EntityNameSchema,
  row: z.record(z.string(), z.unknown()),            // segunda validación: esquema del handler
});
export const PushRequestSchema = z.object({ deviceId: z.uuid(), mutations: z.array(MutationSchema).min(1).max(200) });
export const PushResultSchema = z.object({
  mutationId: z.uuid(), status: z.enum(['applied', 'duplicate', 'stale', 'rejected']), code: ApiErrorCodeSchema.optional(),
});
```
1. Validar el sobre y cada `row` con el esquema de su entidad. Lo inválido se responde como `rejected` con `code`, fuera de la transacción.
2. Abrir la transacción y tomar `pg_advisory_xact_lock(hashtextextended(userId, 0))`.
3. Por cada mutación, en orden: `INSERT INTO applied_mutation … ON CONFLICT DO NOTHING`. Si ya existía, responde `duplicate`.
4. LWW: ejecutar el upsert condicional; si afecta 0 filas, responde `stale` (perdió y el ganador le llegará por pull). Append: insertar; si hay conflicto, `duplicate`.
5. Volver a ejecutar `replay()` para las tarjetas afectadas y aplicar la unicidad del temporizador (§8). Confirmar y devolver `results[]` en el mismo orden.

El push es idempotente aunque se purgue `applied_mutation` (a los 30 días): un HLC igual nunca es mayor, y un `id` repetido en append choca.
```sql
-- Lo que genera upsertLwwSql() en apps/api/src/modules/sync/sql.ts (parámetros con $queryRaw)
INSERT INTO note (id, user_id, deck_id, kind, content, hlc, updated_at, deleted_at, server_seq)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, nextval('sync_seq'))
ON CONFLICT (id) DO UPDATE SET deck_id = EXCLUDED.deck_id, kind = EXCLUDED.kind, content = EXCLUDED.content,
  hlc = EXCLUDED.hlc, updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at, server_seq = nextval('sync_seq')
WHERE note.user_id = EXCLUDED.user_id AND note.hlc COLLATE "C" < EXCLUDED.hlc COLLATE "C"
RETURNING server_seq;
```

**Escrituras propias del servidor.** Cuando el servidor escribe filas sincronizables fuera de un push (hoy solo el mazo de desarrollo de `pnpm db:seed`, `apps/api/src/seed/`), sigue el paso 2: toma el mismo lock por usuario antes de pedir `nextval('sync_seq')`. Firma con un HLC de nodo nil (§2) y genera ahí los UUIDv7 de lo que crea (las `Card` siguen con `cardIdFor`). Sin el lock, dos transacciones pueden confirmar sus `server_seq` en desorden y un pull que corre entre ambas adelanta el cursor y se salta la fila menor (SY3). El seeder reserva todos los `server_seq` de una vez y los asigna mazo → temas → notas → `Card`, el orden en que llegarían si ella los creara.

## 4. Pull por cursor del servidor

**SY3 · DEBE** paginar por `serverSeq` con `GET /sync/pull?cursor=<seq>&limit=500` → `{ changes: { entity, row }[], cursor: string, hasMore: boolean, serverNow: number }`. El servidor hace `UNION ALL` por tabla (`WHERE user_id = $1 AND server_seq > $2 ORDER BY server_seq LIMIT $3`, que Postgres resuelve con Merge Append sobre el índice). **NO DEBE** usar `updatedAt` como cursor. *Razón:* bajo el lock por usuario, `serverSeq` crece en orden de confirmación; los timestamps empatan o retroceden.

**SY4 · DEBE** aplicar el pull en una sola transacción de Dexie. LWW se aplica solo si `remote.hlc > local.hlc` (puede haber una edición local sin enviar); append solo si la fila no existe; el cursor se guarda en la misma transacción. En esa misma transacción, `projectCards()` reproduce el log solo de las tarjetas que tocó la página (filas `card` o `reviewLog`); el `replay()` completo, por ejemplo tras cambiar la retención, va al worker (FRONTEND FE4). *Razón:* si la app se cierra a mitad, nunca queda un cursor adelantado a los datos ni una proyección atrasada respecto del log.

Cada ciclo envía el outbox hasta vaciarlo y luego hace pull hasta `hasMore = false`, dentro de `navigator.locks.request('sync', …)` para que dos pestañas no sincronicen a la vez. Si el cursor es menor que `purgedThroughSeq`, la respuesta es `410 cursor_expired`: el cliente hace un pull completo desde 0 y conserva su outbox.

## 5. Conflictos

| Caso | Resultado |
|---|---|
| Misma entidad editada en dos dispositivos sin red | Gana la fila completa con HLC mayor (ADR-004) |
| Edición contra borrado | Gana el HLC mayor; editar después de borrar revive la entidad |
| Misma tarjeta repasada en dos dispositivos | Se conservan ambos logs; `replay` ordena por `(reviewedAt, id)` |
| Nota borrada mientras otro dispositivo la repasaba | Los logs se conservan (sirven para optimizar FSRS); la tarjeta queda con `deletedAt` |
| Dos `TimerSession` activas | El servidor deja activa la de HLC mayor y cierra la otra con `endedReason: 'superseded'` |
| Mismo `deviceId` en dos instalaciones | Gana la primera que llega al servidor (`<` estricto); importar un respaldo siempre genera un `deviceId` nuevo |

## 6. Borrados lógicos

**SY5 · DEBE** borrar en cascada en el cliente, dentro de la misma transacción: borrar un `Deck` escribe `deletedAt` en sus `Topic`, `Note`, `Card` y `Exercise`. **NO DEBE** el servidor borrar en cascada por su cuenta. *Razón:* cada borrado es su propia escritura LWW y viaja a los otros dispositivos.

Las lecturas pasan por `alive()`, que excluye borrados. Cuando llega un borrado remoto con HLC mayor, el cliente borra la fila local. Al borrar una `Card` se elimina también su fila de `cardStates`, porque la proyección solo cubre tarjetas vivas. El servidor purga los borrados con más de `SYNC_TOMBSTONE_RETENTION_DAYS` (90 días) y actualiza `purgedThroughSeq`. `ReviewLog` nunca se purga, salvo cuando se borra la cuenta.

## 7. Cada repaso se guarda al responder (R3)

**SY6 · DEBE** escribir el `ReviewLog` completo (hora, calificación, ms, tipo, confianza, sesión), la proyección y la entrada del outbox en una sola transacción de Dexie antes de mostrar la siguiente tarjeta. **NO DEBE** acumular repasos en memoria para guardarlos al final. *Razón:* si cierra la app, no se pierde nada (R3).
```ts
// ❌ useStudyStore.getState().pendingLogs.push(log);  // se guarda "al terminar la sesión"
// ✅
await db.transaction('rw', [db.reviewLogs, db.cardStates, db.outbox], async () => {
  const log = ReviewLogSchema.parse({ id: uuidv7(), cardId, cardKind, reviewedAt: now, rating, durationMs, type, confidence, sessionId, deviceId });
  await db.reviewLogs.add(log);
  await db.cardStates.put(applyReview(state, log, config));
  await db.outbox.add({ mutationId: uuidv7(), op: 'append', entity: 'reviewLog', row: log, createdAt: now });
});
syncScheduler.poke();
```

## 8. Temporizador (§3, ADR-006)

**SY7 · DEBE** sincronizar `TimerSession` por LWW con `TimerStateSchema` (shared): `{state, mode, startedAt, pausedAt, pausedMs, blockIndex, completedBlocks, plannedMs, extendedThisBlock, ownerDeviceId, lastSeenAt, endedReason}`. `completedBlocks` decide el descanso largo y `lastSeenAt` es la marca más alta del reloj (no retrocede y detecta la app cerrada a mitad de bloque). Cada transición la valida la máquina de `srs/timer` y se escribe junto con el outbox; un `tick` que solo avanza `lastSeenAt` (`changed: false`) no se sincroniza. Cada bloque o descanso cerrado agrega un `TimerBlockLog` (`TimerBlockLogSchema`) con `outcome: 'completed' | 'interrupted' | 'manual'` (§3), que P6 usa para contar bloques, y `extended` (usó "+N min"; §5, uso de descansos, desde el contrato 4). *Razón:* hay un solo temporizador por cuenta y se puede continuar en otro dispositivo.
- Solo puede haber una sesión por cuenta con `state ∉ {idle, ended}`; el servidor lo hace cumplir al recibir el push (§5).
- Tomar el control desde otro dispositivo ("En curso en otro dispositivo · Continuar aquí") reescribe la misma `id` con el nuevo `ownerDeviceId`. Solo el dispositivo dueño despacha eventos; desde otro, únicamente `start` y `takeover` (que toman el control primero).
- El servidor cierra la sesión de HLC menor con la transición `stop` de `srs` (`endedReason: 'superseded'`) y un HLC propio (nodo nil) que le gana; el bloque que esa sesión tenía en curso no genera `TimerBlockLog`.
- Las marcas de tiempo se escriben como `Date.now() + serverOffsetMs`, donde el desfase se estima con el `serverNow` del pull. El tiempo restante sale de esas marcas (§3); al reabrir se aplica `timer.pauseTimeoutMin`.
- `lastSeenAt` avanza en local con cada `tick` sin pasar por el outbox (un latido por segundo no viaja); se sincroniza con la siguiente transición. Así, al recargar, el hueco desde la última señal real detecta la app cerrada a mitad de bloque.

## 9. Envío y reintentos

**SY8 · DEBE** disparar la sync con `poke()` tras cada escritura (con debounce de 2 s), con el evento `online`, al volver a primer plano, al abrir la app y cada 60 s con la app visible. iOS no tiene Background Sync, así que lo que se responde sin red queda seguro en Dexie (R3). Reintentos con backoff `1 s × 2ⁿ` con jitter, hasta 5 min:
- `401`: refrescar el token una vez.
- `426`: pausar la sync hasta que la app se actualice (ARC6).
- `429` o `503`: respetar `Retry-After`.
- `rejected`: queda en el outbox, visible en Ajustes › Sincronización. **NO DEBE** borrarse sin avisar.

## 10. Migraciones del esquema de Dexie

**SY9 · DEBE** solo agregar versiones (`db.version(n+1)`), nunca editar una ya publicada. La migración (`upgrade`) corre sin red y conserva el outbox. Las proyecciones se pueden vaciar y reconstruir con `replay()`. Si cambia la forma de lo que viaja, se sube `CONTRACT_VERSION`. *Razón:* hay dispositivos con datos sin sincronizar que actualizan cuando pueden.
```ts
db.version(4).stores({ notes: 'id, deckId, topicId, [deckId+topicId]' })
  .upgrade((tx) => tx.table('notes').toCollection().modify((n) => { n.topicId ??= null; }));
```

## 11. Plan de pruebas

| ID | Escenario | Esperado |
|---|---|---|
| SY-T1 | 30 repasos sin red, recargar, reconectar | 30 logs en el servidor y la misma proyección en el cliente y el servidor |
| SY-T2 | Cerrar la pestaña justo después de calificar (Playwright `page.close()`) | El log existe al reabrir (R3) |
| SY-T3 | Se corta la red después del commit y antes de la respuesta; se reintenta | Respuesta `duplicate`, sin filas duplicadas |
| SY-T4 | Dos dispositivos con el mismo `deviceId` | Convergen al valor del servidor; importar un respaldo genera un `deviceId` nuevo |
| SY-T5 | Pushes concurrentes del mismo usuario | Se serializan por el lock; el pull no se salta ningún `serverSeq` confirmado |
| SY-T6 | HLC viejo; edición contra borrado; revivir | `stale`; gana el HLC mayor; la entidad revive |
| SY-T7 | Reloj del dispositivo ±10 min | El HLC sigue siendo monótono; el temporizador usa `serverOffsetMs` |
| SY-T8 | Logs que llegan desordenados | El `replay()` da el mismo estado que en orden (con ±1 día de tolerancia entre motores JS) |
| SY-T9 | `410 cursor_expired` | Pull completo, outbox intacto |
| SY-T10 | Fixture de cada versión de Dexie → la última | Datos y outbox intactos |
| SY-T11 | Dos temporizadores iniciados sin red; tomar el control | Queda uno activo; el otro termina `superseded` y su `TimerBlockLog` se conserva |
| SY-T12 | fast-check: 3 réplicas simuladas, entregas desordenadas y duplicadas | Estado final idéntico en todas |

## 12. Checklist de revisión

- [ ] ¿La entidad nueva está en `ENTITY_STRATEGY` y tiene las columnas comunes (SY1)?
- [ ] ¿Toda escritura local avanza el HLC y entra al outbox en la misma transacción (SY2, SY6)?
- [ ] ¿Las comparaciones de `hlc` en SQL usan `COLLATE "C"`?
- [ ] ¿Algún `UPDATE` o `DELETE` sobre una entidad de solo inserción?
- [ ] ¿El cursor se guarda en la misma transacción que los datos del pull (SY4)?
- [ ] ¿Los borrados en cascada se hacen en el cliente (SY5)?
- [ ] ¿El temporizador calcula con marcas de tiempo corregidas por `serverOffsetMs` (SY7)?
- [ ] ¿Alguna mutación `rejected` que se descarte sin avisar (SY8)?
- [ ] ¿La versión nueva de Dexie se agregó sin editar las anteriores y tiene su fixture (SY9, SY-T10)?
- [ ] ¿Pasan SY-T1 a SY-T12 y no hay ninguna marcada `.skip` (AGENTS §5)?
