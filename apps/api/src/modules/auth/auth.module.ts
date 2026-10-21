import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { EmailThrottleGuard } from './email-throttle.guard.js';
import { TokenService } from './token.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, TokenService, EmailThrottleGuard],
  exports: [TokenService],
})
export class AuthModule {}
