import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
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
}
