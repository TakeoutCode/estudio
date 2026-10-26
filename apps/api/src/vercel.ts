import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';

// ADR-018: la función de Vercel (servicio `api`), solo HTTP; scripts/bundle-vercel.ts la
// empaqueta. Exporta el handler de Express en vez de llamar a `listen`: Vercel intercepta `listen`
// sin abrir el puerto, y un `await app.listen()` aquí dejaría su import colgado. Vercel exige el
// export default (AG8).
const app = configureApp(
  await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false }),
);
await app.init();

export default app.getHttpAdapter().getInstance();
