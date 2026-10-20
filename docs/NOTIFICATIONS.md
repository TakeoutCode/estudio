# NOTIFICATIONS.md — Recordatorios y Web Push

**Precedencia:** [STUDY-METHODS.md](STUDY-METHODS.md) gana sobre este documento. Aplica §3 (puntos a-g), R12 y R19. §6 aclara que el efecto de las notificaciones **no se investigó**: esto es política de diseño, apagable y con todos sus umbrales en configuración (AGENTS AG4).

## 1. Política y configuración

| Regla | Clave en `UserSettings.notifications` | Valor inicial |
|---|---|---|
| §3d y §3g: máximo de **recordatorios** al día, por cuenta (no por dispositivo) | `maxRemindersPerDay` (rango 0-2) | 2 |
| §3c, R12: horas silenciosas en su zona horaria | `quietHours.start` / `quietHours.end` | `22:00` / `07:00` |
| §3b: recordatorio diario a la hora que ella elija | `dailyReminderTime` | `null` (se pide al activarlo) |
| §3b: mínimo de pendientes para el recordatorio diario | `minDueForReminder` | 10 |
| §3f: recordatorios ignorados seguidos antes de bajar la frecuencia | `ignoredStreakForBackoff` | 3 |
| §3f: frecuencia reducida | `backoffEveryDays` | 3 |
| Diseño: cuándo un recordatorio cuenta como ignorado | `ignoredAfterHours` | 12 |
| §3a: aviso de fin de descanso | `breakEnd.enabled` | `true` |
| §3g, diseño: días antes del examen en que se avisa | `examSoonDaysBefore` | `[7, 1]` |
| §3g, diseño: aviso del plan del día | `studyPlan.enabled` | `true` |

**NT1 · DEBE** existir solo `NotificationKind = 'daily_reminder' | 'exam_soon' | 'study_plan' | 'break_end'`. Los tres primeros son **recordatorios**: cuentan para el tope de 2 y para la reducción por ignorados. `break_end` no cuenta para ninguno de los dos (§3g). **NO DEBE** existir un aviso de "racha en riesgo" (R19); una prueba verifica el enum. *Razón:* §3 y su aclaración (g) definen exactamente estos avisos.

| Tipo | Se envía cuando |
|---|---|
| `daily_reminder` | Hay al menos `minDueForReminder` vencidas (§3b) |
| `exam_soon` | Un `Exam` vivo está a N días, con N en `examSoonDaysBefore`; una vez por examen y por cada N |
| `study_plan` | El plan sugiere nuevas para hoy (LEARNING-DESIGN LD11) y todavía no completó esa cuota |
| `break_end` | Termina un descanso con la app en segundo plano, una sola vez (§3a) |

## 2. Modelo de datos

- `PushSubscription` (solo servidor): `id`, `userId`, `deviceId`, `endpoint` (único), `p256dh`, `auth`, `userAgent`, `createdAt`, `lastSuccessAt`, `failures`.
- `NotificationEvent` (solo inserción): `id`, `userId`, `kinds[]` (uno o varios recordatorios agrupados), `localDate`, `scheduledFor`, `sentAt`, `openedAt`, `status` (`pending` mientras se entrega, luego `sent` | `failed` | `suppressed`), `reason`, `payloadKey` y `payloadParams` (los parámetros del texto, no el texto), y `examDays` (los `examId:N` avisados en ese evento, para avisar una vez por examen y por cada N).
- `ScheduledNotification` (fin de descanso): `id`, `userId`, `timerSessionId`, `blockIndex`, `fireAt`, `cancelledAt`, `sentAt`, con unicidad `(timerSessionId, blockIndex)` para enviarlo una sola vez.
- `NotificationState` por usuario: `backoffResetAt` ("Como antes") y `backoffQuestionAnsweredAt`. La serie de ignorados y el modo reducido no se guardan: se calculan con `backoffState` a partir de los eventos enviados, así no se desincronizan.

`reason` ∈ `disabled`, `quiet_hours`, `daily_cap`, `below_min_due`, `backoff`, `no_subscription`, `foreground`. Registrar cada supresión permite revisar la política con datos (§6).

## 3. Decisión pura

