// #169 T8.1b (lead decision A): during a ZOOM gesture an artboard that shows its overview still is not swapped back
// to its live body — still → live happens only at the gesture's settle. Live → still at the cut may still happen
// mid-gesture (it lowers the cost). Two places could swap mid-zoom before:
//   - the mount ring mounted an on-screen, released artboard (its placeholder showing the kept still) mid-gesture,
//     one per GESTURE_MOUNT_GAP_MS — the body mounts, lays out and paints during the zoom;
//   - the still controller handed a mount over the cut over to live at once (`register` → `handOver`).
// Kept from #212 / 2.0.7: an artboard with no still still mounts mid-gesture (a placeholder with nothing better
// is a block the user sees — decision v2-207-drop-undercut-midgesture-wait), a pure pan holds nothing, the
// selected / active artboard and a video one never wait, and an artboard that had a still never shows blank.
import { describe, expect, test } from 'bun:test';
import { LiveRegistry } from '../artboard-live.ts';
import { StillCache, StillController, type StillView } from '../artboard-still.ts';

function fakeEl(): HTMLElement {
  const el: Record<string, unknown> = {
    classList: { add() {} },
    style: {},
    setAttribute() {},
    parentNode: null,
    appendChild(c: { parentNode?: unknown }) {
      c.parentNode = el;
    },
    remove() {
      el.parentNode = null;
    },
  };
  return el as unknown as HTMLElement;
}

function fakeTarget(width: number) {
  const attrs = new Map<string, string>();
  const article = {
    offsetWidth: width,
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
    appendChild: (c: { parentNode?: unknown }) => {
      c.parentNode = article;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: width * 0.1, height: 10 }),
  } as unknown as HTMLElement;
  const body = {
    offsetLeft: 0,
    offsetTop: 0,
    offsetWidth: width,
    offsetHeight: 100,
    innerHTML: '<div>a</div>',
    style: { setProperty() {} },
  } as unknown as HTMLElement;
  return { article, body };
}

/** A still controller and a mount ring on one fake clock, wired the way the gate's runtime wires them. */
function rig() {
  let clock = 1000;
  const frames: Array<() => void> = [];
  const timers: Array<{ due: number; fn: () => void }> = [];
  const views: Array<[string, StillView]> = [];
  const t: Record<string, ReturnType<typeof fakeTarget>> = {};
  const r = new LiveRegistry('sleep', (fn) => frames.push(fn), {
    now: () => clock,
    later: (fn, ms) => timers.push({ due: clock + ms, fn }),
    budget: 300, // under the artboards' weight: not a light canvas, so a far artboard is released
  });
  const c = new StillController({
    now: () => clock,
    take: async () => fakeEl(),
    later: (fn, ms) => timers.push({ due: clock + ms, fn }),
    frame: (fn) => frames.push(fn),
    observe: null,
    info: (id) => r.slotInfo(id),
    painted: async () => {},
    makeSlot: fakeEl,
    signature: (b) => (b as unknown as { innerHTML: string }).innerHTML,
    sizeOf: () => 1000,
    cache: new StillCache(1_000_000),
    onView: (id, v) => views.push([id, v]),
  });
  r.onSettle(() => c.settle());
  r.setMayWait((id) => c.holdsForSettle(id));
  // the gate: a mounted artboard registers with the controller; a release unregisters it
  const regs = new Map<string, () => void>();
  const gate = (id: string, width = 1600) => {
    t[id] ??= fakeTarget(width);
    r.subscribe(id, (s) => {
      if (s.seen && !regs.has(id)) regs.set(id, c.register(id, t[id] as never));
      if (!s.seen && regs.has(id)) {
        regs.get(id)?.();
        regs.delete(id);
      }
    });
  };
  const tick = async (ms = 16) => {
    clock += ms;
    for (const f of frames.splice(0)) f();
    await new Promise((res) => setTimeout(res, 0));
    for (let k = 0; k < timers.length; ) {
      if ((timers[k]?.due ?? 0) <= clock) timers.splice(k, 1)[0]?.fn();
      else k += 1;
    }
    await new Promise((res) => setTimeout(res, 0));
  };
  const run = async (n = 40, ms = 16) => {
    for (let i = 0; i < n; i++) await tick(ms);
  };
  /** the published zoom + the settle at `zoom` (no gesture in flight) */
  const settled = (zoom: number) => {
    c.noteZoom(zoom);
    c.settle(zoom);
    c.setZoom(zoom);
    r.setZoom(zoom);
  };
  /** one zoom gesture frame: the camera writes the zoom; the ring hears the gesture start */
  const zoomFrame = (zoom: number) => {
    c.noteZoom(zoom);
    r.setInteracting(true);
  };
  const end = (zoom: number) => {
    r.setInteracting(false); // the ring's settle calls the controller's
    c.setZoom(zoom);
    r.setZoom(zoom);
  };
  const seq = (id: string) => views.filter(([k]) => k === id).map(([, v]) => v);
  return {
    r,
    c,
    gate,
    run,
    tick,
    settled,
    zoomFrame,
    end,
    seq,
    advance: (ms: number) => (clock += ms),
  };
}

