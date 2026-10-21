# LEARNING-DESIGN.md — Tarjetas, ejercicios, calificación, exámenes e IA

**Precedencia:** [STUDY-METHODS.md](STUDY-METHODS.md) gana sobre este documento; si algo aquí lo contradice, aplica STUDY-METHODS. La implementación vive en `@estudio/srs` (ARC2) y todos los umbrales en `StudyConfig` (AGENTS AG4). Los marcados *diseño* no salen de STUDY-METHODS: son hipótesis propias.

## 1. Modelo: nota y tarjeta

Una **`Note`** es el contenido que ella crea (en la UI se llama "tarjeta"). Una **`Card`** es la unidad que programa FSRS: una por lado, por hueco cloze, por grupo de máscaras o por pregunta de ejercicio. Cada `Card` tiene su propio estado FSRS (`cardStates`, ARC5). Un `Exercise` también genera `Card`s. Una nota se puede mover a otro mazo al editarla: sus `Card`s y su historial no cambian, y como los temas son de cada mazo, queda sin tema o con uno del mazo nuevo. Además del tema (uno, de su mazo), una nota puede tener hasta 20 **etiquetas** (`Note.tagIds`, *diseño*): son de ella, cruzan mazos y se eligen o crean en el editor; dos nombres que solo difieren en mayúsculas o acentos son la misma.

| Tipo de nota | Cards que genera | Intento (R1) | Calificación |
|---|---|---|---|
| `basic` | 1 (+1 inversa opcional) | Recordar con la pregunta visible → "Mostrar" | Ella elige entre 4 botones |
| `cloze` | 1 por cada `{{cN::…}}` | Igual | Ella elige |
| `image_occlusion` | 1 por grupo de máscaras (`hide_one` o `hide_all`); coordenadas normalizadas de 0 a 1 | Igual, con la etiqueta oculta | Ella elige |
| `type_answer` | 1 | Escribir → "Comprobar" | Automática (§3) |
| `multiple_choice` | 1 (3 a 5 opciones, una correcta) | Elegir una opción | Automática (§3) |

**LD1 · DEBE** acompañar cada imagen con texto y oclusión de etiquetas cuando la imagen es el contenido. **NO DEBE** ofrecerse imagen decorativa, de stock ni plantilla con ilustración (R10).
- Una nota `image_occlusion` guarda el `MediaAsset.id` de su imagen (FRONTEND FE8), una pregunta (`prompt`, el texto de LD1), un `alt` que describe la imagen sin nombrar las etiquetas tapadas (UI-UX UX4), el modo y sus grupos. Cada grupo es una etiqueta con su nombre y de 1 a 10 recuadros en coordenadas de 0 a 1 sobre la imagen tal como se ve (con la orientación EXIF aplicada).
- Cada grupo tiene un número `n` estable que es el `ordinal` de su `Card`, como el número de un hueco cloze. Quitar una etiqueta borra solo su Card, y los números no se reutilizan, así el historial de las otras no cambia.
- `hide_all` (por defecto) tapa también las demás etiquetas; `hide_one` tapa solo la que se pregunta. Antes del intento, la que se pregunta va resaltada con "?" y su nombre no está en el DOM (R1); al revelar queda su borde y su nombre aparece como respuesta (R4).
- La imagen es de ella: se elige del dispositivo (JPG, PNG, WebP, GIF o HEIC, hasta 10 MB) y no se cambia al editar la nota, porque los recuadros y el historial son de esa imagen.

## 2. Ejercicios de aplicación

| Tipo | Unidad programable | Puntaje `s ∈ [0,1]` |
|---|---|---|
| `clinical_case` | 1 Card por subpregunta (`multiple_choice`, `type_answer` u `open`) | El de cada subpregunta |
| `sequence` | 1 | `1 − inversiones / inversiones máximas` (Kendall) |
| `matching` | 1 | pares correctos / total |
| `label_image` | 1 | etiquetas correctas / total |
| `true_false_justify` | 1 | V/F automático; ella autoevalúa la justificación |
| `open_question` | 1 | Ella se califica tras ver la clave y, si quiere, la retroalimentación de IA |

## 3. De la respuesta a la calificación FSRS

