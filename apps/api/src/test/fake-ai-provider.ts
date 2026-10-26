import { AiProvider, type AiResult, type AiTask } from '../modules/ai/ai-provider.js';

/**
 * BACKEND BE13, QUALITY §1: el proveedor de IA de las pruebas de integración. Responde lo que la
 * prueba le encola, en orden, sin red ni costo; sin nada encolado, falla como un 5xx.
 */
export class FakeAiProvider extends AiProvider {
  readonly configured = true;
  readonly tasks: AiTask[] = [];
  private readonly queue: AiResult[] = [];

  reply(...results: AiResult[]): void {
    this.queue.push(...results);
  }

  run(task: AiTask): Promise<AiResult> {
    this.tasks.push(task);
    return Promise.resolve(
      this.queue.shift() ?? { status: 'error', model: 'falso', inputTokens: 0, outputTokens: 0 },
    );
  }
}

export const aiOk = (output: unknown): AiResult => ({
  status: 'ok',
  output,
  model: 'modelo-de-pruebas',
  inputTokens: 120,
  outputTokens: 80,
});
