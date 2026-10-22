import {
  AI_CASES_MAX,
  type AiClinicalCaseDraft,
  AiClinicalCaseDraftSchema,
  type AiClinicalCasesResponse,
  type AiDraftRequest,
} from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AiService } from '../ai/ai.service.js';
import { strictJsonSchema } from '../ai/strict-json-schema.js';

/** LD17: 5 casos de hasta 6 subpreguntas caben con margen. Parámetro de costo. */
const CLINICAL_CASES_MAX_OUTPUT_TOKENS = 10_000;

const CLINICAL_CASES_SCHEMA = strictJsonSchema(
  z.object({ drafts: z.array(AiClinicalCaseDraftSchema) }).strict(),
);

/**
 * LD14, LD16: casos para aplicar lo que dice su texto. El paciente es inventado, pero lo que se
 * pregunta y se responde sale del texto, con una cita literal que lo respalde.
 */
const CLINICAL_CASES_INSTRUCTIONS = [
  'Propones casos clínicos breves para que una estudiante de Quiropráctica aplique lo que dice el texto que ella pega.',
  'vignette: un paciente ficticio (edad, motivo de consulta, hallazgos), sin nombres ni datos de personas reales.',
  'Lo que se pregunta y lo que se responde tiene que salir del texto; no agregues datos anatómicos ni clínicos de otra fuente.',
  'questions: de 1 a 4 subpreguntas que se responden con el caso y el texto. Tipos:',
  'multiple_choice (options con 3 a 5 opciones que incluyen la correcta tal cual; answer es la correcta tal cual);',
  'type_answer (answer es una respuesta breve de pocas palabras, options null);',
  'open (answer es la clave: lo que una buena respuesta tendría que cubrir, options null).',
  'explanation: hasta 400 caracteres con el porqué, según el texto.',
  'En sourceQuote copia literal, sin cambiar ninguna palabra, la oración o frase del texto que respalda las respuestas.',
  'Escribe en español neutro y sin juicios. Como máximo 5 casos.',
  'Si el texto no alcanza para un caso clínico, devuelve una lista vacía.',
].join('\n');

/** La salida del modelo, caso por caso: los inválidos se descartan y se cuentan (LD17). */
function parseClinicalCases(output: unknown): AiClinicalCasesResponse | null {
  const shape = z.object({ drafts: z.array(z.unknown()) }).safeParse(output);
  if (!shape.success) return null;
  const valid: AiClinicalCaseDraft[] = [];
  for (const item of shape.data.drafts) {
    const parsed = AiClinicalCaseDraftSchema.safeParse(item);
    if (parsed.success) valid.push(parsed.data);
  }
  const drafts = valid.slice(0, AI_CASES_MAX);
  return { drafts, discarded: shape.data.drafts.length - drafts.length };
}

/**
 * LEARNING-DESIGN §8: borradores de casos clínicos (LD §2). Como los de notas, nunca se guardan
 * como nota aquí: la app los guarda como AiDraft para que ella los revise (LD16).
 */
@Injectable()
export class ClinicalCaseDraftsService {
  constructor(private readonly ai: AiService) {}

  draft(userId: string, { sourceText }: AiDraftRequest): Promise<AiClinicalCasesResponse> {
    return this.ai.generate(
      userId,
      {
        name: 'clinical_case_drafts',
        instructions: CLINICAL_CASES_INSTRUCTIONS,
        input: sourceText,
        schema: CLINICAL_CASES_SCHEMA,
        maxOutputTokens: CLINICAL_CASES_MAX_OUTPUT_TOKENS,
      },
      parseClinicalCases,
    );
  }
}
