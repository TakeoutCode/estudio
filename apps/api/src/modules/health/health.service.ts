import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/domain-error.js';
import { HealthRepository } from './health.repository.js';

export interface HealthStatus {
  readonly status: 'ok';
}

@Injectable()
export class HealthService {
  constructor(private readonly repo: HealthRepository) {}

  /** QUALITY QA8: 503 si la base no responde. */
  async check(): Promise<HealthStatus> {
    try {
      await this.repo.ping();
    } catch {
      throw new DomainError('unavailable');
    }
    return { status: 'ok' };
  }
}
