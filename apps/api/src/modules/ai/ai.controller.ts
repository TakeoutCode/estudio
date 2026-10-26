import {
  type AiDistractorsRequest,
  AiDistractorsRequestSchema,
  type AiDistractorsResponse,
  AiDistractorsResponseSchema,
  type AiDraftRequest,
  AiDraftRequestSchema,
  type AiDraftResponse,
  AiDraftResponseSchema,
  type AiExplanationCheck,
  type AiExplanationCheckRequest,
  AiExplanationCheckRequestSchema,
  AiExplanationCheckSchema,
  type AiFeedbackRequest,
  AiFeedbackRequestSchema,
  type AiOpenFeedback,
  AiOpenFeedbackSchema,
} from '@estudio/shared';
import { Body, Controller, Header, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ResponseSchema } from '../../common/response-schema.js';
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
  @ResponseSchema(AiDraftResponseSchema)
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

  /** LD14: distractores para su pregunta de opción múltiple; ella elige cuáles usa (LD16). */
  @ResponseSchema(AiDistractorsResponseSchema)
  @Post('distractors')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle(AI_CALLS)
  distractors(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(AiDistractorsRequestSchema)) body: AiDistractorsRequest,
  ): Promise<AiDistractorsResponse> {
    return this.ai.distractors(user.id, body);
  }

  /** LD14: retroalimentación de su respuesta abierta frente a su clave; ella se califica. */
  @ResponseSchema(AiOpenFeedbackSchema)
  @Post('feedback')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle(AI_CALLS)
  feedback(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(AiFeedbackRequestSchema)) body: AiFeedbackRequest,
  ): Promise<AiOpenFeedback> {
    return this.ai.feedback(user.id, body);
  }

  /** LD14: si su autoexplicación de una tarjeta que olvidó es correcta; no toca FSRS. */
  @ResponseSchema(AiExplanationCheckSchema)
  @Post('explanation-check')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle(AI_CALLS)
  explanationCheck(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(AiExplanationCheckRequestSchema)) body: AiExplanationCheckRequest,
  ): Promise<AiExplanationCheck> {
    return this.ai.checkExplanation(user.id, body);
  }
}
