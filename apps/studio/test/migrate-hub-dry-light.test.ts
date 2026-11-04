// #166 (2.0.4, D7) — every Update dry run asked the hub's save-mode preview, which imports (opens)
// every document of the project, and the owner's probe of a format-2 project that still saves the
// old way runs that dry run each time the shell checks. The studio reads only the blockers from a
// dry run, so it asks for them alone (`preview: false`); a hub that predates the flag ignores it
// and answers as before. The switch itself never carries the flag.

import { describe, expect, test } from 'bun:test';

import { createHubFormatClient } from '../migrate/hub.ts';

function capture() {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')));
    return Response.json({ dryRun: true, mode: 'legacy', epoch: 4, blockers: [] });
  }) as unknown as typeof fetch;
  return {
    bodies,
    client: createHubFormatClient({ url: 'http://hub.test', token: 't' }, fetchImpl),
  };
}

describe('the save-mode dry run asks for the blockers only', () => {
  test('a dry run sends preview:false', async () => {
    const { bodies, client } = capture();
    const r = await client.setMode('transactions', 4, { dryRun: true });
    expect(r.ok).toBe(true);
    expect(bodies).toEqual([
      { mode: 'transactions', expectEpoch: 4, dryRun: true, preview: false },
    ]);
  });

  test('the switch itself carries neither flag', async () => {
    const { bodies, client } = capture();
    await client.setMode('transactions', 4);
    expect(bodies).toEqual([{ mode: 'transactions', expectEpoch: 4 }]);
  });
});
