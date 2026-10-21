import { type DeleteAccountRequest, DeleteAccountRequestSchema } from '@estudio/shared';
import { Body, Controller, Delete, HttpCode, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ZodPipe } from '../../common/zod.pipe.js';
import { AppConfig } from '../../config/app-config.js';
import { REFRESH_COOKIE } from '../auth/constants.js';
import { refreshCookieOptions } from '../auth/cookies.js';
import { type AuthUser, CurrentUser } from '../auth/current-user.js';
import { UsersService } from './users.service.js';

/** BE12: como el login, porque pide la contraseña. */
const STRICT = { default: { limit: 5, ttl: 60_000 } };

/** BACKEND §1: la cuenta. Requiere sesión (BE11). */
@Controller('me')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly config: AppConfig,
  ) {}

  /** QA6: borrado total. La cookie de refresh se limpia; sus tokens ya no existen. */
  @Delete()
  @HttpCode(204)
  @Throttle(STRICT)
  async deleteAccount(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(DeleteAccountRequestSchema)) body: DeleteAccountRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.users.deleteAccount(user.id, body.password);
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions(this.config.get('NODE_ENV') === 'production'));
  }
}
