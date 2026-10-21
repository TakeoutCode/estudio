import { type MediaSignature, mediaPublicId } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock.js';
import { DomainError } from '../../common/domain-error.js';
import { MediaSigner } from './media-signer.js';
import { MediaRepository } from './media.repository.js';

@Injectable()
export class MediaService {
  constructor(
    private readonly repo: MediaRepository,
    private readonly signer: MediaSigner,
    private readonly clock: Clock,
  ) {}

  /**
   * ARC8: firma la subida de un asset que ya llegó por push. El `public_id` sale del `userId`
   * del JWT y del id del asset, así que no se puede subir a la carpeta de otra cuenta.
   */
  async sign(userId: string, assetId: string): Promise<MediaSignature> {
    if (!(await this.repo.isAlive(userId, assetId))) throw new DomainError('not_found');
    const signature = this.signer.sign({
      publicId: mediaPublicId(userId, assetId),
      timestampSec: Math.floor(this.clock.now() / 1000),
    });
    if (!signature) throw new DomainError('unavailable');
    return signature;
  }
}
