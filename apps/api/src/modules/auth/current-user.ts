import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { DomainError } from '../../common/domain-error.js';

export interface AuthUser {
  readonly id: string;
}

/** BE11: el `userId` sale solo del token verificado, nunca del cuerpo ni de la query. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
  if (!user) throw new DomainError('unauthorized');
  return user;
});
