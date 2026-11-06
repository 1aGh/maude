// 2.0.5 — a canvas that keeps crashing the page is not reopened in a loop: after CRASH_LIMIT deaths of the
// same canvas within CRASH_WINDOW_MS the viewport shows the too-heavy card instead of the frame.
import { beforeEach, describe, expect, test } from 'bun:test';
import {
  CRASH_KEY,
  CRASH_LIMIT,
  CRASH_WINDOW_MS,
  createCrashGuard,
  RECOVERED_PARAM,
  takeRecoveredMarker,
} from '../client/v2/shell/canvas-crash-guard.js';

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => m.set(k, v),
  };
}

/**
 * One page life: boot, open `path`, then either a clean unload or a crash (nothing runs). A crash is
 * followed by the shell's recovery navigation, so the NEXT boot carries the `maude-recovered` marker.
 */
let recoveredNext = false;
function life(storage: ReturnType<typeof memStorage>, t: number, path: string, crash: boolean) {
  const g = createCrashGuard(storage, () => t, { recovered: recoveredNext });
  recoveredNext = crash;
  const heavy = g.tooHeavy(path);
  if (!heavy) g.noteOpen(path);
  if (!crash) g.noteClean();
  return heavy;
}

describe('canvas crash guard', () => {
  beforeEach(() => {
    recoveredNext = false;
  });

  test('crashes of one canvas past the limit stop it reopening', () => {
    const st = memStorage();
    const p = 'ui/mascot.tsx';
    let t = 1000;
    const shown: boolean[] = [];
    for (let i = 0; i < 4; i += 1) {
      t += 1000;
      shown.push(life(st, t, p, true));
    }
    // the page boots CRASH_LIMIT times into the canvas, then the card stands in and the loop is over
    expect(shown).toEqual([false, false, true, true]);
    expect(CRASH_LIMIT).toBe(2);
    expect(createCrashGuard(st, () => t).crashCount(p)).toBe(CRASH_LIMIT);
  });

  test('a clean unload is not a crash', () => {
    const st = memStorage();
    for (let i = 0; i < 5; i += 1) expect(life(st, 1000 + i, 'a.tsx', false)).toBe(false);
  });

  test('crashes age out of the window', () => {
    const st = memStorage();
    life(st, 0, 'a.tsx', true);
    life(st, 10, 'a.tsx', true);
    expect(createCrashGuard(st, () => 20, { recovered: true }).tooHeavy('a.tsx')).toBe(true);
    expect(createCrashGuard(st, () => 10 + CRASH_WINDOW_MS).tooHeavy('a.tsx')).toBe(false);
  });

  test('another canvas is untouched; the lighter mode reopens it and survives a reload', () => {
    const st = memStorage();
    life(st, 0, 'a.tsx', true);
    life(st, 1, 'a.tsx', true);
    const g = createCrashGuard(st, () => 2, { recovered: true });
    expect(g.tooHeavy('b.tsx')).toBe(false);
    expect(g.tooHeavy('a.tsx')).toBe(true);
    g.chooseLight('a.tsx');
    expect(g.tooHeavy('a.tsx')).toBe(false);
    const after = createCrashGuard(st, () => 3);
    expect(after.isLight('a.tsx')).toBe(true);
    after.forgive('a.tsx');
    expect(after.isLight('a.tsx')).toBe(false);
    expect(after.crashCount('a.tsx')).toBe(0);
  });

  test('garbage in storage does not throw', () => {
    const st = memStorage();
    st.setItem('maude.canvas-crash.v1', '{nope');
    expect(createCrashGuard(st).tooHeavy('a.tsx')).toBe(false);
    expect(createCrashGuard(null).tooHeavy('a.tsx')).toBe(false);
  });

  // 2.0.7 — WKWebView fires no `pagehide` when the app quits, so a quit left the live mark behind and two
  // quits with Deck open made it "too heavy". Only a boot the shell's crash recovery brought back counts.
  test('a boot with a live mark but no recovery marker counts nothing and drops the mark', () => {
    const st = memStorage();
    for (let i = 0; i < 3; i += 1) {
      const g = createCrashGuard(st, () => 1000 + i);
      expect(g.crashCount('ui/Deck.tsx')).toBe(0);
      expect(g.tooHeavy('ui/Deck.tsx')).toBe(false);
      g.noteOpen('ui/Deck.tsx'); // the app quits here: no pagehide, the mark stays
      expect(JSON.parse(st.getItem(CRASH_KEY) as string).live).toBe('ui/Deck.tsx');
    }
    createCrashGuard(st, () => 2000);
    expect(JSON.parse(st.getItem(CRASH_KEY) as string).live).toBe(null);
  });

  test('a recovered boot counts one; two within the window make it too heavy', () => {
    const st = memStorage();
    createCrashGuard(st, () => 0).noteOpen('ui/Deck.tsx');
    const first = createCrashGuard(st, () => 10, { recovered: true });
    expect(first.crashCount('ui/Deck.tsx')).toBe(1);
    expect(first.tooHeavy('ui/Deck.tsx')).toBe(false);
    first.noteOpen('ui/Deck.tsx');
    const second = createCrashGuard(st, () => 20, { recovered: true });
    expect(second.crashCount('ui/Deck.tsx')).toBe(2);
    expect(second.tooHeavy('ui/Deck.tsx')).toBe(true);
  });

  test('a recovered boot with no live mark counts nothing', () => {
    const st = memStorage();
    expect(createCrashGuard(st, () => 0, { recovered: true }).crashCount('a.tsx')).toBe(0);
  });

  test('the recovery marker is read once and stripped from the address', () => {
    const calls: unknown[][] = [];
    const win = {
      location: { href: `http://localhost:4403/?open=ui%2FDeck.tsx&${RECOVERED_PARAM}=1#x` },
      history: {
        state: { open: 'ui/Deck.tsx' },
        replaceState: (...a: unknown[]) => calls.push(a),
      },
    };
    expect(takeRecoveredMarker(win)).toBe(true);
    expect(calls).toEqual([[{ open: 'ui/Deck.tsx' }, '', '/?open=ui%2FDeck.tsx#x']]);

    const plain = {
      location: { href: 'http://localhost:4403/?open=ui%2FDeck.tsx' },
      history: { state: null, replaceState: (...a: unknown[]) => calls.push(a) },
    };
    expect(takeRecoveredMarker(plain)).toBe(false);
    expect(calls.length).toBe(1); // an address without the marker is left alone
    expect(takeRecoveredMarker(null)).toBe(false);
  });
});
