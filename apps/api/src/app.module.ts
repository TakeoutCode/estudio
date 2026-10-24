import { randomUUID } from 'node:crypto';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { ClockModule } from './common/clock.js';
import { ContractGuard } from './common/contract.guard.js';
import { requestLogProps } from './common/log-props.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import { AppConfig } from './config/app-config.js';
import { AppConfigModule } from './config/config.module.js';
import { AiModule } from './modules/ai/ai.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard.js';
import { DecksModule } from './modules/decks/decks.module.js';
import { ExamsModule } from './modules/exams/exams.module.js';
import { ExercisesModule } from './modules/exercises/exercises.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { MediaModule } from './modules/media/media.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { StudyModule } from './modules/study/study.module.js';
import { SyncModule } from './modules/sync/sync.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PrismaService } from './prisma/prisma.service.js';

const REQUEST_ID_HEADER = 'x-request-id';

@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          genReqId: (req, res) => {
            const incoming = req.headers[REQUEST_ID_HEADER];
            const id = typeof incoming === 'string' && incoming.length <= 64 ? incoming : randomUUID();
            res.setHeader(REQUEST_ID_HEADER, id);
            return id;
          },
          // BACKEND BE6: nunca credenciales ni contenido de estudio en los logs; sí su userId.
          customProps: requestLogProps,
          redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          serializers: {
            req: (req: { id: unknown; method: unknown; url: unknown }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
          },
        },
      }),
    }),
    // BACKEND BE7: @Transactional() sobre Prisma; el contexto CLS se abre en cada request.
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
      plugins: [
        new ClsPluginTransactional({
          imports: [PrismaModule],
          adapter: new TransactionalAdapterPrisma({
            prismaInjectionToken: PrismaService,
            sqlFlavor: 'postgresql',
            defaultTxOptions: { timeout: 15_000 },
          }),
        }),
      ],
    }),
    // Límite global de BACKEND BE12; auth fija uno más estricto en login y registro.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    // BE14: cron y envíos programados; las pruebas reemplazan el scheduler por uno vacío.
    ScheduleModule.forRoot(),
    PrismaModule,
    HealthModule,
    AuthModule,
    SyncModule,
    DecksModule,
    UsersModule,
    StudyModule,
    ExamsModule,
    MediaModule,
    AiModule,
    ExercisesModule,
    NotificationsModule,
  ],
  providers: [
    // Orden: límite de tasa → versión de contrato (ARC6) → access token (BE11).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ContractGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
