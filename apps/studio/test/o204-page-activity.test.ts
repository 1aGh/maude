// Maude 2.0.4 task O — the canvas runtime's loops stop while the page is idle or hidden (editing/page-activity.ts).
// Measured on 2.0.3: an idle canvas ran the rotate handle's rAF loop 72×/s and two layout polls 15×/s, forever.
import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type ActivityEnv,
  activeFrameLoop,
  activeInterval,
  createPageActivity,
  IDLE_AFTER_MS,
  type PageActivity,
} from '../editing/page-activity.ts';

/** A fake clock + timers + wake sources. */
function fakeEnv() {
  let now = 0;
  let hidden = false;
  let wake: () => void = () => {};
  let vis: () => void = () => {};
  const timers = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  const env: ActivityEnv = {
    now: () => now,
    hidden: () => hidden,
    listen(w, v) {
      wake = w;
      vis = v;
      return () => {};
    },
    setTimer(fn, ms) {
      timers.set(++id, { at: now + ms, fn });
      return id;
    },
    clearTimer(t) {
      timers.delete(t as number);
    },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = end;
  };
  return {
    env,
    advance,
    timers,
    wake: () => wake(),
    setHidden(h: boolean) {
      hidden = h;
      vis();
    },
  };
}

describe('page activity clock', () => {
  test('a page with no use goes idle after IDLE_AFTER_MS and holds no timer while idle', () => {
    const f = fakeEnv();
    const a = createPageActivity(f.env);
    expect(a.active()).toBe(true);
    f.advance(IDLE_AFTER_MS - 1);
    expect(a.active()).toBe(true);
    f.advance(1);
    expect(a.active()).toBe(false);
    expect(f.timers.size).toBe(0);
  });

  test('use keeps it active and wakes it; many events arm one timer', () => {
    const f = fakeEnv();
    const a = createPageActivity(f.env);
    const seen: boolean[] = [];
    a.subscribe((on) => seen.push(on));
    for (let i = 0; i < 100; i++) {
      f.advance(50);
      f.wake();
    }
    expect(a.active()).toBe(true);
    expect(f.timers.size).toBe(1);
    f.advance(IDLE_AFTER_MS);
    expect(a.active()).toBe(false);
    f.wake();
    expect(a.active()).toBe(true);
    expect(seen).toEqual([false, true]);
  });

  test('a hidden page is idle at once and use does not wake it until it is visible again', () => {
    const f = fakeEnv();
    const a = createPageActivity(f.env);
    f.setHidden(true);
    expect(a.active()).toBe(false);
    expect(f.timers.size).toBe(0);
    f.wake();
    expect(a.active()).toBe(false);
    f.setHidden(false);
    expect(a.active()).toBe(true);
  });
});

/** A hand-driven activity for the loop helpers. */
function manual(initial: boolean): PageActivity & { set(on: boolean): void } {
  let on = initial;
  const subs = new Set<(a: boolean) => void>();
  return {
    active: () => on,
    hidden: () => false,
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    poke() {},
    dispose() {},
    set(next) {
      on = next;
      for (const fn of subs) fn(next);
    },
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('loops on the clock', () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const hadRaf = 'requestAnimationFrame' in g;
  if (!hadRaf) {
    g.requestAnimationFrame = (cb: (t: number) => void) =>
      setTimeout(() => cb(performance.now()), 2);
    g.cancelAnimationFrame = (id: number) => clearTimeout(id);
  }
  afterEach(() => {});

  test('activeInterval polls while active, stops while idle (one settle run), resumes at once', async () => {
    const act = manual(true);
    let n = 0;
    const stop = activeInterval(() => n++, 5, act);
    await wait(60);
    expect(n).toBeGreaterThan(4);
    act.set(false);
    const atIdle = n;
    await wait(80);
    expect(n).toBe(atIdle); // the settle run happened inside set(false); nothing since
    act.set(true);
    expect(n).toBe(atIdle + 1); // resumes at once
    await wait(40);
    expect(n).toBeGreaterThan(atIdle + 2);
    stop();
    const atStop = n;
    await wait(40);
    expect(n).toBe(atStop);
  });

  test('activeFrameLoop ticks every frame while active and not at all while idle', async () => {
    const act = manual(true);
    let n = 0;
    const stop = activeFrameLoop(() => n++, act);
    await wait(60);
    expect(n).toBeGreaterThan(4);
    act.set(false);
    const atIdle = n;
    await wait(80);
    expect(n).toBe(atIdle);
    act.set(true);
    await wait(40);
    expect(n).toBeGreaterThan(atIdle + 2);
    stop();
  });

  test('an idle page starts with one tick and no loop', async () => {
    const act = manual(false);
    let n = 0;
    const stop = activeFrameLoop(() => n++, act);
    await wait(60);
    expect(n).toBe(1);
    stop();
  });
});

describe('the idle-time loops use the clock', () => {
  const read = (f: string) => readFileSync(join(import.meta.dir, '..', f), 'utf8');
  test('the rotate handle has no free-running rAF loop', () => {
    const src = read('editing/rotate-handle.tsx');
    expect(src).toContain('activeFrameLoop(tick)');
    expect(src).not.toMatch(/raf = requestAnimationFrame\(tick\)/);
  });
  test('the sticky name and the minimap context poll only while the page is in use', () => {
    for (const f of ['editing/sticky-name.tsx', 'editing/minimap-context.tsx']) {
      const src = read(f);
      expect(src).toContain('activeInterval(run, pollMs)');
      expect(src).not.toContain('setInterval(');
    }
  });
});