**LD2 · DEBE** convertir la respuesta en calificación con `toRating()` en `srs`, de forma determinista. *Razón:* la misma respuesta debe dar la misma calificación en cualquier dispositivo y al reproducir el log (ARC5).
- Autoevaluadas (`basic`, `cloze`, `image_occlusion`, `open_question`): ella elige `Again`, `Hard`, `Good` o `Easy`.
- Objetivas (`type_answer`, `multiple_choice`): un error es `Again` fijo. Un acierto deja elegir entre `Hard`, `Good` y `Easy`, con `Good` preseleccionado. En `type_answer` se normalizan mayúsculas, espacios y acentos, y siempre se muestra la ortografía correcta.
- Con puntaje (*diseño*): `s ≥ exercise.goodMinScore` (1.0) da `Good` (puede subir a `Easy`); `s ≥ exercise.hardMinScore` (0.8) da `Hard`; lo demás, `Again`.
- `true_false_justify`: V/F incorrecto es `Again`. V/F correcto con justificación suficiente es `Good`; con justificación débil, `Hard`.
- **Simulacros (P7):** acierto con `confidence ≥ exam.highConfidenceMin` (3) es `Good`; acierto con menos confianza es `Hard` (la confianza 2 cuenta como poca, confirmado por el responsable); fallo es `Again`. Se guarda con `type: 'exam'`. Entra al `replay()` solo si `exam.affectsScheduling` (inicial `true`, confirmado; ADR-009).
```ts
// ❌ const rating = correct ? Rating.Good : Rating.Again;                   // ignora confianza (P7)
// ✅ const rating = toRating({ kind: 'exam', correct, confidence }, cfg.exam);
```

## 4. Flujo de un intento (R1, R4, R5, R6, R15)

`prompt → [confianza] → intento → revelar (respuesta + explicación) → calificación → ReviewLog`

**LD3 · DEBE** registrar el intento antes de revelar; la respuesta no está en el DOM antes (FRONTEND FE10). *Razón:* R1.

**LD4 · DEBE** mostrar la respuesta y `explanation` (máximo 400 caracteres) tras **cada** intento, también si acertó con poca confianza. *Razón:* R4.

**LD5 · DEBE** mostrar `Topic.explanation` y pedir una autoexplicación ("Explícalo con tus palabras", que se guarda como `SelfExplanation`) antes de la primera Card nueva de un tema. Esto no cuenta como repaso. *Razón:* R5 y R15.

**LD6 · DEBE** pedir la confianza (1-3) antes de revelar: siempre en simulacros y, en repasos, solo si `review.askConfidence` (inicial `false`). *Razón:* R6.

**LD7 · NO DEBE** existir un modo de releer, subrayar o resumir que genere `ReviewLog` o que se presente como forma principal de estudiar. *Razón:* R15.

`ReviewLog` (R3): `{ id, cardId, cardKind, reviewedAt, rating: 1-4, durationMs, type: 'learn' | 'review' | 'exam' | 'contrast', confidence: 1-3 | null, sessionId, deviceId, answer? }`, guardado al responder (SYNC SY6). `cardKind` es una foto del tipo de nota o ejercicio en ese momento (el "tipo" de R3), porque la nota puede cambiar después. `durationMs` es el tiempo con la tarjeta a la vista, de mostrarla a calificarla (`cardElapsedMs()` en `srs`): no cuenta el descanso del temporizador, la app en segundo plano o con el teléfono bloqueado, ni el tiempo fuera de la pantalla de estudio, al volver de "Salir" con la tarjeta a medias (*diseño*). En simulacros va de mostrar la pregunta a responderla, sin el tiempo con la app oculta. Alimenta P1, P5 y el tiempo activo (§5).

## 5. FSRS (R2, R18)

