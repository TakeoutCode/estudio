import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { AppConfig } from '../../config/app-config.js';

/** Un pedido al modelo: instrucciones, el texto de ella y la forma exacta de la salida (LD15). */
export interface AiTask {
  /** Nombre del formato (letras, números y guiones bajos). */
  readonly name: string;
  readonly instructions: string;
  readonly input: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly maxOutputTokens: number;
}

export interface AiUsageCount {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * Resultado de un intento. `refused`: el modelo se negó; `invalid`: salida cortada o que no es
 * JSON; `timeout`: pasaron 30 s; `error`: el servicio falló. Nunca lleva el texto de ella.
 */
export type AiResult =
  | ({ readonly status: 'ok'; readonly output: unknown; readonly model: string } & AiUsageCount)
  | ({ readonly status: 'refused' | 'invalid' | 'timeout' | 'error'; readonly model: string } & AiUsageCount);

/** BACKEND BE13: puerto hacia el proveedor de IA; las pruebas usan uno falso, sin red ni costo. */
export abstract class AiProvider {
  /** false sin `OPENAI_API_KEY`: /ai/* responde 503 (la captura manual sigue). */
  abstract readonly configured: boolean;
  abstract run(task: AiTask): Promise<AiResult>;
}

/** BE13: 30 s de timeout (LD17); reintentos solo ante 429/5xx, con espera creciente. */
const TIMEOUT_MS = 30_000;
const RETRIES = 2;
const BACKOFF_MS = 1000;

const ResponseSchema = z.object({
  status: z.string().optional(),
  output: z
    .array(
      z.object({
        type: z.string(),
        content: z
          .array(z.object({ type: z.string(), text: z.string().optional(), refusal: z.string().optional() }))
          .optional(),
      }),
    )
    .default([]),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * OpenAI con la API de Responses y salida estructurada estricta (ADR-011). `store: false`: lo
 * que ella pega no queda guardado en OpenAI. BE6: el log no lleva prompts ni respuestas.
 */
@Injectable()
export class OpenAiProvider extends AiProvider {
  private readonly logger = new Logger(OpenAiProvider.name);
  private readonly key: string | undefined;
  private readonly model: string;
  readonly configured: boolean;

  constructor(config: AppConfig) {
    super();
    this.key = config.get('OPENAI_API_KEY');
    this.model = config.get('OPENAI_MODEL') ?? '';
    this.configured = this.key !== undefined && this.model !== '';
  }

  async run(task: AiTask): Promise<AiResult> {
    const none = { model: this.model, inputTokens: 0, outputTokens: 0 };
    if (!this.key) return { status: 'error', ...none };
    let res: Response;
    try {
      res = await this.call(this.key, task);
    } catch (error: unknown) {
      const timedOut =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return { status: timedOut ? 'timeout' : 'error', ...none };
    }
    if (!res.ok) {
      this.logger.warn({ status: res.status }, 'La IA respondió con error');
      return { status: 'error', ...none };
    }
    const body = ResponseSchema.safeParse(await res.json().catch(() => null));
    if (!body.success) return { status: 'invalid', ...none };
    const usage = {
      model: this.model,
      inputTokens: body.data.usage?.input_tokens ?? 0,
      outputTokens: body.data.usage?.output_tokens ?? 0,
    };
    const parts = body.data.output.flatMap((item) => (item.type === 'message' ? (item.content ?? []) : []));
    if (parts.some((part) => part.type === 'refusal')) return { status: 'refused', ...usage };
    if (body.data.status !== 'completed') return { status: 'invalid', ...usage };
    const text = parts.find((part) => part.type === 'output_text')?.text;
    if (text === undefined) return { status: 'invalid', ...usage };
    try {
      return { status: 'ok', output: JSON.parse(text) as unknown, ...usage };
    } catch {
      return { status: 'invalid', ...usage };
    }
  }

  private async call(key: string, task: AiTask): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          instructions: task.instructions,
          input: [{ role: 'user', content: task.input }],
          text: { format: { type: 'json_schema', name: task.name, schema: task.schema, strict: true } },
          max_output_tokens: task.maxOutputTokens,
          store: false,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= RETRIES) return res;
      await wait(BACKOFF_MS * 2 ** attempt);
    }
  }
}
