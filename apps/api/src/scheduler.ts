import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { SchedulerModule } from './scheduler.module.js';

// ADR-018: el daemon `scheduler` de Vercel (Dockerfile.scheduler). Corre el cron y los envíos
// programados (BE14) sin HTTP; Vercel lo reinicia si se cae y le manda SIGTERM al reemplazarlo,
// y con los shutdown hooks los jobs se detienen antes de salir.
const app = await NestFactory.createApplicationContext(SchedulerModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
app.enableShutdownHooks();
