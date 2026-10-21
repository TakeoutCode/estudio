import { CLIENT_ERROR_LIMITS, type ClientErrorReport, ClientErrorReportSchema } from '@estudio/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { recordClientError, unsentDiagnostics } from '@/db/diagnostics';
import { EstudioDb } from '@/db/schema';
import { sendDiagnostics } from './diagnostics';

const T0 = new Date(2026, 9, 21, 12).getTime(); // mediodía local de este dispositivo
const MIN = 60_000;

const open: EstudioDb[] = [];
const fresh = () => {
  const database = new EstudioDb(`diagnosticos-${String(open.length)}-${String(T0)}`);
  open.push(database);
  return database;
};

afterEach(async () => {
  await Promise.all(open.splice(0).map((database) => database.delete()));
});

const transport = () => {
  const sent: ClientErrorReport[] = [];
  return {
    sent,
    send: (report: ClientErrorReport) => {
      sent.push(ClientErrorReportSchema.parse(report));
      return Promise.resolve();
    },
  };
};

describe('FE13: errores del cliente', () => {
  it('guarda mensaje, stack, ruta y versión, sin contenido ni ids', async () => {
    const database = fresh();
    const error = new SyntaxError('"El fémur es el hueso más largo" is not valid JSON');
    await recordClientError(database, error, '/notes/0192f1a0-0000-7000-8000-00000000c0de', T0);
    const [entry] = await unsentDiagnostics(database, T0);
    expect(entry).toMatchObject({
      message: 'SyntaxError: "…" is not valid JSON',
      route: '/notes/:id',
      occurredAt: T0,
    });
    expect(JSON.stringify(entry)).not.toContain('fémur');
    expect(entry?.appVersion).toMatch(/^\d+$/);
  });

  it('un valor que no es Error solo deja su tipo, y el mismo error repetido en un minuto cuenta una vez', async () => {
    const database = fresh();
    await recordClientError(database, { answer: 'el fémur' }, '/study', T0);
    await recordClientError(database, { answer: 'otra' }, '/study', T0 + 1000);
    await recordClientError(database, { answer: 'otra' }, '/study', T0 + 2 * MIN);
    const entries = await unsentDiagnostics(database, T0 + 2 * MIN);
    expect(entries.map((e) => e.message)).toEqual(['Non-Error thrown (object)', 'Non-Error thrown (object)']);
  });

  it('se envían en un lote y no se repiten; hasta 20 al día', async () => {
    const database = fresh();
    for (let i = 0; i < 25; i += 1)
      await recordClientError(database, new Error(`fallo ${String(i)}`), '/', T0 + i);
    const http = transport();
    expect(await sendDiagnostics(database, http, T0 + MIN)).toBe(CLIENT_ERROR_LIMITS.perDay);
    expect(await sendDiagnostics(database, http, T0 + 2 * MIN)).toBe(0); // ya van 20 hoy
    expect(http.sent).toHaveLength(1);
    // Al otro día salen los que quedaban.
    expect(await sendDiagnostics(database, http, T0 + 24 * 60 * MIN)).toBe(5);
    expect(http.sent[1]?.errors.map((e) => e.message)).toEqual(
      [20, 21, 22, 23, 24].map((i) => `Error: fallo ${String(i)}`),
    );
  });

  it('sin red no se pierden ni rompen la sync: esperan a la próxima vuelta', async () => {
    const database = fresh();
    await recordClientError(database, new Error('sin red'), '/', T0);
    const offline = { send: () => Promise.reject(new Error('network')) };
    expect(await sendDiagnostics(database, offline, T0 + MIN)).toBe(0);
    expect(await unsentDiagnostics(database, T0 + MIN)).toHaveLength(1);
  });

  it('guarda como máximo 50: los más viejos se van primero', async () => {
    const database = fresh();
    for (let i = 0; i < 55; i += 1)
      await recordClientError(database, new Error(`e${String(i)}`), '/', T0 + i);
    expect(await database.diagnostics.count()).toBe(50);
    expect((await database.diagnostics.orderBy('occurredAt').first())?.message).toBe('Error: e5');
  });
});
