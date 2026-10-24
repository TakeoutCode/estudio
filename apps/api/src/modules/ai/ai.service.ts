import {
  AI_DRAFTS_MAX,
  type AiDistractorsRequest,
  type AiDistractorsResponse,
  type AiDraftRequest,
  type AiDraftResponse,
  type AiExplanationCheck,
  type AiExplanationCheckRequest,
  AiExplanationCheckSchema,
  type AiFeedbackRequest,
  type AiOpenFeedback,
  AiOpenFeedbackSchema,
  type AiNoteDraft,
  AiNoteDraftSchema,
  localDateOf,
  ProfileSettingsSchema,
  usableDistractors,
} from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Clock } from '../../common/clock.js';
import { DomainError } from '../../common/domain-error.js';
import { AppConfig } from '../../config/app-config.js';
import { HealthMetrics } from '../health/health-metrics.js';
import { AiProvider, type AiTask } from './ai-provider.js';
import { AiRepository } from './ai.repository.js';
import { strictJsonSchema } from './strict-json-schema.js';

/** LD17: un reintento ante rechazo, timeout o salida inválida; luego, error con su texto intacto. */
const ATTEMPTS = 2;
/** LD17: `max_output_tokens` explícito; 20 borradores caben con margen. Parámetro de costo. */
const NOTE_DRAFTS_MAX_OUTPUT_TOKENS = 8000;

const NOTE_DRAFTS_SCHEMA = strictJsonSchema(z.object({ drafts: z.array(AiNoteDraftSchema) }).strict());

/** LD14, LD16: solo lo que dice su texto, con una cita literal que lo respalde. */
const NOTE_DRAFTS_INSTRUCTIONS = [
  'Propones tarjetas de estudio para una estudiante de Quiropráctica a partir del texto que ella pega.',
  'Usa solo información que esté en el texto; no agregues datos anatómicos ni clínicos de otra fuente.',
  'En sourceQuote copia literal, sin cambiar ninguna palabra, la oración o frase del texto que respalda la tarjeta.',
  'Tipos: basic (pregunta breve en front y respuesta breve en back, options null);',
  'cloze (front con el texto y los huecos como {{c1::palabra}}, back con lo que se oculta, options null);',
  'multiple_choice (pregunta en front, opción correcta en back, options con 3 a 5 opciones que incluyen la correcta tal cual y distractores plausibles del mismo tema).',
  'explanation: hasta 400 caracteres con el porqué, según el texto.',
  'Escribe en español neutro y sin juicios. Como máximo 20 tarjetas; prioriza los conceptos clave.',
  'Si el texto no tiene contenido para estudiar, devuelve una lista vacía.',
].join('\n');

/** LD17: 8 puntos por lista y una sugerencia caben con margen. Parámetro de costo. */
const FEEDBACK_MAX_OUTPUT_TOKENS = 2000;

const FEEDBACK_SCHEMA = strictJsonSchema(AiOpenFeedbackSchema);

/** LD14, LD15: frente a su propia clave, sin nota ni puntaje; la calificación es de ella. */
const FEEDBACK_INSTRUCTIONS = [
  'Comparas la respuesta abierta de una estudiante de Quiropráctica con la clave que ella misma escribió.',
  'covered: puntos de la clave que su respuesta cubre. missing: puntos de la clave que le faltan.',
  'misconceptions: afirmaciones de su respuesta que contradicen la clave.',
  'suggestion: una sola sugerencia breve y concreta para la próxima vez.',
  'No pongas nota, puntaje ni calificación: la calificación es de ella.',
  'Usa solo la pregunta y la clave como referencia; no agregues datos de otra fuente.',
  'Escribe en español neutro, en frases breves, sin juicios ni culpa. Deja vacías las listas que no apliquen.',
].join('\n');

/** LD17: un veredicto, 8 puntos por lista y una sugerencia caben con margen. Parámetro de costo. */
const EXPLANATION_MAX_OUTPUT_TOKENS = 2000;

const EXPLANATION_SCHEMA = strictJsonSchema(AiExplanationCheckSchema);

/**
 * LD14 (decisión del responsable, 2026-10-23): si su autoexplicación de una tarjeta que olvidó es
 * correcta frente a la clave de la tarjeta. El veredicto no toca FSRS: la calificación ya es suya.
 */
