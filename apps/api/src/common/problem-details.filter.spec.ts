import { ProblemDetailsSchema } from '@estudio/shared';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { describe, expect, it } from 'vitest';
import { DomainError } from './domain-error.js';
import { toProblem } from './problem-details.filter.js';

describe('toProblem (BACKEND BE5)', () => {
  it('DomainError → su código y estado', () => {
    const problem = toProblem(new DomainError('contract_outdated'), 'req-1');
    expect(problem).toMatchObject({ status: 426, code: 'contract_outdated', requestId: 'req-1' });
    expect(ProblemDetailsSchema.safeParse(problem).success).toBe(true);
  });

  it('incluye los issues de validación', () => {
    const problem = toProblem(new DomainError('validation_failed', { issues: [{ path: ['cursor'] }] }));
    expect(problem).toMatchObject({ status: 422, issues: [{ path: ['cursor'] }] });
  });

  it.each([
    [new NotFoundException(), 404, 'not_found'],
    [new ForbiddenException(), 403, 'forbidden'],
    [new ThrottlerException(), 429, 'rate_limited'],
  ])('HttpException %# → código estable', (exception, status, code) => {
    expect(toProblem(exception)).toMatchObject({ status, code });
  });

  it('un error desconocido es 500 internal y no filtra su mensaje', () => {
    const problem = toProblem(new Error('password=hunter2'));
    expect(problem).toMatchObject({ status: 500, code: 'internal' });
    expect(JSON.stringify(problem)).not.toContain('hunter2');
  });
});
