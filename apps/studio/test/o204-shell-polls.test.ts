// Maude 2.0.4 task O (lead's add-on) — the shell's design-system polls stop while the window is hidden and slow
// while it is unused. Measured with the DS board open and idle: ~50 requests a minute (make-state 24, ds/state 10,
// system-files 8, check-system 8).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type PageActivity, pacedInterval } from '../editing/page-activity.ts';

function manual() {
  let on = true;
  let hidden = false;
  const subs = new Set<(a: boolean) => void>();
  const a: PageActivity & { use(): void; idle(): void; hide(): void; show(): void } = {
    active: () => on,
    hidden: () => hidden,
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    poke() {},
    dispose() {},
    use() {
      on = true;
      for (const fn of subs) fn(true);
    },
    idle() {
      on = false;
      for (const fn of subs) fn(false);
    },
    hide() {
      hidden = true;
      on = false;
      for (const fn of subs) fn(false);
    },
    show() {
      hidden = false;
      on = true;
      for (const fn of subs) fn(true);
    },
  };
  return a;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('pacedInterval', () => {
  test('keeps its pace while used, slows while idle, stops while hidden, runs at once on return', async () => {
    const act = manual();
    let n = 0;
    const stop = pacedInterval(() => n++, 5, act, 40);
    await wait(60);
    const used = n;
    expect(used).toBeGreaterThan(5);
    act.idle();
    n = 0;
    await wait(100);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(3); // ~every 40 ms, not every 5
    act.hide();
    n = 0;
    await wait(100);
    expect(n).toBe(0);
    act.show();
    expect(n).toBe(1); // at once
    await wait(40);
    expect(n).toBeGreaterThan(3);
    stop();
    n = 0;
    await wait(40);
    expect(n).toBe(0);
  });

  test('the default idle pace is at least 30 s', async () => {
    const act = manual();
    act.idle();
    let n = 0;
    const stop = pacedInterval(() => n++, 5, act);
    await wait(60);
    expect(n).toBe(0);
    stop();
  });
});

describe('the design-system polls use the shell clock', () => {
  const read = (f: string) => readFileSync(join(import.meta.dir, '../client/v2/ds', f), 'utf8');
  for (const f of ['truth-host.jsx', 'advanced-host.jsx', 'make-host.jsx', 'off-system-host.jsx']) {
    test(f, () => {
      const src = read(f);
      expect(src).toContain('pacedInterval(');
      expect(src).toContain('shellActivity()');
      expect(src).not.toMatch(/setInterval\(/);
    });
  }
});
