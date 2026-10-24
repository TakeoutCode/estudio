import { Module } from '@nestjs/common';
import { AuthAttemptsGuard } from './auth-attempts.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, TokenService, AuthAttemptsGuard],
  exports: [TokenService],
})
export class AuthModule {}
