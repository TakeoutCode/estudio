import { type ClientErrorReport, ClientErrorReportSchema } from '@estudio/shared';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ZodPipe } from '../../common/zod.pipe.js';
import { type AuthUser, CurrentUser } from '../auth/current-user.js';
import { DiagnosticsService } from './diagnostics.service.js';

/** FRONTEND FE13 y ADR-016: errores del cliente, ya filtrados, a los logs de la API. */
@Controller('diagnostics')
export class DiagnosticsController {
  constructor(private readonly diagnostics: DiagnosticsService) {}

  /** El cliente manda hasta 20 al día; esto solo frena un bucle que se descontrole. */
  @Post('errors')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  report(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(ClientErrorReportSchema)) body: ClientErrorReport,
  ): void {
    this.diagnostics.report(user.id, body);
  }
}
