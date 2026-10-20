import type { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import type { PrismaService } from './prisma.service.js';

/**
 * BACKEND BE7: los repositories usan `txHost.tx`. Dentro de un `@Transactional()` es la
 * transacción en curso; fuera, el cliente normal.
 */
export type PrismaTxHost = TransactionHost<TransactionalAdapterPrisma<PrismaService>>;
