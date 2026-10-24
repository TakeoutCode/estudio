import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureApp } from './bootstrap.js';
import { AppConfig } from './config/app-config.js';
import { SchedulerModule } from './scheduler.module.js';

// `pnpm dev`: la API y el cron en un solo proceso. En Vercel van separados (ADR-018): la función
// sale de `main.ts` y el daemon de `scheduler.ts`.
const app = configureApp(
  await NestFactory.create<NestExpressApplication>(SchedulerModule, { bufferLogs: true, bodyParser: false }),
);
await app.listen(app.get(AppConfig).get('PORT'));
