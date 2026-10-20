import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfig } from './app-config.js';
import { validateEnv } from './env.js';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      // En pruebas el entorno lo pone vitest.config.ts; nunca un .env local.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: validateEnv,
    }),
  ],
  providers: [AppConfig],
  exports: [AppConfig],
})
export class AppConfigModule {}
