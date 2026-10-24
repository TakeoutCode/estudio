import { defaultStudyConfig, Rating, type ReviewLog } from '@estudio/shared';
import { describe, expect, it } from 'vitest';
import { DAY, id, log, NOW, TODAY_START, TZ } from '../test/planner-fixtures.js';
import { sessionSummary } from './session.js';

const metrics = defaultStudyConfig().metrics;
const MIN = 60_000;
const session = id(1, 's');
const other = id(2, 's');
const at = (reviewedAt: number, opts: Partial<ReviewLog> = {}): ReviewLog => ({
  ...log(reviewedAt, opts.rating ?? Rating.Good),
  sessionId: session,
  ...opts,
});

describe('§3: resumen final de la sesión', () => {
  it('R21: el tiempo activo es solo el de esta sesión, con el tope de inactividad', () => {
    const logs = [
      at(NOW, { durationMs: 20_000 }),
      at(NOW + 30_000),
      at(NOW + 30_000 + 10 * MIN), // volvió tras 10 min: cuenta hasta el tope
      at(NOW + 5_000, { sessionId: other, durationMs: 40_000 }),
    ];
    expect(sessionSummary(logs, session, NOW + 20 * MIN, TZ, metrics).activeMs).toBe(
      20_000 + 30_000 + 90_000,
    );
    // Mínimo y máximo de `inactivityCutoffSec` (10-600).
    expect(sessionSummary(logs, session, NOW, TZ, { inactivityCutoffSec: 10 }).activeMs).toBe(
      10_000 + 10_000 + 10_000,
    );
    expect(sessionSummary(logs, session, NOW, TZ, { inactivityCutoffSec: 600 }).activeMs).toBe(
      20_000 + 30_000 + 600_000,
    );
  });

  it('§5: la retención del día cuenta los repasos de tarjetas aprendidas de hoy, de cualquier sesión', () => {
    const logs = [
      at(NOW, { rating: Rating.Good }),
      at(NOW + MIN, { rating: Rating.Again }),
      at(NOW + 2 * MIN, { rating: Rating.Easy, sessionId: other, type: 'contrast' }),
      at(NOW + 3 * MIN, { rating: Rating.Again, type: 'learn' }), // nueva: no es retención
      at(NOW + 4 * MIN, { rating: Rating.Again, type: 'exam' }), // simulacro: tampoco
      at(TODAY_START - 1, { rating: Rating.Again }), // ayer, en su día local
    ];
    const { todayRetention } = sessionSummary(logs, session, NOW + 5 * MIN, TZ, metrics);
    expect(todayRetention).toMatchObject({ successes: 2, total: 3 });
    expect(sessionSummary([], session, NOW, TZ, metrics).todayRetention.rate).toBeNull();
  });

  it('AG6: "hoy" es su día local, no el de UTC', () => {
    // 23:30 en CDMX es el día siguiente en UTC: con su zona sigue siendo hoy.
    const lateNight = TODAY_START + DAY - 30 * MIN;
    const logs = [at(TODAY_START + MIN), at(lateNight)];
    expect(sessionSummary(logs, session, lateNight, TZ, metrics).todayRetention.total).toBe(2);
    expect(sessionSummary(logs, session, lateNight, 'UTC', metrics).todayRetention.total).toBe(1);
  });
});