const EXPLANATION_INSTRUCTIONS = [
  'Revisas la explicación que una estudiante de Quiropráctica escribió con sus palabras sobre una tarjeta que acaba de olvidar.',
  'Compárala con la clave: la respuesta y la explicación de la tarjeta, que escribió ella misma.',
  'verdict: correct si lo que explica es correcto y cubre lo esencial de la clave; partial si es correcto pero le falta algo esencial;',
  'incorrect si afirma algo que contradice la clave.',
  'missing: lo esencial de la clave que no menciona. misconceptions: lo que afirma y contradice la clave.',
  'suggestion: una sola sugerencia breve y concreta para recordarla mejor la próxima vez.',
  'Usa solo la pregunta y la clave como referencia; no agregues datos de otra fuente. No pongas nota ni puntaje.',
  'Escribe en español neutro, en frases breves, sin juicios ni culpa. Deja vacías las listas que no apliquen.',
].join('\n');

/** LD17: 4 opciones breves caben con margen. Parámetro de costo. */
const DISTRACTORS_MAX_OUTPUT_TOKENS = 600;

/** La forma que se le pide al modelo; lo que sirve lo filtra `usableDistractors`. */
const DistractorsOutputSchema = z.object({ distractors: z.array(z.string()) }).strict();
const DISTRACTORS_SCHEMA = strictJsonSchema(DistractorsOutputSchema);

/**
 * LD14: distractores para su pregunta. A diferencia de los borradores, salen del conocimiento
 * general del modelo (son opciones incorrectas): por eso ella elige cada uno y la app le pide
 * revisar que ninguno sea también correcto (LD16).
 */
const DISTRACTORS_INSTRUCTIONS = [
  'Propones distractores para una pregunta de opción múltiple que escribió una estudiante de Quiropráctica.',
  'Un distractor es una opción incorrecta pero plausible: del mismo tema y de la misma categoría que la correcta',
  '(si la correcta es un nervio, otros nervios cercanos o que se confunden), con largo y estilo parecidos.',
  'Cada distractor tiene que ser claramente incorrecto para esa pregunta; si dudas de uno, no lo incluyas.',
  'No repitas la opción correcta ni las otras opciones que ella ya escribió, ni con otras palabras.',
  'Nunca uses "todas las anteriores", "ninguna de las anteriores" ni combinaciones de opciones.',
  'Escribe en español neutro, solo el texto de cada opción. Propón 4.',
].join('\n');

/** La salida del modelo, ítem por ítem: los inválidos se descartan y se cuentan (LD17). */
function parseNoteDrafts(output: unknown): AiDraftResponse | null {
  const shape = z.object({ drafts: z.array(z.unknown()) }).safeParse(output);
  if (!shape.success) return null;
  const valid: AiNoteDraft[] = [];
  for (const item of shape.data.drafts) {
    const parsed = AiNoteDraftSchema.safeParse(item);
    if (parsed.success) valid.push(parsed.data);
  }
  const drafts = valid.slice(0, AI_DRAFTS_MAX);
  return { drafts, discarded: shape.data.drafts.length - drafts.length };
}

/**
 * LEARNING-DESIGN §8: la IA propone, ella decide. Este service nunca escribe notas: devuelve
 * borradores validados que la app guarda como AiDraft para que ella los revise (LD16).
 * BE7: la llamada al modelo no corre dentro de una transacción.
 */
