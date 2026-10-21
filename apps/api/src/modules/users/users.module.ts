import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { UserSettingsSyncHandler } from './user-settings.sync-handler.js';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

/** Cuenta, ajustes por sección y borrado total (BACKEND §1). */
@Module({
  imports: [MediaModule],
  controllers: [UsersController],
  providers: [UserSettingsSyncHandler, UsersRepository, UsersService],
})
export class UsersModule {}
