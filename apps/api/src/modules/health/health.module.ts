import { Module } from '@nestjs/common';
import { DiagnosticsController } from './diagnostics.controller.js';
import { DiagnosticsService } from './diagnostics.service.js';
import { HealthMetrics } from './health-metrics.js';
import { HealthController } from './health.controller.js';
import { HealthRepository } from './health.repository.js';
import { HealthService } from './health.service.js';

/** QUALITY QA8 y FRONTEND FE13. `HealthMetrics` lo alimentan sync y notifications. */
@Module({
  controllers: [HealthController, DiagnosticsController],
  providers: [HealthService, HealthRepository, HealthMetrics, DiagnosticsService],
  exports: [HealthMetrics],
})
export class HealthModule {}
