import { Transactional } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/domain-error.js';
import { dummyHash, verifyPassword } from '../auth/password.js';
import { MediaPurger } from '../media/media-purger.js';
import { UsersRepository } from './users.repository.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly media: MediaPurger,
  ) {}

  /**
   * QA6: borra la cuenta, todo lo de Postgres y su carpeta de Cloudinary. Cloudinary va primero
   * y fuera de la transacción (BE7): si falla, Postgres queda intacto y ella puede reintentar.
   */
  async deleteAccount(userId: string, password: string): Promise<void> {
    const user = await this.repo.findPasswordHash(userId);
    // Con o sin cuenta se verifica una contraseña: el tiempo no dice si existe.
    const valid = await verifyPassword(user?.passwordHash ?? (await dummyHash()), password);
    if (!user) throw new DomainError('unauthorized');
    if (!valid) throw new DomainError('forbidden'); // 401 haría que la web renueve y reintente
    try {
      await this.media.purgeUser(userId);
    } catch {
      throw new DomainError('unavailable');
    }
    await this.purge(userId);
  }

  @Transactional()
  private async purge(userId: string): Promise<void> {
    await this.repo.purge(userId);
  }
}
