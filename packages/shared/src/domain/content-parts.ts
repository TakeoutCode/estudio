import { z } from 'zod';

// Piezas comunes del contenido de notas y ejercicios (LEARNING-DESIGN §1 y §2).

/** LD4: la explicación breve que se muestra tras cada intento (R4). */
export const EXPLANATION_MAX_LENGTH = 400;

export const text = (max: number) => z.string().trim().min(1).max(max);

export const explanation = () => z.string().trim().max(EXPLANATION_MAX_LENGTH);
