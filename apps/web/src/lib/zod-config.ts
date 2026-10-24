// QUALITY §6: la CSP de Vercel no permite `eval`. Sin esto, zod lo prueba con `Function('')` al
// armar el primer esquema de objeto y cada carga deja una violación de CSP en la consola (también
// en el worker de proyección). zod lee su configuración de este global y solo lo crea si falta,
// así que se fija sin importar zod: va primero en `main.tsx` y en `projection.worker.ts`, antes
// de que se arme cualquier esquema, y no agranda el JS inicial (FRONTEND FE9).
// Se modifica el objeto y no se reemplaza: si zod ya cargó, guarda una referencia a él.
const holder = globalThis as { __zod_globalConfig?: Record<string, unknown> };
holder.__zod_globalConfig ??= {};
holder.__zod_globalConfig.jitless = true;
