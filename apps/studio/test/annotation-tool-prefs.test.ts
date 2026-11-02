// annotation-tool-prefs — S4.8 (Q8): the colours the annotation tools remember, per person.
//
//   new — the palette gate (tool-prefs.ts): only members of a palette survive, whoever sends them
//   new — `annotationPrefs` in prefs.json: validated, merged key by key, round-trips on disk
//   new — the canvas's tool state: persists only what changed, a late shell read never undoes a click,
//         the remembered Marker tip is the one M arms
//   new — the shell's store: a reload restores (prefs.json, or the localStorage mirror in a cloud tab)
//   new — the bridge rows (`annotation-prefs-set` active / `annotation-prefs` parent) and the shell lane:
//         only the ACTIVE canvas's own window can write, every frame hears the change

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
  checkAnnotationPrefsPatch,
  DEFAULT_ANNOTATION_PREFS,
  HIGHLIGHTER_SWATCHES,
  INK_FRONT,
  INK_MORE,
  resolveInk,
  STICKY_FRONT,
  STICKY_MORE,
  sanitizeAnnotationPrefs,
} from '../annotations/ui/tool-prefs.ts';
import { createToolState } from '../annotations/ui/tool-state.ts';
import { HIGHLIGHTER_PALETTE, STICKY_PALETTE, STROKE_PALETTE } from '../annotations-model.ts';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import { createAnnotationPrefsStore } from '../client/v2/shell/annotation-prefs-store.js';
import { useAnnotationPrefsLane } from '../client/v2/shell/use-annotation-prefs.js';
import { lastMarkerTip, rememberMarkerTip } from '../toolbars/marker-tip.ts';
import { uiPrefsPath, validateUiPrefsPatch, writeUiPrefs } from '../ui-prefs.ts';

describe('the palette gate', () => {
  test("canvas 15's fronts: 5 papers + 5, 5 inks (black first) + 4, 4 highlighter hues — every palette member once", () => {
    expect(STICKY_FRONT.map((s) => s.name)).toEqual(['Yellow', 'Coral', 'Green', 'Sky', 'Lilac']);
    expect(STICKY_MORE.map((s) => s.name)).toEqual(['White', 'Grey', 'Peach', 'Aqua', 'Pink']);
    expect([...STICKY_FRONT, ...STICKY_MORE].map((s) => s.hex).sort()).toEqual(
      [...STICKY_PALETTE].sort()
    );
    expect(INK_FRONT.map((s) => s.name)).toEqual(['Ink', 'Red', 'Amber', 'Green', 'Blue']);
    expect(INK_MORE.map((s) => s.name)).toEqual(['Orange', 'Purple', 'Pink', 'Grey']);
    expect([...INK_FRONT, ...INK_MORE].map((s) => s.hex).sort()).toEqual(
      [...STROKE_PALETTE].sort()
    );
    expect(HIGHLIGHTER_SWATCHES.map((s) => s.hex)).toEqual([...HIGHLIGHTER_PALETTE]);
  });

  test('only palette members survive; anything else is dropped, never coerced', () => {
    expect(
      sanitizeAnnotationPrefs({
        stickyColor: STICKY_PALETTE[3],
        ink: 'url(javascript:alert(1))',
        thickness: 6,
        tip: 'eraser',
        highlighterColor: '#123456',
        highlighterWidth: 18,
        extra: 1,
      })
    ).toEqual({
      stickyColor: STICKY_PALETTE[3],
      thickness: 6,
      tip: 'eraser',
      highlighterWidth: 18,
    });
    expect(sanitizeAnnotationPrefs(null)).toEqual({});
    expect(sanitizeAnnotationPrefs(['x'])).toEqual({});
    expect(sanitizeAnnotationPrefs({ thickness: 4, tip: 'brush', highlighterWidth: 19 })).toEqual(
      {}
    );
  });

  test('the default ink renders themed; every other ink is the hex picked', () => {
    expect(resolveInk(DEFAULT_ANNOTATION_PREFS.ink, '#ededed')).toBe('#ededed');
    expect(resolveInk(STROKE_PALETTE[0], '#ededed')).toBe(STROKE_PALETTE[0]);
  });
});

