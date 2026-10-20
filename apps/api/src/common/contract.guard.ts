import { CONTRACT_HEADER } from '@estudio/shared';
import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppConfig } from '../config/app-config.js';
import { DomainError } from './domain-error.js';

const SKIP_CONTRACT = 'estudio:skipContract';

/** Rutas que no llama la PWA (health, monitores): no exigen la cabecera de contrato. */
export const SkipContractCheck = () => SetMetadata(SKIP_CONTRACT, true);

/**
 * ARCHITECTURE ARC6: cada request de la PWA trae `X-Estudio-Contract`. Si falta o es menor
 * que `MIN_CONTRACT`, responde 426 y la PWA actualiza su service worker.
 */
@Injectable()
export class ContractGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean | undefined>(SKIP_CONTRACT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const raw = context.switchToHttp().getRequest<Request>().headers[CONTRACT_HEADER];
    const version = Number(Array.isArray(raw) ? raw[0] : raw);
    if (!Number.isInteger(version) || version < this.config.get('MIN_CONTRACT')) {
      throw new DomainError('contract_outdated');
    }
    return true;
  }
}
