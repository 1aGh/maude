// 2.0.7 — the stills' warm-up (artboard-still-warmup.ts): artboards that never mount during a sweep get their still
// while nothing moves, so a first pass shows stills, not flat own-colour blocks. Pinned here:
//   - one artboard at a time, nearest first, only after the quiet, each released once its still is drawn;
//   - any input pauses it at once (a mount asked for but not made is withdrawn; a made one is released only when
//     quiet again); the zoom's settle wakes it;
//   - never past the DOM budget nor the still cache's byte budget, never an artboard with a still, over the cut,
//     already tried, near / on screen, pinned or a video (eager);
//   - the registry: a warm mount is far, asleep, within the budget, never mid-gesture; its release is at once;
//   - the still controller: quiet() follows the gesture, the settle hold, the hand-back and the drawings; onStill.
import { describe, expect, test } from 'bun:test';
import { LiveRegistry } from '../artboard-live.ts';
import { STILL_SETTLE_HOLD_MS, StillCache, StillController } from '../artboard-still.ts';
import {
  StillWarmup,
  WARM_GAP_MS,
  WARM_QUIET_MS,
  WARM_STEP_MAX_MS,
  type WarmCandidate,
  type WarmHost,
} from '../artboard-still-warmup.ts';

/** A fake runtime: artboards with a distance, a clock, timers; mount → (later) mounted → (later) still drawn. */
function host(ids: string[]) {
  let clock = 10_000;
  const timers: Array<{ fn: () => void; due: number; id: number }> = [];
  let tid = 0;
  const mounted = new Set<string>();
  const asked = new Set<string>();
  const stills = new Set<string>();
  const log: string[] = [];
  const st = {
    quiet: true,
    activity: Number.NEGATIVE_INFINITY,
    room: true,
    over: new Set<string>(), // over the cut
    nofit: new Set<string>(),
    dist: new Map(ids.map((id, i) => [id, (i + 1) * 100])),
  };
  const h: WarmHost = {
    now: () => clock,
    later: (fn, ms) => {
      tid += 1;
      timers.push({ fn, due: clock + ms, id: tid });
      return tid;
    },
    cancel: (k) => {
      const i = timers.findIndex((t) => t.id === k);
      if (i >= 0) timers.splice(i, 1);
    },
    candidates: (): WarmCandidate[] =>
      ids
        .filter((id) => !mounted.has(id) && !asked.has(id))
        .map((id) => ({ id, dist: st.dist.get(id) ?? 0, fits: !st.nofit.has(id) })),
    wanted: (id) => !st.over.has(id),
    hasStill: (id) => stills.has(id),
    mount: (id) => {
      asked.add(id);
      log.push(`mount ${id}`);
    },
    release: (id) => {
      asked.delete(id);
      mounted.delete(id);
      log.push(`release ${id}`);
    },
    mounted: (id) => mounted.has(id),
    quiet: () => st.quiet,
    lastActivity: () => st.activity,
    cacheRoom: () => st.room,
  };
  const wu = new StillWarmup(h);
  /** advance the clock, running due timers in order */
  const advance = (ms: number) => {
    const end = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.due - b.due);
      const t = timers[0];
      if (!t || t.due > end) break;
      timers.shift();
      clock = Math.max(clock, t.due);
      t.fn();
    }
    clock = end;
  };
  /** the drain made the mount (asked → mounted) */
  const mountAll = () => {
    for (const id of asked) {
      mounted.add(id);
      asked.delete(id);
    }
  };
  /** the controller drew the still of what is mounted */
  const drawAll = (ok = true) => {
    for (const id of [...mounted]) {
      if (ok) stills.add(id);
      wu.stillDone(id, ok);
    }
  };
  return { wu, st, log, advance, mountAll, drawAll, mounted, asked, stills, now: () => clock };
}

/** run the fake to the end: each mount is made, then drawn, frame after frame */
function runToEnd(r: ReturnType<typeof host>, ms = 60_000) {
  for (let t = 0; t < ms; t += 50) {
    r.advance(50);
    r.mountAll();
    r.drawAll();
  }
}

