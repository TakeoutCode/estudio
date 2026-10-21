import { type Credentials, CredentialsSchema, type SessionResponse } from '@estudio/shared';
import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ZodPipe } from '../../common/zod.pipe.js';
import { AppConfig } from '../../config/app-config.js';
import { AuthService, type IssuedSession } from './auth.service.js';
import { REFRESH_COOKIE } from './constants.js';
import { EmailThrottleGuard } from './email-throttle.guard.js';
import { readCookie, refreshCookieOptions } from './cookies.js';
import { Public } from './public.js';

/** BE12: login y registro con un límite más estricto que el global (por IP) y otro por correo. */
const STRICT = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
@Public()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  @Post('register')
  @HttpCode(202)
  @Throttle(STRICT)
  @UseGuards(EmailThrottleGuard)
  async register(@Body(new ZodPipe(CredentialsSchema)) body: Credentials): Promise<void> {
    await this.auth.register(body);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(STRICT)
  @UseGuards(EmailThrottleGuard)
  async login(
    @Body(new ZodPipe(CredentialsSchema)) body: Credentials,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    return this.respond(res, await this.auth.login(body));
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SessionResponse> {
    return this.respond(res, await this.auth.refresh(readCookie(req.headers.cookie, REFRESH_COOKIE)));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readCookie(req.headers.cookie, REFRESH_COOKIE));
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions(this.secure));
  }

  private get secure(): boolean {
    return this.config.get('NODE_ENV') === 'production';
  }

  private respond(res: Response, session: IssuedSession): SessionResponse {
    res.cookie(
      REFRESH_COOKIE,
      session.refreshToken,
      refreshCookieOptions(this.secure, new Date(session.refreshExpiresAt)),
    );
    res.setHeader('Cache-Control', 'no-store');
    return { userId: session.userId, accessToken: session.accessToken, expiresAt: session.expiresAt };
  }
}
