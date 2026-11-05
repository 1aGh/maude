// #204 (task L) — an aborted /_index-data fetch kept its server-side build running, and the
// client's retry started another next to it. A request for the same reader joins the build in
// flight unless the tree changed since it started.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { createSingleFlight } from '../index-flight.ts';

function gate() {
  let open!: (v: string) => void;
  const promise = new Promise<string>((r) => {
    open = r;
  });
  return { promise, open };
}

describe('index single-flight (#204)', () => {
  test('a retry while a build runs joins it instead of starting another', async () => {
    const flight = createSingleFlight<string>();
    const g = gate();
    let builds = 0;
    const build = () => {
      builds++;
      return g.promise;
    };
    const a = flight.run('owner|', build);
    const b = flight.run('owner|', build);
    g.open('index');
    expect(await a).toBe('index');
    expect(await b).toBe('index');
    expect(builds).toBe(1);
    expect(flight.size()).toBe(0);
  });

  test('a change after the build started gets a fresh build', async () => {
    const flight = createSingleFlight<string>();
    const first = gate();
    let builds = 0;
    const a = flight.run('owner|', () => {
      builds++;
      return first.promise;
    });
    flight.bump();
    const b = flight.run('owner|', async () => {
      builds++;
      return 'fresh';
    });
    first.open('stale');
    expect(await a).toBe('stale');
    expect(await b).toBe('fresh');
    expect(builds).toBe(2);
  });

  test('two readers never share a build', async () => {
    const flight = createSingleFlight<string>();
    const [a, b] = await Promise.all([
      flight.run('owner|s1', async () => 'owner view'),
      flight.run('editor|s2', async () => 'editor view'),
    ]);
    expect([a, b]).toEqual(['owner view', 'editor view']);
  });

  test('a failed build is not kept', async () => {
    const flight = createSingleFlight<string>();
    await expect(
      flight.run('k', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(await flight.run('k', async () => 'ok')).toBe('ok');
  });

  test('api.ts routes /_index-data builds through it and bumps it on file events', () => {
    const src = readFileSync(new URL('../api.ts', import.meta.url), 'utf8');
    expect(src).toContain('indexFlight.run(');
    expect(src).toContain("ctx.bus.on('fs:any', () => indexFlight.bump());");
  });
});
