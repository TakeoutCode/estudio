import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import { z } from 'zod';
import { AppConfig } from '../config/app-config.js';

const RESPONSE_SCHEMA = 'estudio:responseSchema';

/** BE3: el esquema de `shared` que cumple el cuerpo de la respuesta de esta ruta. */
export const ResponseSchema = (schema: z.ZodType) => SetMetadata(RESPONSE_SCHEMA, schema);

/**
 * BACKEND BE3: en `NODE_ENV=test` valida cada respuesta contra su `@ResponseSchema`, y una ruta
 * que responde un cuerpo sin declararlo falla. Así una prueba de integración no puede pasar con
 * un contrato que la web rechazaría. Fuera de las pruebas no hace nada.
 */
@Injectable()
export class ResponseValidationInterceptor implements NestInterceptor {
  private readonly enabled: boolean;

  constructor(
    private readonly reflector: Reflector,
    config: AppConfig,
  ) {
    this.enabled = config.get('NODE_ENV') === 'test';
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled) return next.handle();
    const schema = this.reflector.get<z.ZodType | undefined>(RESPONSE_SCHEMA, context.getHandler());
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    return next.handle().pipe(
      map((body: unknown) => {
        if (!schema) {
          if (body !== undefined) throw new Error(`${route} responde un cuerpo sin @ResponseSchema (BE3)`);
          return body;
        }
        const result = schema.safeParse(body);
        if (!result.success) {
          throw new Error(`${route} no cumple su esquema (BE3): ${z.prettifyError(result.error)}`);
        }
        return body;
      }),
    );
  }
}
