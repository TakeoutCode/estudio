import { Module } from '@nestjs/common';
import { UserSettingsSyncHandler } from './user-settings.sync-handler.js';

@Module({ providers: [UserSettingsSyncHandler] })
export class UsersModule {}
