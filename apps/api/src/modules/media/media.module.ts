import { Module } from '@nestjs/common';
import { CloudinarySigner, MediaSigner } from './media-signer.js';
import { MediaAssetSyncHandler } from './media-asset.sync-handler.js';
import { MediaController } from './media.controller.js';
import { MediaRepository } from './media.repository.js';
import { MediaService } from './media.service.js';

/** Firma de subida y `MediaAsset` (BACKEND §1). La limpieza de huérfanos en Cloudinary falta. */
@Module({
  controllers: [MediaController],
  providers: [
    MediaRepository,
    MediaService,
    MediaAssetSyncHandler,
    { provide: MediaSigner, useClass: CloudinarySigner },
  ],
})
export class MediaModule {}
