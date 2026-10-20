import { z } from 'zod';

// Gamificación (UI-UX UX10). STUDY-METHODS no la investigó (§6): todo aquí es
// "diseño · sin evidencia" y debe poder apagarse por completo.

export const GamificationConfigSchema = z.object({
  /** `null` = aún no responde en el onboarding; cuenta como apagada (UX10). */
  enabled: z.boolean().nullable().default(null),
  streakEnabled: z.boolean().default(false), // UX10: opcional y apagada por defecto; se pausa, no se rompe
  celebrations: z.boolean().default(true), // UX6: suaves y omitibles
  xpPerReview: z.number().int().min(1).max(100).default(10), // diseño · igual sin importar la calificación (R19)
  coinsPerXp: z.number().min(0).max(1).default(0.1), // diseño · sin evidencia
  levelCurve: z
    .object({
      baseXp: z.number().int().min(10).max(10_000).default(100), // diseño · XP del nivel n = baseXp × n^exponent
      exponent: z.number().min(1).max(3).default(1.5), // diseño · sin evidencia
    })
    .prefault({}),
});

export type GamificationConfig = z.output<typeof GamificationConfigSchema>;

/** La gamificación solo se muestra si ella la activó explícitamente. */
export const isGamificationOn = (config: GamificationConfig): boolean => config.enabled === true;
