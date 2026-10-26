import {
  type PullQuery,
  PullQuerySchema,
  type PullResponse,
  PullResponseSchema,
  type PushRequest,
  PushRequestSchema,
  type PushResponse,
  PushResponseSchema,
} from '@estudio/shared';
import { Body, Controller, Get, HttpCode, Post, Query, UseInterceptors } from '@nestjs/common';
import { ResponseSchema } from '../../common/response-schema.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { type AuthUser, CurrentUser } from '../auth/current-user.js';
import { SyncPushMetrics } from './sync-push.metrics.js';
import { SyncService } from './sync.service.js';

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @ResponseSchema(PushResponseSchema)
  @Post('push')
  @HttpCode(200)
  @UseInterceptors(SyncPushMetrics) // QA8
  push(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(PushRequestSchema)) body: PushRequest,
  ): Promise<PushResponse> {
    return this.sync.push(user.id, body);
  }

  @ResponseSchema(PullResponseSchema)
  @Get('pull')
  pull(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(PullQuerySchema)) query: PullQuery,
  ): Promise<PullResponse> {
    return this.sync.pull(user.id, query);
  }
}
