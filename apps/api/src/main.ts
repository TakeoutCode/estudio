import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

// ADR-018: la función de Vercel (servicio `api`), solo HTTP. Vercel empaqueta este archivo con
// rolldown y usa su `listen`; el cron corre aparte, en `scheduler.ts`. La app se importa después
// de @nestjs/core porque rolldown pone los imports locales antes que los de paquetes: los
// paquetes CommonJS (@nestjs/throttler) harían require('@nestjs/core') a medio evaluar.
const { AppModule } = await import('./app.module.js');
const { configureApp } = await import('./bootstrap.js');
const { AppConfig } = await import('./config/app-config.js');

const app = configureApp(
  await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false }),
);
await app.listen(app.get(AppConfig).get('PORT'));
