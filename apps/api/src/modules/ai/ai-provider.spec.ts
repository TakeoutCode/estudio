import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../config/app-config.js';
import { OpenAiProvider, type AiTask } from './ai-provider.js';

const config = (values: Record<string, unknown>) =>
  ({ get: (key: string) => values[key] }) as unknown as AppConfig;
const provider = () =>
  new OpenAiProvider(config({ OPENAI_API_KEY: 'sk-prueba', OPENAI_MODEL: 'modelo-prueba' }));

const task: AiTask = {
  name: 'note_drafts',
  instructions: 'Instrucciones',
  input: 'El deltoides está inervado por el nervio axilar.',
  schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  maxOutputTokens: 100,
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const message = (content: unknown[], status = 'completed') => ({
  status,
  output: [{ type: 'reasoning' }, { type: 'message', content }],
  usage: { input_tokens: 120, output_tokens: 40 },
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('OpenAiProvider (ADR-011, BE13)', () => {
  it('sin clave no está configurado y no llama a nadie', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const none = new OpenAiProvider(config({}));
    expect(none.configured).toBe(false);
    expect((await none.run(task)).status).toBe('error');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('pide salida estricta, sin guardar el texto en OpenAI, y devuelve el JSON con los tokens', async () => {
    const fetch = vi.fn().mockResolvedValue(reply(message([{ type: 'output_text', text: '{"drafts":[]}' }])));
    vi.stubGlobal('fetch', fetch);
    expect(await provider().run(task)).toEqual({
      status: 'ok',
      output: { drafts: [] },
      model: 'modelo-prueba',
      inputTokens: 120,
      outputTokens: 40,
    });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sk-prueba');
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'modelo-prueba',
      instructions: 'Instrucciones',
      store: false,
      max_output_tokens: 100,
      text: { format: { type: 'json_schema', name: 'note_drafts', strict: true } },
    });
  });

  it('rechazo, salida cortada o que no es JSON no pasan como respuesta', async () => {
    const cases: [unknown, string][] = [
      [message([{ type: 'refusal', refusal: 'No puedo' }]), 'refused'],
      [message([{ type: 'output_text', text: '{"drafts":[' }], 'incomplete'), 'invalid'],
      [message([{ type: 'output_text', text: 'no es json' }]), 'invalid'],
      [{ algo: 'raro' }, 'invalid'],
    ];
    for (const [body, status] of cases) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(body)));
      expect((await provider().run(task)).status).toBe(status);
    }
  });

  it('BE13: reintenta un 429 o 5xx con espera; un 4xx no', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(reply({}, 429))
      .mockResolvedValueOnce(reply({}, 503))
      .mockResolvedValueOnce(reply(message([{ type: 'output_text', text: '{"drafts":[]}' }])));
    vi.stubGlobal('fetch', fetch);
    const pending = provider().run(task);
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe('ok');
    expect(fetch).toHaveBeenCalledTimes(3);

    const bad = vi.fn().mockResolvedValue(reply({}, 400));
    vi.stubGlobal('fetch', bad);
    expect((await provider().run(task)).status).toBe('error');
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it('LD17: a los 30 s sin respuesta es timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('tardó', 'TimeoutError')));
    expect((await provider().run(task)).status).toBe('timeout');
  });
});
