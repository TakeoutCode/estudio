import { Module } from '@nestjs/common';
import { CloudinaryPurger, MediaPurger } from './media-purger.js';
import { CloudinarySigner, MediaSigner } from './media-signer.js';
import { MediaAssetSyncHandler } from './media-asset.sync-handler.js';
import { MediaController } from './media.controller.js';
import { MediaRepository } from './media.repository.js';
import { MediaService } from './media.service.js';

/**
 * Firma de subida, `MediaAsset`, purga de la carpeta al borrar la cuenta y, antes de que la
 * purga de sync borre un asset, su imagen en Cloudinary (BACKEND §1, SYNC §6).
 */
@Module({
  controllers: [MediaController],
  providers: [
    MediaRepository,
    MediaService,
    MediaAssetSyncHandler,
    { provide: MediaSigner, useClass: CloudinarySigner },
    { provide: MediaPurger, useClass: CloudinaryPurger },
  ],
  exports: [MediaPurger],
})
export class MediaModule {}
