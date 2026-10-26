# UI-UX.md — Diseño, interacción y tono

**Precedencia:** [STUDY-METHODS.md](STUDY-METHODS.md) gana sobre este documento. Aplica §5 (mostrar sin ansiedad), R1, R4, R17, R19, R20 y R21. **La gamificación no fue investigada en STUDY-METHODS (§6): sus reglas son decisiones de diseño, no evidencia, y debe poder apagarse por completo.**

## 1. Design tokens

**UX1 · DEBE** usar solo tokens semánticos definidos en `apps/web/src/ui/tokens.css` (Tailwind v4, `@theme`). **NO DEBE** usar colores, tamaños ni sombras literales en los componentes. *Razón:* el modo oscuro y los ajustes de contraste se hacen en un solo lugar.

Tema "lazo": blanco de base, rosa como acento y formas redondeadas. El rosa fuerte (`primary`) queda para la acción principal, el estado activo y los enlaces; `blush` es el rosa suave de chips y avisos; `bow` y `dot` son solo adornos (lazos, lunares), nunca texto.
```css
@theme {
  --color-bg: oklch(1 0 0);                  --color-surface: oklch(1 0 0);
  --color-blush: oklch(0.975 0.018 355);     /* paneles y chips; texto primary sobre él ≥ 4.5:1 */
  --color-text: oklch(0.3 0.05 350);         --color-muted: oklch(0.5 0.05 350);
  --color-primary: oklch(0.555 0.195 358);   --color-line-strong: oklch(0.67 0.14 357); /* bordes de control, 3:1 */
  --color-attention: oklch(0.75 0.13 80);    /* avisos suaves; nunca para carga ni fallos */
  --color-danger: oklch(0.55 0.19 30);       /* solo acciones destructivas; más anaranjado que primary */
  --font-sans: 'Nunito Variable', ui-rounded, -apple-system, sans-serif; /* empaquetada: funciona sin red */
  --radius-card: 1.5rem; --spacing: 0.25rem; /* escala de 4 px */
  --shadow-card: 0 0 0 1.5px var(--color-line), 0 8px 20px -12px var(--color-glow);
}
[data-theme='dark'] { --color-bg: oklch(0.19 0.03 345); --color-surface: oklch(0.24 0.035 345); --color-primary: oklch(0.8 0.12 355); /* … */ }
```
- Utilidades propias en `index.css`: `candy` (botón primario con sombra sólida que se hunde al tocarlo) y `press` (leve escala al tocar), ambas de 150 ms `ease-out` (UX6).
- Íconos en `ui/icons.tsx`, siempre decorativos (`aria-hidden`): el nombre lo da el texto visible o el `aria-label`.
- Tipografía en `rem`: 0.8125 (pie), 1 (cuerpo), 1.25 (contenido de tarjeta), 1.5 y 1.875 (títulos), con `line-height: 1.5`. Ningún `input` baja de 16 px, porque iOS hace zoom.
- Botones de calificación: `Otra vez` en tono neutro (`--color-muted`), y `Difícil`, `Bien` y `Fácil` en una escala de rosa (`blush`, `primary`, `primary/20`). **NO DEBE** usarse rojo para `Otra vez` (R19: fallar es esperable).
```tsx
// ❌ <button className="bg-red-600 text-[#fff]">Otra vez</button>
// ✅ <RatingButton rating={Rating.Again} />   // tokens internos, etiqueta por i18n
```

## 2. Mobile-first en iPhone

**UX2 · DEBE** diseñar primero para 390×844 en la PWA instalada. *Razón:* el uso principal es en iPhone con una mano.
- `viewport-fit=cover`, rellenos con `env(safe-area-inset-*)` y la barra de acciones por encima del indicador de inicio.
- Las pantallas principales (Hoy, Mazos, Exámenes, Tu semana, Ajustes) llevan una barra de pestañas abajo (`app/TabBar.tsx`); los flujos (estudiar, simulacro, editar) no, para enfocarse. La barra de acciones se apoya sobre ella con `--chrome-bottom`.
- Objetivos táctiles de al menos 44×44 px y 8 px de separación. Los botones de calificación forman una rejilla de 4 columnas de al menos 56 px de alto, en la zona del pulgar.
- Altura con `100dvh` (nunca `100vh`) y `touch-action: manipulation`. Nada que funcione solo con hover, y los gestos (deslizar) son siempre una alternativa a un botón visible.
- Teclado: en "escribir respuesta", el campo y "Comprobar" siguen visibles mediante `visualViewport`. El campo lleva `autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done"`, porque la terminología anatómica choca con el autocorrector.

## 3. Estados de carga, vacío, error y sin conexión

**UX3 · DEBE** dar a cada vista sus cuatro estados con un texto que diga qué pasa y qué se puede hacer. *Razón:* un estado vacío o un error mudos se leen como un fallo de ella.

