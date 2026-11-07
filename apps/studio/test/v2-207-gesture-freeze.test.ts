// 2.0.7 — the gesture freeze (Michal: "while you pan or zoom, artboards must not redraw … the user notices
// nothing"). While the camera moves, an artboard's own frame callbacks wait (the canvas frame shell gates
// requestAnimationFrame before any module loads — `_shell.html` `maude-frame-freeze`), its CSS animations, scripted
// Web Animations and silent videos pause (artboard-freeze.ts), and the mount ring changes nothing but the mounts
// that would otherwise show a block (artboard-live.ts). Maude's own frame code — the camera, the gesture's end,
// the chrome that follows the camera — calls the exempt clock (frame-clock.ts) and never waits.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const STUDIO = join(import.meta.dir, '..');
const SHELL = join(STUDIO, '..', '..', 'plugins', 'design', 'templates', '_shell.html');

function freezeScript(): string {
  const m = /<script id="maude-frame-freeze">([\s\S]*?)<\/script>/.exec(
    readFileSync(SHELL, 'utf8')
  );
  if (!m?.[1]) throw new Error('the canvas shell has no maude-frame-freeze script');
  return m[1];
}

interface FreezeApi {
  raf(cb: FrameRequestCallback): number;
  caf(id: number): void;
  set(on: boolean): void;
  frozen(): boolean;
  on(fn: (on: boolean) => void): () => void;
  stats(): { held: number; deferred: number; flushed: number; watchdog: number; freezes: number };
}