**LD8 · DEBE** programar con ts-fsrs y `fsrs.requestRetention` (inicial 0.90, rango 0.80-0.95), con fuzz determinista. Al cambiar la retención, Ajustes muestra la carga proyectada antes de guardar: "Con 95 %: ≈ 74 repasos al día (ahora 48)", calculada con `replay()` y `fsrs.projectionDays` días simulados (*diseño*, 30, rango 7-90) en el worker (FRONTEND FE4). *Razón:* R2.
- `projectReviewLoad()` en `srs` reproduce el log con la retención a evaluar y simula días locales de ella. Supuestos (*diseño*): cada tarjeta se repasa al vencer (lo pendiente, hoy); en un repaso la recuerda con la probabilidad que da FSRS, con un sorteo de semilla fija por tarjeta que es el mismo para cualquier retención; las nuevas entran hasta `planner.newPerSessionMax` por día; los pasos de (re)aprendizaje se dan por bien, y las de "reformular" (P3) no se repiten. Cuenta solo repasos de tarjetas aprendidas (tipo `review`).
- Al guardar otra retención (o recibirla por sync), toda la proyección `cardStates` se reconstruye con `replayCards()` en el worker; `replaySettingsKey()` dice si la proyección guardada quedó vieja (ARC5).

**LD9 · NO DEBE** la app cambiar la retención objetivo por su cuenta, ni editar a mano fechas de FSRS, ni afirmar que los intervalos crecientes son mejores. Los pesos de FSRS son los de fábrica; optimizarlos queda fuera de la v1. *Razón:* P3 ("nunca bajar la retención sin avisar"), §3 y R18.

## 6. Planificador (P1-P8)

| Regla | Claves de `StudyConfig.planner` (valor inicial) | Comportamiento |
|---|---|---|
| P1 | `newPerSessionMax` (10, rango 0-30), `bootstrapReviewSec` (20), `bootstrapNewSec` (60), `timingMinSamples` (20, *diseño*), `sessionBlocksDefault` (1, *diseño*) | `nuevas = min(tope, ⌊(presupuesto − repasos de la sesión × t_repaso) / t_nueva⌋)`, con medianas de su historial a partir de `timingMinSamples` muestras (una nueva = la suma de sus pasos `learn`). Se restan los repasos que entran en la sesión tras P8, no todas las vencidas: si no, P2 nunca tendría efecto |
| P2 | `overdueFactorForZeroNew` (2) | Si las vencidas superan 2 × lo que cabe en la sesión: 0 nuevas |
| P3 | `lowRetentionWindowDays` (3), `lowRetentionDropPts` (10), `lowRetentionMinReviews` (20, *diseño*), `leechLapses` (6), `lowRetentionPersistDays` (7), `persistNewFactor` (0.5) | 0 nuevas si la retención cae (ventana en días locales de ella; con menos de `lowRetentionMinReviews` repasos no se juzga); con ≥6 lapsos la Card va a "reformular" y editar su nota la reformula (`Card.lapseBaseline`); si persiste, se propone la mitad de nuevas |
| P4 | `reviewMaxSameTopicRun` (5), `newMaxSameTopicRun` (10) | Repasos mezclados; nuevas por tema y luego mezcladas |
| P4, LD10 | `contrast.maxSetSize` (5, rango 2-12, *diseño*), `contrast.retentionMinDays` (7), `contrast.minReviewsPerArm` (30, *diseño*) | Sets de contraste en los grupos del brazo `contrast` y comparación A/B (ver LD10) |
| P5 | `fatigueWindowCards` (10), `fatigueAccuracyDropPts` (20), `fatigueLatencyFactor` (1.5) | Sugerencia suave de descanso sobre las acciones de la sesión. Tras un aviso o un descanso, el siguiente espera otras `fatigueWindowCards` respuestas (`fatigueWarningDue`, *diseño*); un descanso corta la serie de avisos seguidos |
| P6 | `stopAfterNetBlocks` (4), `fatigueWarningsToStop` (2); hora de dormir en `profile.bedtime` (si es `null`, se usa `quietHours.start`), que ella elige en Ajustes > Hora de dormir, donde se muestra la franja que resulta (de esa hora a `quietHours.end`) | Sugerir parar, nunca bloquear: la tarjeta sigue en pantalla, responder o "Seguir" lo descarta por la sesión, y la cola completa se dice en el resumen final |
| P7 | `exam.mockWeeksBeforeExam` (8), `exam.mocksPerWeek` (1), `exam.feedbackTiming` (`'end'`), `exam.topicMinItems` (5, *diseño*) | Simulacros acumulativos; "pocos datos" por tema con menos de `topicMinItems` preguntas |
| P8 | `backlogSpreadMinDays` (3), `backlogSpreadMaxDays` (7) | Repartir el atraso de menor a mayor retrievability |
| R7, R8, §3 | `timer.focusMin` (25, rango 5-120), `shortBreakMin` (5, 1-30), `longBreakMin` (20, 5-60), `cyclesBeforeLong` (4, 2-6), `mode` (`flexible`, *diseño*), `pauseTimeoutMin` (10), `endOfBlockGraceSec` (60), `flexExtendMin` (5) | Presets 25/5, 24/6, 12/3, 50/10, 90/20 y personalizado; ninguno se presenta como óptimo (R17) |
| R21, §5, R6 | `metrics.inactivityCutoffSec` (90), `metrics.minReviewsToShow` (100), `metrics.baselineWeeks` (4, *diseño*), `metrics.calibrationMinSamples` (20, *diseño*), `metrics.calibrationBiasMargin` (0.1, *diseño*), `metrics.calibrationResolutionMin` (0.3, *diseño*), `review.askConfidence` (`false`) | "Tu semana" (`weeklyMetrics()` en el worker): tiempo activo por sesión con tope de inactividad; retención real con intervalo de Wilson al 95 % frente al objetivo; calibración como frase (sesgo = confianza 1-3 llevada a 0-1 − acierto; resolución = gamma); pendientes de 7 días. Línea base: sus semanas previas desde el primer repaso. Confianza en repasos opcional en Ajustes |
| §5 (sueño) | `metrics.visible.sleep` (`false`), `metrics.sleepMinNights` (3, *diseño*) | Opcional: si lo activa en Ajustes, Hoy pregunta "¿Cómo dormiste anoche?" con un toque (1-5) y se corrige ese mismo día; una fila por noche y día local (`SleepLog`, SYNC §1). Tu semana da la mediana de la semana frente a la de sus semanas previas, con "pocos datos" bajo `sleepMinNights` noches. Sin racha, aviso ni recordatorio, y sin relacionarlo con su rendimiento: [30] es transversal (R20). No toca FSRS ni el planificador |

