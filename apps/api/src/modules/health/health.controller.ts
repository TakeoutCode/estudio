import type { HealthChecks } from '@estudio/shared';
import { Controller, Get, Param, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { SkipContractCheck } from '../../common/contract.guard.js';
import { Public } from '../auth/public.js';
import { HealthService, type HealthStatus } from './health.service.js';

@Controller('health')
@Public()
@SkipContractCheck()
@SkipThrottle()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check(): Promise<HealthStatus> {
    return this.health.check();
  }

  /** QUALITY QA8: 503 con los nombres de lo que falla, para el monitor de disponibilidad. */
  @Get('checks/:token')
  async checks(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthChecks> {
    const result = await this.health.checks(token);
    if (result.status === 'failing') res.status(503);
    return result;
  }
}
