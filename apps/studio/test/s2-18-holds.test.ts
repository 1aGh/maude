// S2.18 — holds (Gate 0 A10, V2-1.15 §4 #13 / §5.12): a person's soft lock rides awareness
// `holding` and is advisory; an AI run's objects are AI's (the 409 backstop lives in routes/agent.ts,
// pinned by held-by-ai-edit-routes.test.ts). This file pins:
//   - the `holding` set/clear matrix of the local publisher (focus, gesture, 30 s, blur, deselect),
//   - the receiver's clock (a peer can't hold forever by lying about time),
//   - the trust boundary (forged / oversized / foreign-actor holds),
//   - the field surviving other fields' publishes,
//   - the relay both ways through two studios and a hub (memory: test sync in both directions),
//   - the inspector's view mode and the canvas's hold view.

import { describe, expect, test } from 'bun:test';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { AI_HOLDS_MAX, DGN_TABLE, HOLD_LABEL_MAX } from '../bridge/dgn-protocol.ts';
import { viewModeOf } from '../client/v2/inspector/view-mode.jsx';
import { bridgeAwareness } from '../collab/awareness-bridge.ts';
import { createHoldClock, holdViewFor } from '../editing/hold-rings.tsx';
import {
  carryLocal,
  createHoldPublisher,
  HOLD_FREE_MS,
  type HoldingAwareness,
  readForeignPeers,
  sanitizeForeignState,
  sanitizeHoldingState,
} from '../use-collab.tsx';

// ── a fake clock + one timer slot (the publisher keeps at most one) ─────────────────────────────

function fakeTime(start = 1_000_000) {
  let t = start;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let next = 1;
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (id: unknown) => {
      timers.delete(id as number);
    },
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, x]) => x.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
      }
      t = end;
    },
  };
}