**Estudiar un mazo** (*diseño*): la sesión de Hoy mezcla todos los mazos (R9, P4). Desde Mazos se puede estudiar uno solo (`/study?mazo=<id>`): P1-P8 se aplican solo a sus tarjetas, pero los tiempos medianos (P1) y la retención reciente (P3) siguen saliendo de todo su historial, porque son de ella y no del mazo. Dentro del mazo, los temas se siguen mezclando (P4). Las cargas por mazo (`loadSummary()`) cuentan con la misma regla que la cola.

**Estudiar una etiqueta** (*diseño*): desde Mazos › Etiquetas (`/study?etiqueta=<id>`), con la misma regla que estudiar un mazo: P1-P8 solo sobre las tarjetas con esa etiqueta, de cualquier mazo, y los tiempos (P1) y la retención (P3) de todo su historial. Entran también las de un mazo en pausa, porque ese alcance lo eligió ella. En la pantalla de un mazo, las etiquetas solo filtran la lista. No cambian FSRS ni la mezcla de Hoy (R9, P4).

**Pausar un mazo** (*diseño*, `Deck.pausedAt`): sus tarjetas no entran en Hoy (cola, P2, P8), en la carga de Tu semana, en la carga proyectada de Ajustes (LD8) ni en el conteo de los recordatorios (NOTIFICATIONS NT3). FSRS no cambia (LD9): sus fechas siguen corriendo y, al reanudarlo, lo pendiente entra con P8 (se reparte en 3-7 días si no cabe). Se puede estudiar igual desde Mazos, y los exámenes (repaso previo, simulacros, plan por tema) lo siguen viendo, porque ese alcance lo eligió ella. El historial completo sigue alimentando P1, P3 y las métricas.