**NT2 · DEBE** decidir cada envío con `decideNotification` (en `packages/srs/src/notifications/`), una función pura que recibe `nowUtc`, `timeZone`, preferencias y conteos. **NO DEBE** el cron consultar el reloj ni usar números sueltos. *Razón:* hay que probar con tablas los cortes de horario, de zona y del tope.
```ts
export function decideNotification(i: DecideInput): Decision {
  if (!i.prefs.enabled) return skip('disabled');
  if (isWithinQuietHours(i.nowUtc, i.timeZone, i.prefs.quietHours)) return skip('quiet_hours'); // cruza medianoche
  if (i.kind === 'break_end') return i.prefs.breakEnd.enabled ? send() : skip('disabled');      // §3g: fuera del tope
  if (i.remindersSentToday >= i.prefs.maxRemindersPerDay) return skip('daily_cap');
  if (inBackoff(i.state, i.prefs) && !isBackoffDay(i, i.prefs.backoffEveryDays)) return skip('backoff');
  if (i.kind === 'daily_reminder' && i.dueCount < i.prefs.minDueForReminder) return skip('below_min_due');
  return send();
}
// ❌ if (due < 10 || hour >= 22) return;     // literales y hora del servidor
```

## 4. Disparadores

**NT3 · DEBE** evaluar los recordatorios con un tick de cron cada 5 min, bajo advisory lock (ARC7). Toma a los usuarios cuya hora local cruzó `dailyReminderTime` desde el tick anterior (`reminderTimeCrossed` de `srs`; un tick perdido no se recupera tarde) y que no tienen recordatorio en su `localDate`, y evalúa los tres tipos de recordatorio. El umbral del diario se compara con las vencidas (tarjetas vivas con `due` antes del fin de su día local, §3b). El número que muestra el texto es el `due` de `buildSessionQueue` de `srs` (vía `reminderCandidates`), el mismo que muestra Hoy, para que el aviso y la app digan lo mismo: por eso las tarjetas de mazos en pausa (`Deck.pausedAt`) no cuentan (`dueCards`), aunque el plan de un examen sí las ve por tema. Si `dailyReminderTime` cae en horas silenciosas, Ajustes no lo permite, y el servidor no lo pospone a las 07:00. *Razón:* §3b y R12; un aviso aplazado llega sin que ella lo espere.

**NT4 · DEBE** programar el fin de descanso desde el cliente: `PUT /notifications/break-end {timerSessionId, blockIndex, fireAt}` al pasar a segundo plano durante un descanso y `DELETE` al volver. Un poller de 30 s envía los vencidos. No cuenta para `maxRemindersPerDay` ni como ignorado, pero sí respeta las horas silenciosas. *Razón:* §3a y §3g; iOS no permite notificaciones locales programadas.

## 5. Agrupación y contenido

**NT5 · DEBE** juntar en **una sola notificación** los recordatorios que califican en el mismo tick, en este orden: examen, plan, pendientes. Es un solo `NotificationEvent` y cuenta 1 para el tope aunque llegue a varios dispositivos. Usa `tag: 'reminder'` (reemplaza al anterior en el dispositivo) o `tag: 'break'`, un TTL de 4 h (recordatorio) o 5 min (descanso) y `Urgency: normal`. *Razón:* evitar la saturación (§3d).

**NT6 · DEBE** usar textos neutros desde el catálogo i18n y solo nombres de temas, nunca el contenido de las tarjetas, porque se ven en la pantalla bloqueada. *Razón:* §3e, R19 y privacidad.

| ✅ | ❌ |
|---|---|
| "23 tarjetas pendientes · Huesos del carpo, Manguito rotador y 2 temas más" | "¡No pierdas tu racha! Tienes 23 tarjetas atrasadas" |
| "Examen de Anatomía I en 7 días · 14 pendientes de ese tema" | "¡Solo te quedan 7 días!" |
| "Plan de hoy: 12 nuevas de Huesos del carpo" | "¡Vas tarde con tu plan!" |
| "Terminó el descanso" | "¡Vuelve ya o perderás el ritmo!" |

## 6. Ignorados y reducción de frecuencia (§3f)