describe('the warm-up loop', () => {
  test('one artboard at a time, nearest first, only after the quiet; released once drawn; done when all have stills', () => {
    const r = host(['far', 'near', 'mid']);
    r.st.dist.set('far', 900).set('near', 100).set('mid', 500);
    r.st.activity = r.now(); // the canvas just opened
    r.wu.kick();
    r.advance(WARM_QUIET_MS - 100);
    expect(r.log).toEqual([]); // not before the quiet
    r.advance(300);
    expect(r.log).toEqual(['mount near']);
    expect(r.wu.stats().state).toBe('mounting');
    // made, but not drawn: nothing else mounts, nothing is released
    r.mountAll();
    r.advance(2000);
    expect(r.log).toEqual(['mount near']);
    expect(r.wu.stats().state).toBe('drawing');
    r.drawAll();
    r.advance(10);
    expect(r.log).toEqual(['mount near', 'release near']); // released at once when quiet
    r.advance(WARM_GAP_MS + 200);
    expect(r.log.at(-1)).toBe('mount mid');
    runToEnd(r);
    expect(r.log).toEqual([
      'mount near',
      'release near',
      'mount mid',
      'release mid',
      'mount far',
      'release far',
    ]);
    const s = r.wu.stats();
    expect(s.state).toBe('done');
    expect(s.warmed).toBe(3);
    expect(s.finishedAt).not.toBeNull();
    expect(r.mounted.size).toBe(0);
  });

  test('any input pauses it at once: a mount asked for and not made is withdrawn; nothing more until the quiet', () => {
    const r = host(['a', 'b']);
    r.wu.kick();
    r.advance(WARM_QUIET_MS + 200);
    expect(r.log).toEqual(['mount a']);
    r.wu.input(); // a wheel, before the drain made the mount
    expect(r.log).toEqual(['mount a', 'release a']);
    expect(r.wu.stats().state).toBe('paused');
    r.advance(WARM_QUIET_MS - 50);
    expect(r.log).toEqual(['mount a', 'release a']);
    r.advance(300);
    expect(r.log.at(-1)).toBe('mount a'); // tried again once quiet (it was withdrawn, not tried)
  });

  test('a made mount is released only when quiet; input mid-drawing leaves it to finish', () => {
    const r = host(['a', 'b']);
    r.wu.kick();
    r.advance(WARM_QUIET_MS + 200);
    r.mountAll();
    r.wu.input(); // a pan starts while it is drawn
    expect(r.log).toEqual(['mount a']); // not released mid-input: a release is an unmount
    r.st.quiet = false; // the gesture
    r.drawAll();
    r.advance(WARM_QUIET_MS + 500);
    expect(r.log).toEqual(['mount a']);
    r.st.quiet = true;
    r.advance(200);
    expect(r.log).toEqual(['mount a', 'release a']);
  });

  test('a camera move counts as input (lastActivity); a busy controller holds it', () => {
    const r = host(['a']);
    r.st.quiet = false;
    r.wu.kick();
    r.advance(WARM_QUIET_MS * 3);
    expect(r.log).toEqual([]);
    r.st.quiet = true;
    r.st.activity = r.now(); // a programmatic zoom
    r.advance(WARM_QUIET_MS - 100);
    expect(r.log).toEqual([]);
    r.advance(300);
    expect(r.log).toEqual(['mount a']);
  });

  test('never past the DOM budget nor the still cache; never one with a still, over the cut, or tried', () => {
    const r = host(['big', 'over', 'has', 'ok']);
    r.st.nofit.add('big');
    r.st.over.add('over');
    r.stills.add('has');
    r.wu.kick();
    runToEnd(r);
    expect(r.log).toEqual(['mount ok', 'release ok']);
    expect(r.wu.stats().state).toBe('full');
    expect(r.wu.stats().full).toBe('budget');
    // the cache has no room: it stops before mounting
    const c = host(['a', 'b']);
    c.st.room = false;
    c.wu.kick();
    runToEnd(c);
    expect(c.log).toEqual([]);
    expect(c.wu.stats().full).toBe('cache');
    // a drawing that failed (no still) is not tried again
    const f = host(['x']);
    f.wu.kick();
    for (let t = 0; t < 20_000; t += 50) {
      f.advance(50);
      f.mountAll();
      f.drawAll(false);
    }
    expect(f.log).toEqual(['mount x', 'release x']);
    expect(f.wu.stats().failed).toBe(1);
  });

  test('a mount whose still never comes is released after WARM_STEP_MAX_MS; a settle wakes a finished warm-up', () => {
    const r = host(['a']);
    r.wu.kick();
    r.advance(WARM_QUIET_MS + 200);
    r.mountAll();
    r.advance(WARM_STEP_MAX_MS + 500);
    expect(r.log).toEqual(['mount a', 'release a']);
    expect(r.wu.stats().failed).toBe(1);
    // done; a zoom-out brings a new artboard under the cut: the settle wakes it
    const w = host(['a', 'b']);
    w.st.over.add('b');
    w.wu.kick();
    runToEnd(w);
    expect(w.wu.stats().state).toBe('done');
    w.st.over.delete('b');
    w.wu.wake();
    runToEnd(w);
    expect(w.log).toEqual(['mount a', 'release a', 'mount b', 'release b']);
  });
});

/** a manual rAF queue for the registry */
function manual() {
  const q: Array<() => void> = [];
  return {
    schedule: (fn: () => void) => q.push(fn),
    flush: () => {
      for (let i = 0; i < 50 && q.length; i++) for (const f of q.splice(0)) f();
    },
  };
}

