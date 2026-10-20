import {
  type BackoffAnswer,
  BackoffAnswerSchema,
  type BreakEndCancel,
  BreakEndCancelSchema,
  type BreakEndSchedule,
  BreakEndScheduleSchema,
  type NotificationState,
  type PushSubscriptionInput,
  PushSubscriptionInputSchema,
  type PushUnsubscribe,
  PushUnsubscribeSchema,
} from '@estudio/shared';
import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe.js';
import { type AuthUser, CurrentUser } from '../auth/current-user.js';
import { NotificationsService } from './notifications.service.js';

/** NOTIFICATIONS §4, §6 y §7; BACKEND §1. Todo requiere sesión (BE11). */
@Controller()
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  /** NT8: la suscripción de este dispositivo, tras el permiso pedido con un gesto de ella. */
  @Post('push/subscriptions')
  @HttpCode(204)
  async subscribe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(PushSubscriptionInputSchema)) body: PushSubscriptionInput,
  ): Promise<void> {
    await this.service.subscribe(user.id, body);
  }

  @Delete('push/subscriptions')
  @HttpCode(204)
  async unsubscribe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(PushUnsubscribeSchema)) body: PushUnsubscribe,
  ): Promise<void> {
    await this.service.unsubscribe(user.id, body.endpoint);
  }

  /** NT4: al pasar a segundo plano durante un descanso. */
  @Put('notifications/break-end')
  @HttpCode(204)
  async scheduleBreakEnd(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(BreakEndScheduleSchema)) body: BreakEndSchedule,
  ): Promise<void> {
    await this.service.scheduleBreakEnd(user.id, body);
  }

  /** NT4: al volver a la app. */
  @Delete('notifications/break-end')
  @HttpCode(204)
  async cancelBreakEnd(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(BreakEndCancelSchema)) body: BreakEndCancel,
  ): Promise<void> {
    await this.service.cancelBreakEnd(user.id, body);
  }

  /** NT7: la app abrió desde el aviso (`?aviso=<id>`). */
  @Post('notifications/:id/opened')
  @HttpCode(204)
  async opened(@CurrentUser() user: AuthUser, @Param('id', new ZodPipe(z.uuid())) id: string): Promise<void> {
    await this.service.markOpened(user.id, id);
  }

  @Get('notifications/state')
  @Header('Cache-Control', 'no-store')
  async state(@CurrentUser() user: AuthUser): Promise<NotificationState> {
    return this.service.state(user.id);
  }

  /** NT7: la respuesta a la pregunta única del modo reducido. */
  @Post('notifications/backoff')
  @HttpCode(204)
  async answerBackoff(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(BackoffAnswerSchema)) body: BackoffAnswer,
  ): Promise<void> {
    await this.service.answerBackoff(user.id, body);
  }
}
