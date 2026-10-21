import { type ClientErrorReport, CLIENT_ERROR_LIMITS, redactErrorText, redactRoute } from '@estudio/shared';
import { Injectable, Logger } from '@nestjs/common';

/**
 * FE13, QA8: los errores del cliente van a los logs JSON (pino) con su `userId`. No se guardan
 * en la base. Se vuelven a filtrar aquí, por si llega un cliente viejo o modificado (BE6).
 */
@Injectable()
export class DiagnosticsService {
  private readonly logger = new Logger('ClientError');

  report(userId: string, { errors }: ClientErrorReport): void {
    for (const error of errors) {
      this.logger.warn(
        {
          userId,
          clientError: {
            id: error.id,
            message: redactErrorText(error.message, CLIENT_ERROR_LIMITS.messageMax),
            stack: error.stack === null ? null : redactErrorText(error.stack, CLIENT_ERROR_LIMITS.stackMax),
            route: redactRoute(error.route),
            appVersion: error.appVersion,
            occurredAt: error.occurredAt,
          },
        },
        'Error en el cliente',
      );
    }
  }
}
