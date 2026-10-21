import {
  type MediaSignature,
  type MediaSignatureRequest,
  MediaSignatureRequestSchema,
} from '@estudio/shared';
import { Body, Controller, Header, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ZodPipe } from '../../common/zod.pipe.js';
import { type AuthUser, CurrentUser } from '../auth/current-user.js';
import { MediaService } from './media.service.js';

/** BE12: una por imagen; más que el límite global no hace falta. */
const SIGNATURES = { default: { limit: 30, ttl: 60_000 } };

/** ARCHITECTURE §3, FRONTEND §5. Requiere sesión (BE11). */
@Controller('media')
export class MediaController {
  constructor(private readonly service: MediaService) {}

  @Post('signature')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle(SIGNATURES)
  sign(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(MediaSignatureRequestSchema)) body: MediaSignatureRequest,
  ): Promise<MediaSignature> {
    return this.service.sign(user.id, body.assetId);
  }
}