| Estado | Regla | Ejemplo ✅ |
|---|---|---|
| Carga | Esqueleto solo si tarda más de 300 ms | — |
| Vacío | Ofrecer una acción | "No hay tarjetas pendientes. Puedes añadir nuevas o descansar." |
| Error | Qué pasó, más un botón para reintentar | "No se pudo generar el borrador. Tu texto sigue aquí. [Reintentar]" |
| Sin conexión | No es un error | "Sin conexión · tus repasos se guardan en este dispositivo" |

## 4. Accesibilidad

**UX4 · DEBE** cumplir WCAG 2.2 AA en ambos temas (contraste 4.5:1 en texto y 3:1 en controles), sin violaciones de axe en CI. *Razón:* también estudia con cansancio, poca luz o el texto agrandado.
- `lang="es"`, foco visible y orden de tabulación lógico. El resultado de revelar se anuncia con `aria-live="polite"`.
- Oclusión: la máscara que se pregunta tiene nombre accesible ("Etiqueta oculta 3 de 7") y es un botón que revela, igual que "Mostrar"; cuando hay que elegir la confianza antes (R6) se anuncia como imagen y no revela. Las demás se anuncian como "Otra etiqueta oculta", sin su nombre. La imagen tiene un `alt` que describe la estructura sin dar la respuesta.
- Editor de oclusión: dibujar con el dedo solo con "Dibujar" activado (si no, la página se desplaza normal); cada recuadro es un botón que se mueve con las flechas, cambia de tamaño con Mayús + flechas y se quita con Suprimir, y "Agregar recuadro" sirve sin puntero.
- El color nunca es la única señal (calificación = color + texto). Todo funciona con texto al 200 %.
- Con `prefers-reduced-motion`, las celebraciones y transiciones se quitan.

## 5. Modo oscuro

**UX5 · DEBE** ofrecer Sistema (por defecto), Claro y Oscuro, guardado en `UserSettings.ui`. **NO DEBE** invertir ni filtrar las imágenes anatómicas: se muestran sobre `--color-surface` con un borde. *Razón:* invertir cambia el significado de cortes, tinciones y colores de las láminas.

## 6. Microinteracciones

**UX6 · DEBE** usar transiciones de 150 a 250 ms con `ease-out`, sin bloquear la siguiente acción. Las celebraciones son suaves: duran 1.5 s como máximo, no tienen sonido por defecto, se pueden omitir y aparecen solo en hitos (subir de nivel, un logro), nunca en cada tarjeta. *Razón:* el ritmo de estudio no debe depender de la animación (R21: cuenta el tiempo entre respuestas).

## 7. Tono del texto en español

**UX7 · DEBE** usar tuteo neutro y frases sin género gramatical cuando se pueda ("Qué bueno verte de nuevo"), dar información sin juicios y nunca comparar con otras personas. *Razón:* R19 y §5.

| Situación | ✅ | ❌ |
|---|---|---|
| Carga | "Tienes 42 pendientes" | "Tienes 42 tarjetas atrasadas" |
| Fallo | "Con 90 % de retención, olvidar 1 de cada 10 es lo esperado." | "¡Fallaste!" |
| Regreso tras días (P8) | "Repartimos lo pendiente en los próximos días." | "Llevas 5 días sin estudiar" |
| Temporizador (R17) | "25/5 es el ritmo más estudiado con estudiantes; puedes cambiarlo." | "25/5, el ritmo científicamente óptimo" |
| Racha | "Racha en pausa" | "¡Perdiste tu racha!" |
| Sugerir parar (P6) | "Completaste lo de hoy. Dormir también ayuda a consolidar lo estudiado." | "¡No te detengas ahora!" |
| Bloque interrumpido (§3) | "Tu bloque se interrumpió. ¿Seguiste estudiando fuera de la app?" | "Abandonaste el bloque" |

**UX8 · DEBE** pasar `pnpm lint:copy` en todos los catálogos `es`. El script (`tools/lint-copy.ts`) busca sin distinguir mayúsculas ni acentos `atrasad`, `vencid`, `óptim`, `científicamente`, `racha (perdida|rota|en riesgo)`, `perdiste`, `fallaste`, `no rompas`, `ranking`, `clasificación`, `deberías`, `solo te quedan`, `te quedas atrás` y porcentajes de olvido (`olvidas? (el )?\d+ ?%`). Las excepciones van en `tools/lint-copy.allow.json` con clave y razón. *Razón:* R17, R19, R20 y §5, verificados de forma automática.

## 8. Métricas (§5, R20, R21)