describe('prefs.json — `annotationPrefs`', () => {
  test('the body is validated whole: a bad field or an unknown key rejects, nothing is reset', () => {
    expect(validateUiPrefsPatch({ annotationPrefs: { stickyColor: STICKY_PALETTE[1] } })).toEqual({
      ok: true,
      patch: { annotationPrefs: { stickyColor: STICKY_PALETTE[1] } },
    });
    expect(validateUiPrefsPatch({ annotationPrefs: { stickyColor: 'red' } }).ok).toBe(false);
    expect(validateUiPrefsPatch({ annotationPrefs: { cursor: 'wait' } }).ok).toBe(false);
    expect(validateUiPrefsPatch({ annotationPrefs: 'yellow' }).ok).toBe(false);
    expect(checkAnnotationPrefsPatch({}).ok).toBe(true);
  });

  test('a patch changes its keys and keeps its siblings; the file restores on the next read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'maude-annot-prefs-'));
    const old = process.env.MAUDE_UI_PREFS_PATH;
    process.env.MAUDE_UI_PREFS_PATH = join(dir, 'prefs.json');
    try {
      writeUiPrefs({ annotationPrefs: { stickyColor: STICKY_PALETTE[7], ink: STROKE_PALETTE[4] } });
      writeUiPrefs({ annotationPrefs: { ink: STROKE_PALETTE[0], tip: 'highlighter' } });
      const onDisk = JSON.parse(readFileSync(uiPrefsPath(), 'utf8'));
      expect(onDisk.annotationPrefs).toEqual({
        stickyColor: STICKY_PALETTE[7],
        ink: STROKE_PALETTE[0],
        tip: 'highlighter',
      });
      // the v1 show/hide switch is untouched by the new key
      expect(onDisk.annotations).toBe(true);
    } finally {
      if (old === undefined) delete process.env.MAUDE_UI_PREFS_PATH;
      else process.env.MAUDE_UI_PREFS_PATH = old;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the canvas tool state', () => {
  test('starts on the defaults; a change persists only the fields it names', () => {
    const writes: unknown[] = [];
    const s = createToolState({ persist: (p) => writes.push(p) });
    expect(s.get()).toEqual(DEFAULT_ANNOTATION_PREFS);
    expect(s.set({ stickyColor: STICKY_PALETTE[5] })).toBe(true);
    expect(s.get().stickyColor).toBe(STICKY_PALETTE[5]);
    expect(writes).toEqual([{ stickyColor: STICKY_PALETTE[5] }]);
    // nothing new: no write, no notification
    expect(s.set({ stickyColor: STICKY_PALETTE[5] })).toBe(false);
    expect(writes.length).toBe(1);
    // a value outside the palette changes nothing
    expect(s.set({ ink: '#abcdef' })).toBe(false);
    expect(s.get().ink).toBe(DEFAULT_ANNOTATION_PREFS.ink);
  });

  test('a late shell read never undoes a click, and seeds what was not touched', () => {
    const s = createToolState();
    s.set({ ink: STROKE_PALETTE[4] });
    expect(
      s.hydrate({ ink: STROKE_PALETTE[0], stickyColor: STICKY_PALETTE[8], thickness: 6 })
    ).toBe(true);
    expect(s.get()).toMatchObject({
      ink: STROKE_PALETTE[4],
      stickyColor: STICKY_PALETTE[8],
      thickness: 6,
    });
    // a hydrate is not a change: it is not sent back up
    const writes: unknown[] = [];
    const t = createToolState({ persist: (p) => writes.push(p) });
    t.hydrate({ tip: 'highlighter' });
    expect(writes).toEqual([]);
  });

  test('subscribers hear a change once; the remembered tip is the one M arms (Q4)', async () => {
    // the document's store wires rememberMarkerTip; here the same contract through the real singleton
    const { toolState } = await import('../annotations/ui/tool-state.ts');
    const store = toolState();
    rememberMarkerTip('pen');
    let n = 0;
    const off = store.subscribe(() => n++);
    store.set({ tip: 'highlighter' });
    expect(n).toBe(1);
    expect(lastMarkerTip()).toBe('highlighter');
    store.set({ tip: 'pen' });
    off();
    expect(lastMarkerTip()).toBe('pen');
  });
});

describe('the shell store — across reloads', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    } as unknown as Storage;
  };

  test('a cloud tab (no prefs file): the choice is mirrored to localStorage and restored by the next page', () => {
    const storage = memory();
    const a = createAnnotationPrefsStore({ persist: () => {}, storage });
    a.set({ stickyColor: STICKY_PALETTE[7], ink: STROKE_PALETTE[4], tip: 'highlighter' });
    const b = createAnnotationPrefsStore({ persist: () => {}, storage });
    expect(b.get()).toEqual({
      stickyColor: STICKY_PALETTE[7],
      ink: STROKE_PALETTE[4],
      tip: 'highlighter',
    });
  });

  test('a Mac: only the change goes to prefs.json, and prefs.json restores it (hydrate)', () => {
    const writes: unknown[] = [];
    const a = createAnnotationPrefsStore({ persist: (p) => writes.push(p), storage: memory() });
    a.set({ stickyColor: STICKY_PALETTE[3], thickness: 6 });
    a.set({ thickness: 6 }); // unchanged: not written again
    expect(writes).toEqual([{ annotationPrefs: { stickyColor: STICKY_PALETTE[3], thickness: 6 } }]);
    const b = createAnnotationPrefsStore({ persist: () => {}, storage: memory() });
    b.hydrate({
      annotationPrefs: { stickyColor: STICKY_PALETTE[3], thickness: 6, ink: '#000000' },
    });
    expect(b.get()).toEqual({ stickyColor: STICKY_PALETTE[3], thickness: 6 });
  });

  test('a late disk read does not undo a click made in this page', () => {
    const a = createAnnotationPrefsStore({ persist: () => {}, storage: memory() });
    a.set({ ink: STROKE_PALETTE[0] });
    a.hydrate({ annotationPrefs: { ink: STROKE_PALETTE[4], tip: 'eraser' } });
    expect(a.get()).toEqual({ ink: STROKE_PALETTE[0], tip: 'eraser' });
  });

  test('a blocked localStorage and a failing prefs route never throw', () => {
    const boom = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    const a = createAnnotationPrefsStore({
      persist: () => {
        throw new Error('no route');
      },
      storage: boom,
    });
    expect(() => a.set({ thickness: 6 })).not.toThrow();
    expect(a.get()).toEqual({ thickness: 6 });
  });
});

