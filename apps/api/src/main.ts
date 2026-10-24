import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { AppConfig } from './config/app-config.js';

// ADR-018: la función de Vercel (servicio `api`), solo HTTP. Vercel toma este archivo como
// entrada y usa su `listen`; el cron corre aparte, en `scheduler.ts`.
const app = configureApp(
  await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false }),
);
await app.listen(app.get(AppConfig).get('PORT'));