**LD10 · DEBE** implementar los sets de contraste (R9, P4) solo sobre `ContrastGroup`s marcados como confundibles, y después del primer acierto de cada miembro. Cada grupo recibe al crearse un `abArm: 'contrast' | 'control'` (sorteo con semilla guardada), y se compara la retención a 7 días entre brazos. *Razón:* la evidencia es contradictoria ([7] frente a [8]).
- **Grupo:** `ContrastGroup` (LWW) con nombre y de 2 a 20 notas, en Mazos › Tarjetas que se confunden (`/contrast`). Crear el grupo es marcar esas notas como confundibles; un grupo puede mezclar mazos.
- **Listo:** cuando cada nota viva del grupo tuvo su primer acierto (cualquier calificación salvo `Again`, en cualquiera de sus Cards). Con menos de 2 notas vivas no hay set.
- **Sorteo** (*diseño*): bloques de 2. El grupo nuevo va al brazo con menos grupos y, si están parejos, decide la paridad de `abSeed` (un uint32 al azar que se guarda). El brazo no cambia al editar el grupo. Con pocos grupos, un sorteo libre podría dejarlos todos del mismo lado.
- **Set** (`applyContrastSets` en `srs`): en los grupos listos del brazo `contrast`, los repasos de hoy que ya están en la cola van seguidos, en el lugar del más urgente y en el orden de la cola, hasta `contrast.maxSetSize`, si son de al menos 2 notas. No adelanta repasos ni cambia fechas de FSRS: solo el orden. Es una excepción de P4: el set va seguido aunque sea del mismo tema. Una tarjeta entra en un solo set y las nuevas nunca. Antes de la primera tarjeta del set, un aviso dice "Set de contraste · nombre (1 de n): se parecen; fíjate en qué las distingue".
- **Registro:** la primera respuesta de la sesión a una tarjeta del set se guarda con `type: 'contrast'`. Cuenta igual que `review` para FSRS, los tiempos (P1), la retención (P3) y Tu semana (§5). Si vuelve en reaprendizaje, va como repaso normal. El brazo `control` se repasa mezclado como siempre.
- **A/B** (`contrastComparison`): en las tarjetas de grupos listos, se cuentan los repasos (`review` o `contrast`) hechos después de que el grupo quedó listo y con al menos `contrast.retentionMinDays` días desde el repaso anterior de esa tarjeta. Good y Easy cuentan como recordadas (§5). Una tarjeta que está en grupos de los dos brazos no cuenta, y los simulacros tampoco. Se muestra con intervalo de Wilson y solo con `contrast.minReviewsPerArm` repasos por brazo; si no, "Pocos datos todavía". Siempre con las fuentes [7] y [8] enlazadas (R20).

## 7. Exámenes y simulacros (R11, P7)

**LD11 · DEBE** pedir para cada `Exam` título, fecha y temas. Con eso el plan muestra por tema las nuevas que faltan y los días disponibles, y sugiere `⌈faltan / días⌉` por día, limitado por P1. *Razón:* R11.

**LD12 · DEBE** agregar, en los últimos `exam.finalReviewWindowDays` días (*diseño*, 7), una vuelta de "repaso previo al examen" con las Cards del alcance cuyo `due` cae después del examen. Se registran como repasos normales y FSRS los procesa como repasos anticipados, sin editar fechas. *Razón:* R11 manda ajustar hacia la fecha; así R18 y §3 se respetan porque el intervalo lo sigue calculando FSRS.

**LD13 · DEBE** armar cada simulacro de forma acumulativa: `exam.mockSize` preguntas (*diseño*, 30), con `exam.previousTopicsShare` (*diseño*, 0.3) de temas de exámenes anteriores. Confianza obligatoria (R6), retroalimentación por pregunta al terminar (por defecto) o inmediata. El resultado se da por tema, con calibración y "pocos datos" cuando corresponda (UI-UX UX9). Sin nota de aprobado ni comparación con nadie. *Razón:* P7 y §5.
- El simulacro es una `StudySession` (`mode: 'exam'`, BACKEND §1) que guarda cada respuesta al darla (confianza y texto), así se retoma al volver. `buildMock()` en `srs` elige solo tarjetas ya empezadas, con semilla (AG3), repartidas entre temas y en orden mezclado (P4).
- Con las tarjetas autoevaluadas de hoy, "acierto" lo marca ella al ver la respuesta: al final del simulacro (por defecto) o tras cada pregunta (`immediate`). Cada marca escribe el `ReviewLog` `exam` con `reviewedAt` = momento en que respondió.

