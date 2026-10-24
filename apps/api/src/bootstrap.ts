import { CONTRACT_HEADER } from '@estudio/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { Logger } from 'nestjs-pino';
import { API_PREFIX } from './common/api-prefix.js';
import { AppConfig } from './config/app-config.js';

/** Middleware global de la app; lo comparten `main.ts`, `dev.ts` y las pruebas de integración. */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  const config = app.get(AppConfig);
  const origins = config.get('WEB_ORIGINS');

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX); // ADR-019
  // BE12: el throttler cuenta por `req.ip`; detrás del proxy, esa es la IP que él agrega.
  const proxyHops = config.get('TRUST_PROXY_HOPS');
  if (proxyHops > 0) app.set('trust proxy', proxyHops);
  // BACKEND BE12: cabeceras de seguridad nativas de Nest 12 (mismos valores que helmet 8)
  // y protección CSRF por Fetch Metadata, con la web como único origen confiable.
  app.useSecurityHeaders();
  app.enableCsrfProtection({ trustedOrigins: origins });
  app.enableCors({
    origin: origins,
    credentials: true,
    allowedHeaders: ['content-type', 'authorization', 'x-request-id', CONTRACT_HEADER],
    // SY8: la web respeta `Retry-After` en 429 y 503; sin exponerla, en local (web y API en
    // puertos distintos) no la lee. En producción comparten origen y CORS no interviene.
    exposedHeaders: ['x-request-id', 'retry-after'],
    maxAge: 600,
  });
  // BE12: 2 MB para un lote de sync (hasta 200 mutaciones), 1 MB para lo demás. Es middleware
  // de Express: no recibe el prefijo global y la ruta lo lleva escrito.
  app.use(`/${API_PREFIX}/sync/push`, express.json({ limit: '2mb' }));
  app.useBodyParser('json', { limit: '1mb' });
  app.enableShutdownHooks();
  return app;
}
