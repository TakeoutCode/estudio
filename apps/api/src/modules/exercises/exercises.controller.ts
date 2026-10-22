import { type AiClinicalCasesResponse, type AiDraftRequest, AiDraftRequestSchema } from '@estudio/shared';
import { Body, Controller, Header, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ZodPipe } from '../../common/zod.pipe.js';
import { type AuthUser, CurrentUser } from '../auth/current-user.js';
import { ClinicalCaseDraftsService } from './clinical-case-drafts.service.js';

/** BE12: la cuota diaria (LD17) es el límite real; esto frena un doble toque o un bucle. */
const AI_CALLS = { default: { limit: 10, ttl: 60_000 } };

/** Bajo `/ai`, junto a los otros pedidos de IA; requiere sesión (BE11). */
@Controller('ai')
export class ExercisesController {
  constructor(private readonly cases: ClinicalCaseDraftsService) {}

  /** LD14: borradores de casos clínicos a partir de texto que ella pega; ella los revisa (LD16). */
  @Post('clinical-cases')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle(AI_CALLS)
  clinicalCases(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(AiDraftRequestSchema)) body: AiDraftRequest,
  ): Promise<AiClinicalCasesResponse> {
    return this.cases.draft(user.id, body);
  }
}