describe('the registry side', () => {
  test('a warm mount: far, asleep, within the budget; released at once; never mid-gesture', () => {
    const m = manual();
    let clock = 0;
    const r = new LiveRegistry('sleep', m.schedule, { now: () => clock, budget: 1000 });
    for (const id of ['a', 'b', 'v', 'p', 'n']) r.subscribe(id, () => {});
    r.setWeight('a', 1);
    r.setEager('v', true);
    r.setPinned('p', true);
    r.setNear('n', true);
    m.flush();
    const ids = r.warmCandidates().map((k) => k.id);
    expect(ids.sort()).toEqual(['a', 'b']); // not eager (mounted anyway), pinned, near
    r.setWarm('a', true);
    m.flush();
    expect(r.get('a')).toEqual({ live: false, seen: true, media: true });
    expect(r.isMounted('a')).toBe(true);
    expect(r.lastMountAt()).toBe(0);
    r.setWarm('a', false);
    expect(r.get('a').seen).toBe(false); // at once, not the keep ring's grace
    // mid-gesture: asked, not made until the settle
    r.setInteracting(true);
    r.setWarm('b', true);
    m.flush();
    expect(r.isMounted('b')).toBe(false);
    r.setInteracting(false);
    m.flush();
    expect(r.isMounted('b')).toBe(true);
    // one that came near while warm stays mounted on its release
    r.setNear('b', true);
    r.setWarm('b', false);
    expect(r.isMounted('b')).toBe(true);
  });

  test('a warm mount never goes past the DOM budget; warmCandidates says it does not fit', () => {
    const m = manual();
    const r = new LiveRegistry('sleep', m.schedule, { budget: 500 });
    for (const id of ['x', 'y']) r.subscribe(id, () => {});
    r.setNear('x', true);
    r.setVisible('x', true);
    m.flush();
    r.setWeight('x', 450);
    r.setWeight('y', 200);
    r.setVisible('x', false);
    r.setNear('x', false);
    const y = r.warmCandidates().find((k) => k.id === 'y');
    expect(y?.fits).toBe(false);
    r.setWarm('y', true);
    m.flush();
    expect(r.isMounted('y')).toBe(false);
  });

  test('light mode and a capture offer nothing to warm', () => {
    const m = manual();
    const l = new LiveRegistry('light', m.schedule);
    l.subscribe('a', () => {});
    expect(l.warmCandidates()).toEqual([]);
    const s = new LiveRegistry('sleep', m.schedule);
    s.subscribe('a', () => {});
    const release = s.holdAllLive();
    expect(s.warmCandidates()).toEqual([]);
    release();
  });
});

describe('the still controller side', () => {
  test('quiet(): not in a gesture, not in the settle hold, not while a drawing waits; onStill fires', async () => {
    let clock = 0;
    const frames: Array<() => void> = [];
    const done: Array<[string, boolean]> = [];
    const el = () =>
      ({
        classList: { add() {} },
        style: {},
        setAttribute() {},
        parentNode: null,
        appendChild() {},
        remove() {},
      }) as unknown as HTMLElement;
    const target = {
      article: {
        offsetWidth: 1600,
        setAttribute() {},
        removeAttribute() {},
        appendChild() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
      } as unknown as HTMLElement,
      body: {
        offsetLeft: 0,
        offsetTop: 0,
        offsetWidth: 1600,
        offsetHeight: 100,
        innerHTML: '<i></i>',
        style: { setProperty() {} },
      } as unknown as HTMLElement,
    };
    const c = new StillController({
      now: () => clock,
      take: async () => el(),
      later: () => 0,
      frame: (fn) => frames.push(fn),
      observe: null,
      info: () => ({ visible: false, weight: 1 }),
      painted: async () => {},
      makeSlot: el,
      signature: () => 's',
      sizeOf: () => 1,
      cache: new StillCache(1000),
    });
    c.onStill((id, ok) => done.push([id, ok]));
    c.noteZoom(0.1);
    expect(c.quiet()).toBe(false); // a gesture
    c.noteZoom(0.12);
    c.settle(0.1);
    c.setZoom(0.1);
    expect(c.quiet()).toBe(false); // the settle hold
    expect(c.lastActivity()).toBe(0);
    clock += STILL_SETTLE_HOLD_MS + 1;
    expect(c.quiet()).toBe(true);
    c.register('a', target);
    expect(c.zoomNow()).toBe(0.1);
    for (const f of frames.splice(0)) f(); // the first frame starts the drawing
    expect(c.quiet()).toBe(true);
    expect(c.quiet(true)).toBe(false); // a drawing in flight: not quiet for the warm-up
    expect(done).toEqual([]);
    for (let i = 0; i < 5; i++) {
      await new Promise((res) => setTimeout(res, 0));
      for (const f of frames.splice(0)) f();
    }
    expect(done).toEqual([['a', true]]);
    expect(c.hasStill('a')).toBe(true);
    expect(c.quiet(true)).toBe(true);
  });
});
