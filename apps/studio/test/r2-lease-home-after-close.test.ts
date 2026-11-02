// Mini full-suite red (2026-11-01, s5-17 G5 "Cannot use a closed database"): an adapter's exit, landing after
// shutdown (`acp.stopAll(); runs.close()`), ended its run on the closed in-memory lease home and threw into
// whatever ran next. A closed local home answers like an unreachable one and never throws.
import { describe, expect, test } from 'bun:test';
import { createLocalLeaseHome } from '../ai/lease-home.ts';

describe('the local lease home after close', () => {
  test('a late end / renew / list answers unreachable instead of throwing', async () => {
    const home = createLocalLeaseHome({ actor: 'you' });
    home.close?.();
    await expect(home.end('r_late', 'done')).resolves.toEqual({ refused: 'unreachable' });
    await expect(home.renew({ runId: 'r_late' } as never)).resolves.toEqual({
      refused: 'unreachable',
    });
    await expect(home.list()).resolves.toEqual({ refused: 'unreachable' });
    expect(() => home.close?.()).not.toThrow();
  });
});
