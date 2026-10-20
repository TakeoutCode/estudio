import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { DomainError } from './domain-error.js';

/**
 * Valida cuerpo o query con un esquema de `@estudio/shared` (BACKEND BE3, ADR-012).
 * Uso: `@Body(new ZodPipe(PushRequestSchema)) body: PushRequest`.
 */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) throw new DomainError('validation_failed', { issues: result.error.issues });
    return result.data;
  }
}