function publisher() {
  const clock = fakeTime();
  const sent: Array<HoldingAwareness | null> = [];
  const pub = createHoldPublisher({
    publish: (h) => sent.push(h),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  const last = () => (sent.length ? sent[sent.length - 1] : undefined);
  return { clock, sent, pub, last };
}

const BTN = { artboard: 'desktop', element: 'see-pricing' };

describe('holding — the local set/clear matrix (V2-1.15 §5.12)', () => {
  test('selected alone is not a hold; a focused field for it is', () => {
    const { pub, sent, last } = publisher();
    pub.select(BTN);
    expect(sent).toEqual([]);
    pub.field(true);
    expect(last()).toMatchObject({ artboard: 'desktop', element: 'see-pricing' });
    expect(typeof last()?.at).toBe('number');
  });

  test('a field blur with no recent gesture frees it', () => {
    const { pub, last } = publisher();
    pub.select(BTN);
    pub.field(true);
    pub.field(false);
    expect(last()).toBeNull();
  });

  test('an edit gesture holds for 30 s, then it frees by itself', () => {
    const { pub, last, clock } = publisher();
    pub.select(BTN);
    pub.gesture();
    expect(last()).toMatchObject(BTN);
    clock.advance(HOLD_FREE_MS - 1);
    expect(last()).not.toBeNull();
    clock.advance(2);
    expect(last()).toBeNull();
  });

  test('a gesture refreshes `at`, at most every 5 s', () => {
    const { pub, sent, clock } = publisher();
    pub.select(BTN);
    pub.gesture();
    const first = sent.length;
    clock.advance(1000);
    pub.gesture();
    expect(sent.length).toBe(first); // throttled
    clock.advance(5000);
    pub.gesture();
    expect(sent.length).toBe(first + 1);
    expect((sent[sent.length - 1] as HoldingAwareness).at).toBe(clock.now());
  });

  test('a field kept focused heartbeats, so a receiver never frees a live hold', () => {
    const { pub, sent, clock } = publisher();
    pub.select(BTN);
    pub.field(true);
    const ats = () => sent.filter(Boolean).map((h) => (h as HoldingAwareness).at);
    clock.advance(HOLD_FREE_MS * 2);
    const seen = ats();
    expect(seen.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < seen.length; i++)
      expect((seen[i] as number) - (seen[i - 1] as number)).toBeLessThan(HOLD_FREE_MS);
    expect(sent[sent.length - 1]).not.toBeNull();
  });

  test('deselect frees it; another object moves it', () => {
    const { pub, last } = publisher();
    pub.select(BTN);
    pub.field(true);
    pub.select({ artboard: 'desktop', element: 'headline' });
    expect(last()).toMatchObject({ element: 'headline' });
    pub.select(null);
    expect(last()).toBeNull();
  });

  test('window / app blur frees it; coming back with the field still focused holds again', () => {
    const { pub, last } = publisher();
    pub.select(BTN);
    pub.field(true);
    pub.app(false);
    expect(last()).toBeNull();
    pub.app(true);
    expect(last()).toMatchObject(BTN);
  });

  test('dispose frees it and leaves no timer behind', () => {
    const { pub, last, clock, sent } = publisher();
    pub.select(BTN);
    pub.gesture();
    pub.dispose();
    expect(last()).toBeNull();
    const n = sent.length;
    clock.advance(HOLD_FREE_MS * 3);
    expect(sent.length).toBe(n);
  });
});

describe('the receiver clock — a hold frees 30 s after its last refresh, by MY clock', () => {
  const peer = (clientID: number, holding: HoldingAwareness | null) =>
    sanitizeForeignState(clientID, { name: 'Tereza', holding }) as NonNullable<
      ReturnType<typeof sanitizeForeignState>
    >;

  test('fresh → live; the same `at` re-sent (awareness renewals) does not extend it', () => {
    let now = 5_000_000;
    const clock = createHoldClock(() => now);
    const h = { ...BTN, at: now - 60_000 }; // her clock is a minute behind: irrelevant
    clock.observe([peer(7, h)]);
    expect(clock.live().get(7)?.holding.element).toBe('see-pricing');
    now += HOLD_FREE_MS - 10;
    clock.observe([peer(7, h)]); // the 15 s awareness renewal, same state
    expect(clock.live().has(7)).toBe(true);
    now += 20;
    clock.observe([peer(7, h)]);
    expect(clock.live().has(7)).toBe(false);
  });

  test('a refreshed `at` keeps it; a peer that leaves (disconnect) takes its hold along', () => {
    let now = 5_000_000;
    const clock = createHoldClock(() => now);
    clock.observe([peer(7, { ...BTN, at: now })]);
    now += 20_000;
    clock.observe([peer(7, { ...BTN, at: now })]);
    now += 20_000;
    expect(clock.live().has(7)).toBe(true);
    clock.observe([]);
    expect(clock.live().size).toBe(0);
  });

  test('a far-future `at` buys nothing: the boundary drops it, so it never holds', () => {
    const now = Date.now();
    const clock = createHoldClock(() => now);
    clock.observe([peer(9, { ...BTN, at: now + 10 * 365 * 86_400_000 })]);
    expect(clock.live().size).toBe(0);
  });

  test('nextExpiry names the moment the next hold frees (the re-render timer)', () => {
    const now = 5_000_000;
    const clock = createHoldClock(() => now);
    clock.observe([peer(7, { ...BTN, at: now })]);
    expect(clock.nextExpiry()).toBe(now + HOLD_FREE_MS);
  });
});

describe('the trust boundary — sanitizeHoldingState', () => {
  const now = 2_000_000;
  test('a well-formed hold passes, rebuilt from the known keys; a foreign `actor` is ignored', () => {
    expect(
      sanitizeHoldingState(
        { artboard: 'desktop', element: 'see-pricing', at: now, actor: 'spoof@x', print: 'button' },
        now
      )
    ).toEqual({ artboard: 'desktop', element: 'see-pricing', at: now, print: 'button' });
    expect(sanitizeHoldingState({ artboard: 'p', element: 'a1b2c3d4', at: now }, now)).toEqual({
      artboard: 'p',
      element: 'a1b2c3d4',
      at: now,
    });
    expect(sanitizeHoldingState(null, now)).toBeNull();
  });

  const bad: Array<[string, unknown]> = [
    ['not an object', 'everything'],
    ['an array', [1, 2]],
    ['an unknown key', { artboard: 'p', element: 'e', at: now, lease: 'all' }],
    ['a bad artboard id', { artboard: '../x', element: 'e', at: now }],
    ['a bad element id', { artboard: 'p', element: 'E"]', at: now }],
    ['an oversized element id', { artboard: 'p', element: `e${'x'.repeat(60)}`, at: now }],
    ['an oversized print', { artboard: 'p', element: 'e', at: now, print: 'x'.repeat(600) }],
    ['a non-finite at', { artboard: 'p', element: 'e', at: Number.POSITIVE_INFINITY }],
    ['a future at', { artboard: 'p', element: 'e', at: now + 60_000 }],
    ['no at', { artboard: 'p', element: 'e' }],
  ];
  for (const [why, raw] of bad) {
    test(`dropped whole: ${why}`, () => {
      expect(sanitizeHoldingState(raw, now)).toBeNull();
    });
  }

  test('sanitizeForeignState: a bad hold drops the field, never the peer', () => {
    const p = sanitizeForeignState(3, { name: 'Tereza', holding: { artboard: 'p' } });
    expect(p?.name).toBe('Tereza');
    expect(p?.holding).toBeNull();
  });
});

describe('the field survives other fields’ publishes (kept across setLocalState)', () => {
  test('carryLocal keeps holding beside editing / present / watching / pointer', () => {
    const holding = { ...BTN, at: 1 };
    expect(carryLocal({ holding }).holding).toEqual(holding);
    expect(carryLocal({}).holding).toBeNull();
    expect(Object.keys(carryLocal({})).sort()).toEqual(
      [
        'artboard',
        'editing',
        'followTarget',
        'holding',
        'idleSince',
        'inComments',
        'pointer',
        'present',
        'summon',
        'surface',
        'watching',
      ].sort()
    );
  });
});

// ── two studios and a hub: browser → room → provider → hub → provider → room → browser ─────────

function mk(): Awareness {
  return new Awareness(new Y.Doc());
}
/** The hub: a plain relay between two providers' awareness (its own stamping is hub-tested). */
function link(x: Awareness, y: Awareness) {
  const T = { hub: true };
  const fwd =
    (from: Awareness, to: Awareness) =>
    (c: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === T) return;
      const changed = c.added.concat(c.updated, c.removed);
      if (changed.length) applyAwarenessUpdate(to, encodeAwarenessUpdate(from, changed), T);
    };
  x.on('update', fwd(x, y));
  y.on('update', fwd(y, x));
}
/** A browser tab in a studio's room (its own Awareness, relayed both ways). */
function tab(room: Awareness): Awareness {
  const t = mk();
  link(t, room);
  return t;
}

describe('across two studios, both directions', () => {
  function world() {
    const roomA = mk();
    const provA = mk();
    const roomB = mk();
    const provB = mk();
    bridgeAwareness(roomA, provA);
    bridgeAwareness(roomB, provB);
    link(provA, provB);
    return { tabA: tab(roomA), tabB: tab(roomB) };
  }
  const now = () => Date.now();

  for (const dir of ['A → B', 'B → A'] as const) {
    test(`${dir}: a hold crosses, the sender's actor claim never leaves its studio, a clear crosses`, () => {
      const w = world();
      const [from, to] = dir === 'A → B' ? [w.tabA, w.tabB] : [w.tabB, w.tabA];
      from.setLocalState({ name: 'Tereza', holding: { ...BTN, at: now(), actor: 'boss@x' } });
      const seen = readForeignPeers(to).find((p) => p.name === 'Tereza');
      expect(seen?.holding).toMatchObject(BTN);
      // the raw relayed state carries no client-claimed actor (the hub stamps its own)
      const raw = [...to.getStates().values()].find(
        (s) => (s as { name?: string }).name === 'Tereza'
      ) as { holding?: { actor?: string } };
      expect(raw.holding?.actor).toBeUndefined();
      from.setLocalState({ name: 'Tereza', holding: null });
      expect(readForeignPeers(to).find((p) => p.name === 'Tereza')?.holding).toBeNull();
    });
  }

  test('an oversized hold is scrubbed before it leaves the studio', () => {
    const w = world();
    w.tabA.setLocalState({
      name: 'Tereza',
      holding: { ...BTN, at: now(), print: 'x'.repeat(100_000) },
    });
    const raw = [...w.tabB.getStates().values()].find(
      (s) => (s as { name?: string }).name === 'Tereza'
    ) as { holding?: unknown };
    expect(raw.holding).toBeNull();
  });
});

describe('what the shell shows (inspector view mode) and what the canvas reports', () => {
  test('a person’s hold: view mode, the line and Comment; the words name them', () => {
    const v = viewModeOf({ person: { name: 'Tereza' }, label: 'See pricing', ai: null });
    expect(v.view).toBe(true);
    expect(v.line).toEqual({
      tone: 'people',
      text: 'Tereza is editing See pricing. You can look; the fields open when they move on.',
      comment: true,
    });
  });

  test('an AI hold on the selection: view mode + the tip; mine says where Stop is', () => {
    expect(
      viewModeOf({ person: null, label: 'Footer', ai: { label: 'Footer', held: true, mine: true } })
    ).toEqual({
      view: true,
      line: {
        tone: 'ai',
        text: "Footer is AI's until it's done · Stop in the AI chat",
        comment: false,
      },
    });
    expect(
      viewModeOf({
        person: null,
        label: 'Footer',
        ai: { label: 'Footer', held: true, mine: false },
      }).line?.text
    ).toBe("Footer is AI's until it's done");
  });

  test('an AI hold elsewhere in the artboard: fields stay open, one line says what is AI’s', () => {
    expect(
      viewModeOf({
        person: null,
        label: 'Headline',
        ai: { label: 'Footer', held: false, mine: true },
      })
    ).toEqual({
      view: false,
      line: {
        tone: 'ai',
        text: 'AI is changing Footer in this artboard. Everything else stays yours.',
        comment: false,
      },
    });
    expect(viewModeOf(null)).toEqual({ view: false, line: null });
  });

  test('holdViewFor: the selection’s person and AI holds, by artboard + element', () => {
    const live = new Map([[7, { name: 'Tereza', holding: { ...BTN, at: 1 } }]]);
    const ai = [
      { artboard: 'desktop', element: 'footer', tag: 'AI is drawing the footer', mine: true },
    ];
    const label = (r: { element: string }) => (r.element === 'footer' ? 'Footer' : 'See pricing');
    expect(holdViewFor(BTN, live, ai, label)).toEqual({
      person: { name: 'Tereza' },
      label: 'See pricing',
      ai: { label: 'Footer', held: false, mine: true },
    });
    expect(holdViewFor({ artboard: 'desktop', element: 'footer' }, live, ai, label)).toEqual({
      person: null,
      label: 'Footer',
      ai: { label: 'Footer', held: true, mine: true },
    });
    expect(holdViewFor({ artboard: 'mobile', element: 'x' }, live, ai, label)).toBeNull();
    expect(holdViewFor(null, live, ai, label)).toBeNull();
  });
});

describe('the bridge rows (dgn-protocol.ts)', () => {
  const { c2s, s2c } = DGN_TABLE;
  test('hold-view: names and labels are bounded text; a bad one refuses the message', () => {
    const ok = { person: { name: 'Tereza' }, label: 'See pricing', ai: null };
    expect(c2s['hold-view'].parse(ok)).toEqual(ok);
    expect(c2s['hold-view'].parse({ ...ok, label: 'x'.repeat(HOLD_LABEL_MAX + 1) })).toBeNull();
    expect(c2s['hold-view'].parse({ ...ok, person: { name: 7 } })).toBeNull();
  });
  test('hold-intent: three booleans, parent-gated', () => {
    expect(s2c['hold-intent'].gate).toBe('parent');
    expect(s2c['hold-intent'].parse({ field: true, app: true })).toEqual({
      field: true,
      app: true,
    });
    expect(s2c['hold-intent'].parse({ field: 'yes', app: true })).toBeNull();
  });
  test('ai-holds: a tag and a flag per object, capped; an oversized list refuses whole', () => {
    const row = {
      artboard: 'desktop',
      element: 'footer',
      tag: 'AI is drawing the footer',
      mine: true,
    };
    expect(s2c['ai-holds'].parse({ holds: [row] })).toEqual({ holds: [row] });
    expect(s2c['ai-holds'].parse({ holds: Array(AI_HOLDS_MAX + 1).fill(row) })).toBeNull();
    // only the known keys cross: no prompt can ride along
    expect(s2c['ai-holds'].parse({ holds: [{ ...row, prompt: 'p' }] })).toEqual({ holds: [row] });
    expect(s2c['ai-holds'].parse({ holds: [{ ...row, tag: 'x'.repeat(500) }] })).toBeNull();
  });
});
