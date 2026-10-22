import { AiClinicalCaseDraftSchema } from '@estudio/shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AiService } from '../ai/ai.service.js';
import type { AiTask } from '../ai/ai-provider.js';
import { strictJsonSchema } from '../ai/strict-json-schema.js';
import { ClinicalCaseDraftsService } from './clinical-case-drafts.service.js';

const USER = '0192f1a0-0000-7000-8000-00000000c0de';

const clinicalCase = {
  vignette: 'Paciente de 34 años con debilidad para abducir el brazo tras una luxación anterior del hombro.',
  questions: [
    { type: 'type_answer', question: '¿Qué músculo pierde fuerza?', answer: 'Deltoides', options: null },
  ],
  explanation: 'El axilar inerva el deltoides.',
  sourceQuote: 'El deltoides está inervado por el nervio axilar',
};

/** Un AiService falso que entrega la salida del modelo al `parse` del service, como el real. */
function setup(output: unknown) {
  const generate = vi.fn((_userId: string, _task: AiTask, parse: (o: unknown) => unknown) =>
    Promise.resolve(parse(output)),
  );
  const service = new ClinicalCaseDraftsService({ generate } as unknown as AiService);
  return { service, generate };
}

describe('LD14-LD17: borradores de casos clínicos', () => {
  it('manda su texto con el esquema estricto del caso (LD15)', async () => {
    const { service, generate } = setup({ drafts: [clinicalCase] });
    await service.draft(USER, { sourceText: 'El deltoides está inervado por el nervio axilar.' });
    const [userId, task] = generate.mock.calls[0] ?? [];
    expect(userId).toBe(USER);
    expect(task?.name).toBe('clinical_case_drafts');
    expect(task?.input).toBe('El deltoides está inervado por el nervio axilar.');
    expect(task?.schema).toEqual(
      strictJsonSchema(z.object({ drafts: z.array(AiClinicalCaseDraftSchema) }).strict()),
    );
    expect(task?.instructions).toMatch(/paciente ficticio/);
    expect(task?.instructions).toMatch(/sourceQuote copia literal/);
  });

  it('LD17: devuelve los válidos (hasta 5) y cuenta los descartados', async () => {
    const invalid = { ...clinicalCase, questions: [] };
    const { service } = setup({
      drafts: [clinicalCase, invalid, ...Array.from({ length: 5 }, () => clinicalCase)],
    });
    expect(await service.draft(USER, { sourceText: 'texto' })).toEqual({
      drafts: Array.from({ length: 5 }, () => clinicalCase),
      discarded: 2,
    });
  });

  it('una salida de otra forma no sirve: el service de IA reintenta', async () => {
    const { service } = setup({ casos: [] });
    expect(await service.draft(USER, { sourceText: 'texto' })).toBeNull();
  });
});
