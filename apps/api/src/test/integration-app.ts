import { cardIdFor, CONTRACT_HEADER, CONTRACT_VERSION, encodeHlc, newId } from '@estudio/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { inject } from 'vitest';
import type { PushSender } from '../modules/notifications/push-sender.js';
import type { PrismaService as PrismaServiceType } from '../prisma/prisma.service.js';

/** Reloj controlable: las pruebas mueven el tiempo sin esperar. */
export class FakeClock {
  constructor(public value = Date.UTC(2026, 9, 20, 12)) {}
  now(): number {
    return this.value;
  }
  advance(ms: number): void {
    this.value += ms;
  }
}

/** Sin límite de tasa: las pruebas inician sesión muchas veces desde la misma IP. */
const unlimitedStorage = {
  increment: (_key: string, ttl: number) =>
    Promise.resolve({ totalHits: 1, timeToExpire: ttl, isBlocked: false, timeToBlockExpire: 0 }),
};

export interface IntegrationApp {
  readonly app: NestExpressApplication;
  readonly clock: FakeClock;
  /** Request con la cabecera de contrato que manda la PWA (ARC6). */
  readonly api: () => {
    get: (path: string) => request.Test;
    post: (path: string) => request.Test;
    put: (path: string) => request.Test;
    delete: (path: string) => request.Test;
  };
  /** Acceso directo a la base para verificar lo que el HTTP no muestra (siempre `$queryRaw` con plantilla). */
  readonly prisma: PrismaServiceType;
  readonly close: () => Promise<void>;
}

/**
 * Arranca la app real contra el Postgres de Testcontainers. El entorno se fija antes de
 * importar AppModule porque ConfigModule.forRoot valida al importarse.
 */
export async function startIntegrationApp(
  options: { readonly clock?: FakeClock; readonly throttle?: boolean; readonly pushSender?: PushSender } = {},
): Promise<IntegrationApp> {
  process.env.DATABASE_URL = inject('databaseUrl');
  const [{ AppModule }, { configureApp }, { Clock }, { PrismaService }, { NotificationsScheduler }, push] =
    await Promise.all([
      import('../app.module.js'),
      import('../bootstrap.js'),
      import('../common/clock.js'),
      import('../prisma/prisma.service.js'),
      import('../modules/notifications/notifications.scheduler.js'),
      import('../modules/notifications/push-sender.js'),
    ]);

  const clock = options.clock ?? new FakeClock();
  // Sin cron: las pruebas corren los ticks a mano con el reloj falso.
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(NotificationsScheduler)
    .useValue({});
  if (options.pushSender) builder = builder.overrideProvider(push.PushSender).useValue(options.pushSender);
  if (!options.throttle) builder = builder.overrideProvider(ThrottlerStorage).useValue(unlimitedStorage);
  const moduleRef = await builder.compile();

  const app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  // Un solo listen en un puerto efímero: supertest no abre uno por request.
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  const prisma = app.get(PrismaService);
  const contract = String(CONTRACT_VERSION);

  return {
    app,
    clock,
    api: () => {
      const agent = request(url);
      return {
        get: (path) => agent.get(path).set(CONTRACT_HEADER, contract),
        post: (path) => agent.post(path).set(CONTRACT_HEADER, contract),
        put: (path) => agent.put(path).set(CONTRACT_HEADER, contract),
        delete: (path) => agent.delete(path).set(CONTRACT_HEADER, contract),
      };
    },
    prisma,
    close: () => app.close(),
  };
}

export const PASSWORD = 'una-contraseña-larga-de-prueba';

/** Registra (si hace falta) e inicia sesión; devuelve el access token y la cookie. */
export async function signIn(
  it: IntegrationApp,
  email: string,
): Promise<{ token: string; cookie: string; userId: string }> {
  await it.api().post('/auth/register').send({ email, password: PASSWORD }).expect(202);
  const res = await it.api().post('/auth/login').send({ email, password: PASSWORD }).expect(200);
  const body = res.body as { accessToken: string; userId: string };
  return { token: body.accessToken, cookie: refreshCookie(res), userId: body.userId };
}

/** `estudio_rt=...` tal como lo devolvería el navegador en la siguiente request. */
export function refreshCookie(res: request.Response): string {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = header?.find((c) => c.startsWith('estudio_rt='));
  if (!cookie) throw new Error('La respuesta no trae la cookie de refresh');
  return cookie.split(';')[0] ?? '';
}

export const hlcAt = (wall: number, node: string, counter = 0): string => encodeHlc({ wall, counter, node });

export const deckRow = (wall: number, node: string, overrides: Record<string, unknown> = {}) => ({
  id: newId(),
  name: 'Huesos del carpo',
  description: null,
  hlc: hlcAt(wall, node),
  updatedAt: wall,
  deletedAt: null,
  ...overrides,
});

export const noteRow = (
  wall: number,
  node: string,
  deckId: string,
  overrides: Record<string, unknown> = {},
) => ({
  id: newId(),
  deckId,
  topicId: null,
  content: {
    kind: 'basic',
    front: '¿Qué hueso del carpo se fractura más?',
    back: 'El escafoides',
    explanation: 'Por caídas sobre la mano extendida.',
    reverse: false,
  },
  origin: 'manual',
  hlc: hlcAt(wall, node),
  updatedAt: wall,
  deletedAt: null,
  ...overrides,
});

export const cardRow = (
  wall: number,
  node: string,
  noteId: string,
  overrides: Record<string, unknown> = {},
) => ({
  id: cardIdFor(noteId, 0),
  noteId,
  ordinal: 0,
  createdAt: wall,
  lapseBaseline: 0,
  hlc: hlcAt(wall, node),
  updatedAt: wall,
  deletedAt: null,
  ...overrides,
});
