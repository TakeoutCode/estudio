import { PullQuerySchema } from '@estudio/shared';
import { describe, expect, it } from 'vitest';
import { DomainError } from './domain-error.js';
import { ZodPipe } from './zod.pipe.js';

describe('ZodPipe (BACKEND BE3)', () => {
  const pipe = new ZodPipe(PullQuerySchema);

  it('devuelve el valor ya transformado por el esquema', () => {
    expect(pipe.transform({ cursor: '42', limit: '10' })).toEqual({ cursor: '42', limit: 10 });
  });

  it('lanza validation_failed con los issues', () => {
    const thrown = (() => {
      try {
        pipe.transform({ cursor: 'abc' });
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(thrown).toBeInstanceOf(DomainError);
    expect(thrown).toMatchObject({ code: 'validation_failed' });
    expect((thrown as DomainError).details.issues?.length).toBeGreaterThan(0);
  });
});