**NT7 · DEBE** reportar las aperturas: el SW abre la URL del aviso (`/?aviso=<id>`) en `notificationclick` y la app, al arrancar con ese parámetro, llama a `POST /notifications/:id/opened` (con sesión; si no hay red, lo reintenta al volver). Cada apertura reinicia la serie de ignorados. Un recordatorio sin abrir en `ignoredAfterHours`, o antes del siguiente, cuenta como ignorado; `break_end` no cuenta. Con 3 seguidos se entra en modo reducido (un recordatorio cada 3 días), y la próxima vez que abra la app, no por push, se pregunta una sola vez: "¿Quieres seguir recibiendo recordatorios? [Como antes] [Cada 3 días] [Desactivar]". La app consulta `GET /notifications/state` y responde con `POST /notifications/backoff`; "Desactivar" además guarda `enabled = false` en sus ajustes. Se vuelve a preguntar solo si, después de "Como antes", vuelve a entrar en modo reducido. *Razón:* §3f y §3g; el aviso de descanso depende de su temporizador, no de su interés por los recordatorios.

## 7. Limitaciones de iOS

**NT8 · DEBE** pedir el permiso solo con un gesto de ella, dentro de la PWA instalada (iOS/iPadOS 16.4 o posterior), después de explicar para qué sirve. En una pestaña de Safari se muestra cómo instalar la app. *Razón:* fuera de la PWA instalada iOS no ofrece Web Push.
- Cada push **debe** mostrar una notificación (no hay pushes silenciosos; WebKit puede revocar la suscripción). Por eso el servidor solo envía lo que se va a mostrar.
- No hay notificaciones locales programadas: el fin de descanso depende del servidor, con unos ±30 s de precisión.
- Concentración y Resumen programado de iOS pueden retrasar avisos; la app no lo controla.
- Si borra la PWA, la suscripción muere: ante `404` o `410` del servicio push se borra la `PushSubscription`.
- **NO DEBE** usarse `setAppBadge` con el número de pendientes: un contador permanente es presión (§5).

## 8. Pruebas

| ID | Caso | Esperado |
|---|---|---|
| NT-T1 | 9 y 10 vencidas a la hora elegida | 9 → `below_min_due`; 10 → se envía |
| NT-T2 | Envíos a las 21:59, 22:00, 06:59 y 07:00 en `America/Mexico_City` | Solo 21:59 y 07:00 salen |
| NT-T3 | 3 descansos y 1 recordatorio en el mismo día | Se envían los 4 (`break_end` fuera del tope) |
| NT-T4 | `remindersSentToday = 2` | `daily_cap` |
| NT-T5 | 3 recordatorios ignorados, luego uno abierto | Modo reducido y pregunta única; abrir uno lo reinicia |
| NT-T6 | Dos ticks concurrentes del cron | Un solo `NotificationEvent` |
| NT-T7 | Fin de descanso con la app visible | Cancelado; ninguno enviado |
| NT-T8 | El mismo bloque programado dos veces | Un solo envío (unicidad) |
| NT-T9 | El servicio push responde 410 | Suscripción eliminada |
| NT-T10 | Enum y catálogo | `NotificationKind` es exactamente esos 4; ninguna clave contiene `racha` o `streak` |
| NT-T11 | Examen a 7 y a 1 día, coincidiendo con el diario | Un aviso por N; si coincide con el diario, una sola notificación agrupada |
| NT-T12 | Plan del día con la cuota ya completada | `study_plan` no se envía |
| NT-T13 | Manual en iPhone: instalar, permitir, recibir, tocar | Abre la ruta correcta; el evento queda `openedAt` |

## 9. Checklist de revisión

- [ ] ¿Algún aviso fuera de los 4 tipos, o un `break_end` contando para el tope o para ignorados (NT1, NT4)?
- [ ] ¿Algún umbral literal o uso del reloj en lugar de `decideNotification` (NT2)?
- [ ] ¿El cron corre bajo advisory lock, respeta su zona horaria y agrupa lo que coincide (NT3, NT5)?
- [ ] ¿El fin de descanso se envía solo en segundo plano, una vez y fuera de horas silenciosas (NT4)?
- [ ] ¿El texto es neutro, sin contenido de tarjetas y sin racha (NT6, `lint:copy`)?
- [ ] ¿La reducción por ignorados pregunta dentro de la app, no por push (NT7)?
- [ ] ¿El permiso se pide con un gesto de ella y sin badge de pendientes (NT8)?