/** A window with a manual frame queue and a manual clock, the shell's script installed on it. */
function fakeWindow() {
  let now = 0;
  let nextId = 1;
  const frames = new Map<number, FrameRequestCallback>();
  const timers: Array<{ id: number; at: number; fn: () => void }> = [];
  const W: Record<string, unknown> = {
    requestAnimationFrame(cb: FrameRequestCallback) {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id: number) {
      frames.delete(id);
    },
    setTimeout(fn: () => void, ms: number) {
      const id = nextId++;
      timers.push({ id, at: now + ms, fn });
      return id;
    },
    clearTimeout(id: number) {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  new Function('window', freezeScript())(W);
  const raf = W.requestAnimationFrame as (cb: FrameRequestCallback) => number;
  const caf = W.cancelAnimationFrame as (id: number) => void;
  return {
    W,
    raf,
    caf,
    api: W.__maudeFrameFreeze as FreezeApi,
    /** one frame: every callback due now runs with this frame's timestamp */
    frame() {
      now += 16;
      const due = [...frames.values()];
      frames.clear();
      for (const cb of due) cb(now);
    },
    advance(ms: number) {
      now += ms;
      for (const t of timers.splice(0)) {
        if (t.at <= now) t.fn();
        else timers.push(t);
      }
    },
  };
}

describe('the frame gate in the canvas shell', () => {
  test('not frozen: a frame callback runs on the next frame as before', () => {
    const k = fakeWindow();
    const got: number[] = [];
    k.raf((t) => got.push(t));
    k.frame();
    expect(got).toEqual([16]);
  });

  test('frozen: an artboard callback waits — asked for during the freeze or due during it; the exempt one runs', () => {
    const k = fakeWindow();
    const order: string[] = [];
    k.raf(() => order.push('before')); // asked for before the freeze, due during it
    k.api.set(true);
    k.raf(() => order.push('during'));
    k.api.raf(() => order.push('camera'));
    k.frame();
    k.frame();
    expect(order).toEqual(['camera']);
    expect(k.api.stats().held).toBe(2);
  });

  test('the thaw runs what waited on the next frame, in the order it was asked for; a cancel still reaches it', () => {
    const k = fakeWindow();
    const order: Array<[string, number]> = [];
    k.api.set(true);
    k.raf((t) => order.push(['a', t]));
    const b = k.raf((t) => order.push(['b', t]));
    k.raf((t) => order.push(['c', t]));
    k.frame();
    k.caf(b);
    k.api.set(false);
    expect(order).toEqual([]); // not synchronously in the thaw
    k.frame();
    expect(order).toEqual([
      ['a', 32],
      ['c', 32],
    ]);
    expect(k.api.stats()).toMatchObject({ held: 0, flushed: 2, deferred: 3 });
  });

  test('a loop resumes after the thaw (it asks again from its own callback)', () => {
    const k = fakeWindow();
    let ticks = 0;
    const loop = () => {
      ticks += 1;
      k.raf(loop);
    };
    k.raf(loop);
    k.frame();
    k.frame();
    expect(ticks).toBe(2);
    k.api.set(true);
    for (let i = 0; i < 10; i++) k.frame();
    expect(ticks).toBe(2);
    k.api.set(false);
    k.frame();
    k.frame();
    expect(ticks).toBe(4);
  });

  test('a freeze nobody renews thaws itself (the watchdog); renewing keeps it', () => {
    const k = fakeWindow();
    const seen: boolean[] = [];
    k.api.on((on) => seen.push(on));
    k.api.set(true);
    k.advance(1500);
    k.api.set(true); // input renews it
    k.advance(1500);
    expect(k.api.frozen()).toBe(true);
    k.advance(600);
    expect(k.api.frozen()).toBe(false);
    expect(k.api.stats().watchdog).toBe(1);
    expect(seen).toEqual([true, false]); // one transition each way, not one per renewal
  });

  test('a gesture that starts again during the flush keeps the rest waiting', () => {
    const k = fakeWindow();
    const ran: string[] = [];
    k.api.set(true);
    k.raf(() => {
      ran.push('a');
      k.api.set(true); // input arrived: the camera moves again
    });
    k.raf(() => ran.push('b'));
    k.frame();
    k.api.set(false);
    k.frame();
    expect(ran).toEqual(['a']);
    k.api.set(false);
    k.frame();
    expect(ran).toEqual(['a', 'b']);
  });

  test('a callback that throws does not keep the others from running', () => {
    const k = fakeWindow();
    const ran: string[] = [];
    k.api.set(true);
    k.raf(() => {
      throw new Error('boom');
    });
    k.raf(() => ran.push('after'));
    k.frame();
    k.api.set(false);
    k.frame();
    expect(ran).toEqual(['after']);
  });
});

/** Every module the canvas frame loads from apps/studio (canvas-lib's graph + the comment layer's). */
function frameGraph(): string[] {
  const roots = ['canvas-lib.tsx', 'canvas-comment-mount.tsx'].map((r) => join(STUDIO, r));
  const seen = new Set<string>();
  const q = [...roots];
  const re =
    /(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|import\s*['"](\.[^'"]+)['"]/g;
  while (q.length) {
    const f = q.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(re)) {
      const p = resolve(dirname(f), (m[1] || m[2] || m[3]) as string);
      if (/\.(tsx?|m?js)$/.test(p) && existsSync(p)) q.push(p);
    }
  }
  return [...seen];
}

describe("Maude's own frame code never waits", () => {
  test('no module in the canvas frame calls the gated requestAnimationFrame / cancelAnimationFrame', () => {
    const files = frameGraph();
    expect(files.length).toBeGreaterThan(100);
    const bare =
      /(?<![\w$])(?:(?:window|globalThis|self)\s*\.\s*)?(?:requestAnimationFrame|cancelAnimationFrame)\s*\(|\.\s*(?:requestAnimationFrame|cancelAnimationFrame)\s*\(/;
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith('/frame-clock.ts')) continue;
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          if (bare.test(line)) offenders.push(`${relative(STUDIO, f)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  test("`maude design perf`'s frame samplers and pacers take the exempt clock (they measure the gesture)", () => {
    for (const f of ['bin/_perf-shared.mjs', 'bin/_perf-probe-open.mjs']) {
      const src = readFileSync(join(STUDIO, f), 'utf8');
      expect(src).toContain('__maudeFrameFreeze.raf');
      expect(src).not.toMatch(/(?:\bwin|\bwindow)\.requestAnimationFrame\(/);
      expect(src).not.toMatch(/[;{(\s]requestAnimationFrame\((?:loop|tick)\)/);
    }
  });

  test("the inspector's injected pins (they follow the camera) take the exempt clock", () => {
    const src = readFileSync(join(STUDIO, 'inspect.ts'), 'utf8');
    expect(src).toContain('window.__maudeFrameFreeze');
    expect(src).not.toMatch(/rafToken = requestAnimationFrame\(/);
  });
});