## 8. IA (opcional; la captura manual siempre existe)

**LD14 · DEBE** usar la IA solo para: borradores de notas a partir de texto que ella pega, distractores de opción múltiple, borradores de casos clínicos y retroalimentación de respuestas abiertas. **NO DEBE** calificar para FSRS, programar repasos ni guardar contenido sin que ella lo revise. *Razón:* la clave vive solo en el servidor y la calificación es de ella.

**LD15 · DEBE** definir la salida con esquemas zod de `shared`, convertidos con `z.toJSONSchema` a `json_schema` estricto (todos los campos requeridos; los opcionales como `nullable`), y validarla otra vez con zod. *Razón:* la forma garantizada evita contenido a medias.
```ts
export const AiNoteDraftSchema = z.object({
  kind: z.enum(['basic', 'cloze', 'multiple_choice']),
  front: z.string().min(1).max(500), back: z.string().min(1).max(1000),
  explanation: z.string().max(400),                    // R4
  sourceQuote: z.string().min(1).max(300),             // debe aparecer literal en el texto de entrada
  options: z.array(z.string().max(200)).min(3).max(5).nullable(),
}).strict();
export const AiOpenFeedbackSchema = z.object({
  covered: z.array(z.string()), missing: z.array(z.string()), misconceptions: z.array(z.string()), suggestion: z.string(),
}).strict();                                           // sin nota numérica: la calificación es de ella
```

**LD16 · DEBE** guardar todo lo generado como `AiDraft` (`draft` → `accepted` | `rejected`). Ella lo ve completo y lo edita antes de aceptarlo; aceptarlo crea la `Note` con `origin: 'ai'`. Un borrador cuyo `sourceQuote` no aparece en el texto de entrada se marca "Sin respaldo en tu texto" y no se acepta sin editarlo. **NO DEBE** haber aceptación automática. *Razón:* la IA puede inventar anatomía.

El mazo de desarrollo de `pnpm db:seed` ("Huesos del esqueleto") tampoco pasó por su revisión, y entra con `origin: 'manual'` aunque no lo escribió ella. Por eso el seeder no corre con `NODE_ENV=production`: en su cuenta real, toda `Note` la escribió o la aceptó ella.

**LD17 · DEBE** manejar errores y costos así. *Razón:* cuidar el costo y que ella no pierda su texto.
- Sin red: botón deshabilitado con "Requiere conexión".
- Cuota agotada (`429`): "Disponible de nuevo a las 00:00".
- Rechazo del modelo, timeout de 30 s o salida inválida: un reintento y luego un error con su texto intacto. Los ítems inválidos se descartan e informan.
- Cuota diaria por usuario (`AI_DAILY_REQUESTS`, `AI_DAILY_TOKENS`), entrada de 12 000 caracteres como máximo, `max_output_tokens` explícito y modelo por `OPENAI_MODEL`.
- `ai_usage` registra tokens, modelo, latencia y estado, nunca el contenido (BACKEND BE6). Se avisa que no pegue datos de pacientes.

## 9. Checklist de revisión

- [ ] ¿Cada tipo nuevo de nota o ejercicio define sus Cards, su intento y su `toRating()` (LD2)?
- [ ] ¿La confianza se pide antes de revelar en simulacros, y P7 mapea Good/Hard/Again con `type: 'exam'` (LD2, LD6)?
- [ ] ¿Respuesta y explicación tras cada intento, y explicación con autoexplicación en temas nuevos (LD4, LD5)?
- [ ] ¿Algún modo de releer que genere `ReviewLog` (LD7)?
- [ ] ¿Algún cambio automático de retención o edición de fechas FSRS (LD9, LD12)?
- [ ] ¿Cada umbral de P1-P8 y de *diseño* vive en `StudyConfig` y tiene prueba con otro valor (QUALITY.md)?
- [ ] ¿Los sets de contraste tienen `abArm` y aparecen solo tras el primer acierto (LD10)?
- [ ] ¿La salida de IA se valida con zod, queda como borrador y se verifica su `sourceQuote` (LD15, LD16)?
