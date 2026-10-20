import {
  type PullQuery,
  PullQuerySchema,
  type PullResponse,
  type PushRequest,
  PushRequestSchema,
  type PushResponse,
} from '@estudio/shared';
import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ZodPipe } from '../../common/zod.pipe.js';
import { type AuthUser, CurrentUser } from '../auth/current-user.js';
import { SyncService } from './sync.service.js';

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('push')
  @HttpCode(200)
  push(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(PushRequestSchema)) body: PushRequest,
  ): Promise<PushResponse> {
    return this.sync.push(user.id, body);
  }

  @Get('pull')
  pull(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(PullQuerySchema)) query: PullQuery,
  ): Promise<PullResponse> {
    return this.sync.pull(user.id, query);
  }
}
