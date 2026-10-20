import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DomainError } from '../../common/domain-error.js';
import type { AuthUser } from './current-user.js';
import { IS_PUBLIC } from './public.js';
import { TokenService } from './token.service.js';

/** BE11: guard global; solo `@Public()` pasa sin un access token vigente. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    const userId = token ? await this.tokens.verifyAccess(token) : null;
    if (!userId) throw new DomainError('unauthorized');
    req.user = { id: userId };
    return true;
  }
}