**UX9 · DEBE** cumplir estas reglas en cada métrica visible. *Razón:* §5, R20 y R21.
- Ocultas hasta `metrics.minReviewsToShow` (100 repasos), con el texto "Pocos datos todavía".
- Cada una se puede apagar por separado en Ajustes, y se muestran por semana antes que por día.
- Se comparan solo con su propia línea base (sus `metrics.baselineWeeks` semanas previas), con un rango y sin colores de alarma.
- El uso de descansos (tomados, omitidos, extendidos) aparece solo en Ajustes (§5).
- Las tarjetas con muchos fallos aparecen como lista "Para mejorar", nunca como "fallos".
- La calibración se muestra como una frase semanal neutra ("Tu intuición frente a lo que pasó").
- El tiempo activo sale de los repasos (R21) y no tiene meta diaria.
- **NO DEBE** mostrarse ninguna cifra de olvido o de mejora sin enlace a su fuente primaria (R20); el componente `<SourceLink source={n} />` (`ui/SourceLink.tsx`, con el número de STUDY-METHODS) es obligatorio, también para los efectos que la app cita: el olvido esperado con la retención objetivo [21], los sets de contraste [7] [8], dormir y consolidar [29] y el ritmo 25/5 [22]. La prop no se llama `ref` porque React la reserva.

## 9. Gamificación (diseño; STUDY-METHODS no la investigó)

**UX10 · DEBE** depender de `gamification.enabled`. Se pregunta en el onboarding y queda apagada hasta que ella responda. Apagada no muestra XP, niveles, monedas, tienda, insignias, racha ni celebraciones; solo el resumen neutro de la sesión (§3). *Razón:* §6 advierte que no se evaluó el riesgo de la motivación extrínseca.
- **Onboarding:** mientras `enabled` es `null`, Hoy pregunta una sola vez "¿Quieres puntos, niveles y premios?" con dos botones iguales; la respuesta se cambia cuando quiera en Ajustes › Puntos y premios, junto con la racha y las celebraciones.
- **XP:** la misma cantidad por cada repaso respondido, sin importar la calificación (R19). Nunca por tiempo con la app abierta (R21). Cuenta cada `ReviewLog`, de cualquier tipo.
- **Niveles e insignias:** por conductas propias (primer simulacro, primer set de contraste), nunca por comparación con otras personas. El nivel n pide `levelCurve.baseXp × n^exponent` XP. Los logros son cinco primeras veces: repaso, ejercicio de aplicación, set de contraste, pregunta de simulacro y bloque de enfoque completado. Salen solo de logs de solo inserción (`ReviewLog`, `TimerBlockLog`), así no desaparecen al borrar algo ni difieren entre dispositivos.
- **Monedas y tienda:** los premios y sus costos los define ella (Premios y logros, `/rewards`). Canjear un premio es un `RewardRedemption` con la foto del nombre y el costo (editar o borrar el premio no cambia lo canjeado), pide confirmación y el saldo se calcula: `⌊XP × coinsPerXp⌋` menos lo canjeado (SYNC §1). Al canjear se revisa el saldo en ese dispositivo; dos canjes sin red en dos dispositivos pueden dejarlo negativo, y se muestra tal cual.
- **Racha:** opcional y apagada por defecto. Cuenta los días locales de ella con al menos un repaso. Un día sin estudiar la pone en pausa ("Racha en pausa: 12 días de estudio"), sin alarma, sin notificación, sin texto de pérdida y sin volver a cero.
- **Celebraciones** (`gamification.celebrations`): solo durante una sesión de estudio o un simulacro, al subir de nivel o ganar un logro (UX6). El resumen completo se calcula una vez al abrir la sesión en el worker y después se suman solo las respuestas nuevas (`progressAfter` en `srs`).
- XP, nivel, monedas, logros y racha son una proyección que no viaja: `gamificationSummary()` en `srs`, calculada en el worker (FRONTEND FE4) solo si la gamificación está activa.
- Los valores (`gamification.xpPerReview`, `coinsPerXp`, `levelCurve`) viven en configuración marcados `// diseño · sin evidencia` (AGENTS AG4).
- **NO DEBE** haber ranking, penalizaciones, cuentas regresivas, recompensas aleatorias, mensajes de pérdida ni "no te lo pierdas" (R19).
```ts
// ❌ const xp = rating >= Rating.Good ? 10 : 2;
// ✅ const xp = reviewsAnswered * cfg.gamification.xpPerReview;
```

## 10. Checklist de revisión

- [ ] ¿Algún color, tamaño o sombra literal en un componente (UX1)?
- [ ] ¿Rojo o lenguaje de alarma en `Otra vez`, en la carga o en métricas (UX1, UX7)?
- [ ] ¿Objetivos táctiles de al menos 44 px, safe areas, `100dvh` e inputs de 16 px (UX2)?
- [ ] ¿La vista tiene sus estados de carga, vacío, error y sin conexión (UX3)?
- [ ] ¿axe sin violaciones en ambos temas y movimiento reducido respetado (UX4, UX6)?
- [ ] ¿Las imágenes anatómicas se ven sin invertir en modo oscuro (UX5)?
- [ ] ¿`pnpm lint:copy` en verde (UX8)?
- [ ] ¿Métricas ocultas con pocos datos, desactivables y con fuente si citan un efecto (UX9)?
- [ ] ¿Algo de gamificación visible con `gamification.enabled = false`? ¿XP que depende del acierto (UX10)?