@Injectable()
export class AiService {
  constructor(
    private readonly repo: AiRepository,
    private readonly provider: AiProvider,
    private readonly metrics: HealthMetrics,
    private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  async draftNotes(userId: string, { sourceText }: AiDraftRequest): Promise<AiDraftResponse> {
    return this.generate(
      userId,
      {
        name: 'note_drafts',
        instructions: NOTE_DRAFTS_INSTRUCTIONS,
        input: sourceText,
        schema: NOTE_DRAFTS_SCHEMA,
        maxOutputTokens: NOTE_DRAFTS_MAX_OUTPUT_TOKENS,
      },
      parseNoteDrafts,
    );
  }

  /** LD14: retroalimentación de una respuesta abierta; no toca FSRS ni califica. */
  async feedback(userId: string, request: AiFeedbackRequest): Promise<AiOpenFeedback> {
    return this.generate(
      userId,
      {
        name: 'open_feedback',
        instructions: FEEDBACK_INSTRUCTIONS,
        input: `Pregunta:\n${request.question}\n\nClave:\n${request.key}\n\nSu respuesta:\n${request.answer}`,
        schema: FEEDBACK_SCHEMA,
        maxOutputTokens: FEEDBACK_MAX_OUTPUT_TOKENS,
      },
      (output) => {
        const parsed = AiOpenFeedbackSchema.safeParse(output);
        return parsed.success ? parsed.data : null;
      },
    );
  }

  /** LD14: si su autoexplicación tras un fallo es correcta; no toca FSRS ni califica la tarjeta. */
  async checkExplanation(userId: string, request: AiExplanationCheckRequest): Promise<AiExplanationCheck> {
    return this.generate(
      userId,
      {
        name: 'explanation_check',
        instructions: EXPLANATION_INSTRUCTIONS,
        input: `Pregunta:\n${request.question}\n\nClave:\n${request.key}\n\nSu explicación:\n${request.explanation}`,
        schema: EXPLANATION_SCHEMA,
        maxOutputTokens: EXPLANATION_MAX_OUTPUT_TOKENS,
      },
      (output) => {
        const parsed = AiExplanationCheckSchema.safeParse(output);
        return parsed.success ? parsed.data : null;
      },
    );
  }

  /** LD14: distractores para su pregunta de opción múltiple; ella elige cuáles usa (LD16). */
  async distractors(userId: string, request: AiDistractorsRequest): Promise<AiDistractorsResponse> {
    const parts = [
      ...(request.context === null ? [] : [`Caso:\n${request.context}`]),
      `Pregunta:\n${request.question}`,
      `Opción correcta:\n${request.correct}`,
      ...(request.existing.length === 0
        ? []
        : [`Otras opciones que ya escribió:\n${request.existing.join('\n')}`]),
    ];
    return this.generate(
      userId,
      {
        name: 'distractors',
        instructions: DISTRACTORS_INSTRUCTIONS,
        input: parts.join('\n\n'),
        schema: DISTRACTORS_SCHEMA,
        maxOutputTokens: DISTRACTORS_MAX_OUTPUT_TOKENS,
      },
      (output) => {
        const shape = DistractorsOutputSchema.safeParse(output);
        if (!shape.success) return null;
        const distractors = usableDistractors(shape.data.distractors, request);
        // LD17: si ninguno sirve, la salida es inválida y se reintenta una vez.
        return distractors.length > 0 ? { distractors } : null;
      },
    );
  }

  /**
   * LD17: cuota del día, un reintento y registro de uso sin contenido. `parse` valida la salida
   * con zod (LD15) y devuelve null si no sirve. También lo usan los casos clínicos (`exercises`).
   */
  async generate<T>(userId: string, task: AiTask, parse: (output: unknown) => T | null): Promise<T> {
    if (!this.provider.configured) throw new DomainError('unavailable');
    const localDate = await this.localDate(userId);
    const before = await this.repo.usageOn(userId, localDate);
    if (
      before.requests >= this.config.get('AI_DAILY_REQUESTS') ||
      before.tokens >= this.config.get('AI_DAILY_TOKENS')
    ) {
      throw new DomainError('ai_quota_exceeded');
    }
    try {
      for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
        const started = this.clock.now();
        const result = await this.provider.run(task);
        const parsed = result.status === 'ok' ? parse(result.output) : null;
        await this.repo.recordUsage({
          userId,
          localDate,
          task: task.name,
          attempt,
          model: result.model,
          status: result.status === 'ok' && parsed === null ? 'invalid' : result.status,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: this.clock.now() - started,
        });
        if (parsed !== null) return parsed;
      }
      throw new DomainError('unavailable');
    } finally {
      await this.reportBudget(userId, localDate);
    }
  }

  /** AG6: la cuota es por día local de ella, con la zona de sus ajustes. */
  private async localDate(userId: string): Promise<string> {
    const profile = ProfileSettingsSchema.safeParse(await this.repo.profileOf(userId));
    const timeZone = profile.success ? profile.data.timeZone : ProfileSettingsSchema.parse({}).timeZone;
    return localDateOf(this.clock.now(), timeZone);
  }

  /** QA8: qué parte de su cuota del día ya se usó, para el chequeo del gasto de IA. */
  private async reportBudget(userId: string, localDate: string): Promise<void> {
    const used = await this.repo.usageOn(userId, localDate);
    const share = Math.max(
      used.requests / this.config.get('AI_DAILY_REQUESTS'),
      used.tokens / this.config.get('AI_DAILY_TOKENS'),
    );
    await this.metrics.recordAiBudget(this.clock.now(), share);
  }
}
