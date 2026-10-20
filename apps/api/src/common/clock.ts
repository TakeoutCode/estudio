import { Global, Injectable, Module } from '@nestjs/common';

/**
 * Reloj inyectable: los services piden `now` aquí y las pruebas lo reemplazan para mover
 * el tiempo (expiración de tokens, gracia del refresh, deriva del HLC).
 */
@Injectable()
export class Clock {
  now(): number {
    return Date.now();
  }
}

@Global()
@Module({ providers: [Clock], exports: [Clock] })
export class ClockModule {}
