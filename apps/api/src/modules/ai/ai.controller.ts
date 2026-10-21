import { type AiDraftRequest, AiDraftRequestSchema, type AiDraftResponse } from '@estudio/shared';
import { Body, Controller, Header, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ZodPipe } from '../../common/zod.pipe.js';
import { type AuthUser, CurrentUser } from '../auth/current-user.js';
import { AiService } from './ai.service.js';

/** BE12: la cuota diaria (LD17) es el límite real; esto frena un doble toque o un bucle. */
const AI_CALLS = { default: { limit: 10, ttl: 60_000 } };

/** LEARNING-DESIGN §8. Requiere sesión (BE11); sin red, la web ni lo intenta (FE7). */
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  /** LD14: borradores de notas a partir de texto que ella pega; ella los revisa (LD16). */
  @Post('drafts')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle(AI_CALLS)
  drafts(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(AiDraftRequestSchema)) body: AiDraftRequest,
  ): Promise<AiDraftResponse> {
    return this.ai.draftNotes(user.id, body);
  }
}
