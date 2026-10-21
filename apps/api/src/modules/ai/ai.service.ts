import {
  AI_DRAFTS_MAX,
  type AiDraftRequest,
  type AiDraftResponse,
  type AiNoteDraft,
  AiNoteDraftSchema,
  localDateOf,
  ProfileSettingsSchema,
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
    return this.run(
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

  private async run<T>(userId: string, task: AiTask, parse: (output: unknown) => T | null): Promise<T> {
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
    this.metrics.recordAiBudget(this.clock.now(), share);
  }
}