/** An artboard drawn as a still at the overview, then released (far away), its placeholder holding the still. */
async function releasedWithStill(k: ReturnType<typeof rig>, id: string) {
  k.gate(id);
  k.r.setWeight(id, 400);
  k.r.setNear(id, true);
  k.r.setVisible(id, true);
  await k.run(200, 50); // mounted, drawn (cover → still), quiet
  expect(k.c.hasStill(id)).toBe(true);
  expect(k.c.viewOf(id)).toBe('still');
  k.r.setVisible(id, false);
  k.r.setNear(id, false);
  k.r.setKeep(id, false);
  k.advance(3000);
  await k.run(10);
  k.r.setNear(id, false); // past RELEASE_AFTER_MS: the sweep releases it
  await k.run(10);
  expect(k.r.get(id).seen).toBe(false);
  expect(k.c.hasStill(id)).toBe(true); // the placeholder holds the kept still
}

describe('#169 T8.1b — still → live only at the zoom settle', () => {
  test('a zoom gesture crossing into live zoom mounts no body that has a still until the settle; at the settle it mounts and hands over', async () => {
    const k = rig();
    k.settled(0.1); // 160 px on screen: under the cut
    await releasedWithStill(k, 'a');
    // the gesture: zoom in past the cut while the artboard comes back on screen
    k.zoomFrame(0.15);
    k.r.setNear('a', true);
    k.r.setVisible('a', true);
    for (const z of [0.2, 0.3, 0.4, 0.5]) {
      k.zoomFrame(z); // 800 px on screen at the end: well over the cut
      k.advance(400); // past GESTURE_MOUNT_GAP_MS each step
      await k.run(5);
    }
    expect(k.r.get('a').seen).toBe(false); // no body mounted mid-gesture
    expect(k.c.viewOf('a')).toBeNull(); // not registered: the placeholder still stands in
    expect(k.r.churnStats().gestureMounts).toBe(0);
    k.end(0.5);
    await k.run(60);
    expect(k.r.get('a').seen).toBe(true); // the settle mounts it
    expect(k.c.viewOf('a')).toBe('live'); // and hands it over to live (paint under the still, then reveal)
    const s = k.seq('a');
    expect(s.slice(s.lastIndexOf('still'))).toEqual(['still', 'paint', 'reveal', 'live']);
  });

  test('a mounted artboard showing its still stays the still through the zoom; the settle hands it back', async () => {
    const k = rig();
    k.settled(0.1);
    k.gate('a');
    k.r.setWeight('a', 400);
    k.r.setNear('a', true);
    k.r.setVisible('a', true);
    await k.run(200, 50);
    expect(k.c.viewOf('a')).toBe('still');
    for (const z of [0.2, 0.3, 0.5]) {
      k.zoomFrame(z);
      await k.run(5);
    }
    expect(k.c.viewOf('a')).toBe('still');
    k.end(0.5);
    await k.run(60);
    expect(k.c.viewOf('a')).toBe('live');
  });

  test('an artboard mounted mid-zoom over the cut with a kept still shows the still until the settle (no hand-over mid-gesture)', async () => {
    const k = rig();
    k.settled(0.1);
    // drawn, then unregistered, then registered again mid-gesture (a warm-up / pinned path mounts it)
    const t = { article: fakeTarget(1600).article, body: fakeTarget(1600).body };
    const off = k.c.register('b', t);
    await k.run(200, 50);
    expect(k.c.viewOf('b')).toBe('still');
    off();
    k.zoomFrame(0.3);
    k.zoomFrame(0.5);
    k.c.register('b', t);
    await k.run(20);
    expect(k.c.viewOf('b')).toBe('still');
    k.end(0.5);
    await k.run(60);
    expect(k.c.viewOf('b')).toBe('live');
  });

  test('no still yet: the artboard mounts mid-gesture as before (no blank placeholder through the zoom)', async () => {
    const k = rig();
    k.settled(0.1);
    k.gate('n');
    k.r.setWeight('n', 400);
    k.zoomFrame(0.3);
    k.zoomFrame(0.5);
    k.r.setNear('n', true);
    k.r.setVisible('n', true);
    k.advance(400);
    await k.run(5);
    expect(k.r.get('n').seen).toBe(true);
  });

  test('a pure pan holds nothing: a released artboard with a still mounts mid-pan', async () => {
    const k = rig();
    k.settled(0.5); // over the cut
    k.gate('p');
    k.r.setWeight('p', 400);
    k.r.setNear('p', true);
    k.r.setVisible('p', true);
    await k.run(20);
    // give it a still by zooming out, then release it there
    k.settled(0.1);
    await k.run(200, 50);
    expect(k.c.hasStill('p')).toBe(true);
    k.r.setVisible('p', false);
    k.r.setNear('p', false);
    k.r.setKeep('p', false);
    k.advance(3000);
    k.r.setNear('p', false);
    await k.run(10);
    expect(k.r.get('p').seen).toBe(false);
    k.settled(0.5);
    // a pan: the camera writes the same zoom
    k.zoomFrame(0.5);
    k.r.setNear('p', true);
    k.r.setVisible('p', true);
    k.advance(400);
    await k.run(5);
    expect(k.c.holdsForSettle('p')).toBe(false);
    expect(k.r.get('p').seen).toBe(true);
  });

  test('the active artboard never waits, mid-zoom too', async () => {
    const k = rig();
    k.settled(0.1);
    await releasedWithStill(k, 'act');
    k.r.setPinned('act', true);
    k.zoomFrame(0.3);
    k.r.setNear('act', true);
    k.r.setVisible('act', true);
    k.advance(400);
    await k.run(5);
    expect(k.r.get('act').seen).toBe(true);
  });
});
