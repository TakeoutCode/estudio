import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppModule } from './app.module.js';

/**
 * BE14 y ADR-018: en Vercel la API es una función que se pausa entre requests, así que los
 * `@Cron` e `@Interval` de notifications y sync solo se activan donde se importa este módulo:
 * el daemon `scheduler` (`scheduler.ts`) y, en local, `dev.ts`.
 */
@Module({ imports: [AppModule, ScheduleModule.forRoot()] })
export class SchedulerModule {}