describe('the bridge rows', () => {
  const rows = DGN_TABLE as unknown as {
    c2s: Record<string, { gate: string; parse: (r: object) => unknown }>;
    s2c: Record<string, { gate: string; parse: (r: object) => unknown }>;
  };

  test('`annotation-prefs-set` is active-gated; `annotation-prefs` is parent-gated; junk is refused', () => {
    expect(rows.c2s['annotation-prefs-set'].gate).toBe('active');
    expect(rows.s2c['annotation-prefs'].gate).toBe('parent');
    for (const spec of [rows.c2s['annotation-prefs-set'], rows.s2c['annotation-prefs']]) {
      expect(spec.parse({ prefs: { ink: STROKE_PALETTE[4], tip: 'pen', extra: 1 } })).toEqual({
        prefs: { ink: STROKE_PALETTE[4], tip: 'pen' },
      });
      expect(spec.parse({ prefs: { ink: 'javascript:alert(1)' } })).toBe(null);
      expect(spec.parse({ prefs: { tip: 'brush' } })).toBe(null);
      expect(spec.parse({ prefs: { thickness: 5 } })).toBe(null);
      expect(spec.parse({ prefs: 'yellow' })).toBe(null);
      expect(spec.parse({})).toBe(null);
    }
  });
});

describe('the shell lane', () => {
  const ORIGIN = 'http://localhost:9999';
  type Frame = {
    src: string;
    contentWindow: { postMessage: (m: unknown) => void };
    sent: unknown[];
  };
  const frame = (): Frame => {
    const sent: unknown[] = [];
    return {
      src: `${ORIGIN}/_canvas-shell?x`,
      contentWindow: { postMessage: (m) => void sent.push(m) },
      sent,
    };
  };
  const Lane = (p: {
    refs: { current: Map<string, Frame> };
    active: string | null;
    store: unknown;
  }) => {
    useAnnotationPrefsLane(p.refs, p.active, p.store);
    return null;
  };
  const say = (data: unknown, source: unknown, origin = ORIGIN) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data, source: source as MessageEventSource, origin })
      );
    });

  test('only the active canvas on its own origin writes; every frame hears it; a fresh frame is seeded', async () => {
    const a = frame();
    const b = frame();
    const refs = {
      current: new Map([
        ['a.tsx', a],
        ['b.tsx', b],
      ]),
    };
    const persisted: unknown[] = [];
    const store = createAnnotationPrefsStore({ persist: (p) => persisted.push(p), storage: null });
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(Lane, { refs, active: 'a.tsx', store }));
    });
    const set = { dgn: 'annotation-prefs-set', prefs: { stickyColor: STICKY_PALETTE[7] } };
    // a background canvas, a foreign origin, a stranger window: nothing is written
    say(set, b.contentWindow);
    say(set, a.contentWindow, 'http://evil.example');
    say(set, {});
    expect(store.get()).toEqual({});
    // the active canvas: written to prefs.json, told to every frame
    say(set, a.contentWindow);
    expect(store.get()).toEqual({ stickyColor: STICKY_PALETTE[7] });
    expect(persisted).toEqual([{ annotationPrefs: { stickyColor: STICKY_PALETTE[7] } }]);
    expect(a.sent).toEqual([
      { dgn: 'annotation-prefs', prefs: { stickyColor: STICKY_PALETTE[7] } },
    ]);
    expect(b.sent).toEqual(a.sent);
    // a palette-less value never gets in even from the active canvas
    say({ dgn: 'annotation-prefs-set', prefs: { ink: 'javascript:1' } }, a.contentWindow);
    expect(store.get()).toEqual({ stickyColor: STICKY_PALETTE[7] });
    // a canvas that has just loaded is seeded
    const before = b.sent.length;
    say({ dgn: 'loaded' }, b.contentWindow);
    expect(b.sent.length).toBe(before + 1);
    await act(async () => root.unmount());
  });
});
