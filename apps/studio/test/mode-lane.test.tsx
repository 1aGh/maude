// V2-4.3b — the mode lane, both ends (V2-1.2 §5.4–5.7):
//  · shell: the switch's `set-mode` reaches the active canvas AFTER the target insets (§5.6), every
//    frame is told, the tool only rides to the active one; M4 (active canvas, no modal, the role);
//  · canvas: a parent-gated `set-mode` governs the document's ToolProviders — exactly ONE
//    `mode-changed` per applied seq however many providers mount (M2), a seed of the current mode
//    keeps the armed tool, a cross-mode gesture is a `mode-request` with no local change (M1, M3),
//    the clamp for a read-only canvas;
//  · `peers`: active canvas only, strict and capped (a planted or oversized list is dropped whole).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { canvasModeStore } from '../bridge/canvas-mode-store.ts';
import { acceptFromCanvas, DGN_TABLE, PEER_NAME_MAX, PEERS_MAX } from '../bridge/dgn-protocol.ts';
import {
  capsFor,
  createModeLane,
  createShellMode,
  decideModeRequest,
} from '../client/v2/shell/canvas-mode.js';
import { createPanelLayout } from '../client/v2/shell/panel-layout.js';
import { peersPayload } from '../participants-chrome.tsx';
import { _resetReadOnlyCache } from '../read-only-mode.ts';
import { ToolProvider, useToolMode } from '../use-tool-mode.tsx';

const EDITOR = capsFor({ canEdit: true });
const COMMENTER = capsFor({ canEdit: false, role: 'viewer' });

// ── shell end ────────────────────────────────────────────────────────────────

describe('shell: set-mode after the target insets (§5.6)', () => {
  const frame = (log: Array<Record<string, unknown>>) => ({
    postMessage: (m: Record<string, unknown>) => log.push(m),
  });

  test('a transition flushes the insets first, then tells every frame; the tool rides to the active one', () => {
    const activeLog: Array<Record<string, unknown>> = [];
    const otherLog: Array<Record<string, unknown>> = [];
    const active = frame(activeLog);
    const other = frame(otherLog);
    const lane = createModeLane({
      frames: () => [active, other] as unknown as Window[],
      active: () => active as unknown as Window,
      // the live pump posts `occluded-insets` to every frame from here
      flushInsets: () => {
        for (const f of [active, other])
          f.postMessage({
            dgn: 'occluded-insets',
            seq: 9,
            insets: { top: 0, right: 0, bottom: 0, left: 56 },
          });
      },
    });
    lane.broadcast({ mode: 'preview', caps: EDITOR, tool: 'browse' });
    expect(activeLog.map((m) => m.dgn)).toEqual(['occluded-insets', 'set-mode']);
    expect(otherLog.map((m) => m.dgn)).toEqual(['occluded-insets', 'set-mode']);
    expect(activeLog[1]).toMatchObject({ v: 2, mode: 'preview', tool: 'browse', present: null });
    expect('tool' in otherLog[1]).toBe(false);
    // every message is new: seqs strictly increase across frames
    expect(Number(otherLog[1].seq)).toBeGreaterThan(Number(activeLog[1].seq));
    // M5 — ≤ 300 bytes
    expect(JSON.stringify(activeLog[1]).length).toBeLessThanOrEqual(300);
    // and it parses through the table the canvas reads it with
    expect(DGN_TABLE.s2c['set-mode'].parse(activeLog[1])).not.toBeNull();
  });

  test('Present is sent as Present · Canvas; a seed carries no tool', () => {
    const log: Array<Record<string, unknown>> = [];
    const f = frame(log);
    const lane = createModeLane({ frames: () => [f] as unknown as Window[], active: () => null });
    lane.broadcast({ mode: 'present', caps: EDITOR });
    lane.seed(f as unknown as Window, { mode: 'edit', caps: EDITOR });
    expect(log[0]).toMatchObject({ mode: 'present', present: { kind: 'canvas' } });
    expect(log[1]).toMatchObject({ mode: 'edit', present: null });
    expect('tool' in log[1]).toBe(false);
  });

  test('the store: boot posture by role, re-choosing a mode re-sends, a demotion clamps', () => {
    const s = createShellMode();
    expect(s.get().mode).toBe('edit');
    s.clamp(COMMENTER); // the role arrived after boot, nobody chose yet → a view-only link opens in Preview
    expect(s.get().mode).toBe('preview');
    const n = s.get().nonce;
    s.select('preview');
    expect(s.get().nonce).toBe(n + 1);
    s.select('edit');
    s.clamp(COMMENTER);
    expect(s.get().mode).toBe('viewing');
  });

  test('Preview folds the panels without touching ⌘\\; leaving unfolds back to the person’s choice', () => {
    const layout = createPanelLayout();
    layout.setFolded(true);
    expect(layout.get()).toMatchObject({ hidden: true, folded: true, userHidden: false });
    layout.setFolded(false);
    expect(layout.get().hidden).toBe(false);
    layout.hide();
    layout.setFolded(true);
    layout.setFolded(false);
    expect(layout.get()).toMatchObject({ hidden: true, userHidden: true });
  });
});

describe('shell: M4 — mode-request only from the active canvas, no modal, the role allows it', () => {
  const origin = 'http://canvas.test';
  const activeWin = { name: 'active' } as unknown as Window;
  const sibling = { name: 'sibling' } as unknown as Window;
  const ev = (source: Window, data: unknown) =>
    new MessageEvent('message', { origin, source, data }) as MessageEvent;
  const ctx = { canvasOrigin: origin, active: activeWin };

  test('a request from a background canvas never reaches the router', () => {
    const req = { dgn: 'mode-request', mode: 'present', cause: 'toolbar' };
    expect(acceptFromCanvas(ev(sibling, req), ctx)).toBeNull();
    expect(acceptFromCanvas(ev(activeWin, req), ctx)).toMatchObject({ mode: 'present' });
  });

  test('with a modal open it is refused; Edit is refused for a role without edit rights', () => {
    const base = { caps: EDITOR, presenting: false, mode: 'edit', modalOpen: false };
    expect(decideModeRequest({ mode: 'present' }, { ...base, modalOpen: true })).toEqual({
      kind: 'deny',
      reason: 'modal',
    });
    expect(decideModeRequest({ mode: 'edit', tool: 'move' }, { ...base, caps: COMMENTER })).toEqual(
      {
        kind: 'deny',
        reason: 'role',
      }
    );
    expect(decideModeRequest({ mode: 'edit', tool: 'move' }, { ...base, mode: 'preview' })).toEqual(
      {
        kind: 'set',
        mode: 'edit',
        tool: 'move',
      }
    );
    // back: Present → out; Preview → the base mode (Viewing for a viewing role)
    expect(decideModeRequest({ mode: 'back' }, { ...base, presenting: true })).toEqual({
      kind: 'exit-present',
    });
    expect(
      decideModeRequest({ mode: 'back' }, { ...base, mode: 'preview', caps: COMMENTER })
    ).toEqual({ kind: 'set', mode: 'viewing' });
  });
});

describe('shell: peers (active canvas only, strict)', () => {
  const origin = 'http://canvas.test';
  const activeWin = { name: 'active' } as unknown as Window;
  const ctx = { canvasOrigin: origin, active: activeWin };
  const ev = (source: unknown, data: unknown) =>
    new MessageEvent('message', { origin, source: source as Window, data }) as MessageEvent;
  const ok = { dgn: 'peers', peers: [{ clientID: 7, name: 'Tereza' }] };

  test('Follow state rides on peers (V2-4.3b lead): following is a strict boolean, the payload marks the target', () => {
    const f = { dgn: 'peers', peers: [{ clientID: 7, name: 'Tereza', following: true }] };
    expect(acceptFromCanvas(ev(activeWin, f), ctx)).toEqual(f);
    const junk = { dgn: 'peers', peers: [{ clientID: 7, name: 'Tereza', following: 'yes' }] };
    expect(acceptFromCanvas(ev(activeWin, junk), ctx)).toBeNull();
    const list = [
      { clientID: 7, name: 'Tereza' },
      { clientID: 9, name: 'Jonas' },
    ];
    expect(peersPayload(list, 9)).toEqual([
      { clientID: 7, name: 'Tereza' },
      { clientID: 9, name: 'Jonas', following: true },
    ]);
    expect(peersPayload(list)).toEqual(list);
  });

  test('a planted list from another frame is dropped', () => {
    expect(acceptFromCanvas(ev({ name: 'sibling' }, ok), ctx)).toBeNull();
    expect(acceptFromCanvas(ev(activeWin, ok), ctx)).toEqual(ok);
  });

  test('an oversized list, an overlong name or a junk peer is rejected whole', () => {
    const many = Array.from({ length: PEERS_MAX + 1 }, (_, i) => ({ clientID: i, name: `p${i}` }));
    expect(acceptFromCanvas(ev(activeWin, { dgn: 'peers', peers: many }), ctx)).toBeNull();
    const long = { clientID: 1, name: 'x'.repeat(PEER_NAME_MAX + 1) };
    expect(acceptFromCanvas(ev(activeWin, { dgn: 'peers', peers: [long] }), ctx)).toBeNull();
    for (const bad of [
      { clientID: -1, name: 'a' },
      { clientID: 1.5, name: 'a' },
      { clientID: 1, name: '<b>a</b>', color: 'url(javascript:1)' },
      { clientID: 1 },
    ])
      expect(acceptFromCanvas(ev(activeWin, { dgn: 'peers', peers: [bad] }), ctx)).toBeNull();
    // unknown keys are stripped (an html field never crosses)
    const m = acceptFromCanvas(
      ev(activeWin, { dgn: 'peers', peers: [{ clientID: 1, name: 'A', html: '<img>' }] }),
      ctx
    );
    expect(m).toEqual({ dgn: 'peers', peers: [{ clientID: 1, name: 'A' }] });
  });

  test('the canvas applies the same caps before it posts, so an honest canvas never trips them', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ clientID: i, name: 'n'.repeat(80) }));
    const out = peersPayload(many as never);
    expect(out.length).toBe(PEERS_MAX);
    expect(out[0].name.length).toBe(PEER_NAME_MAX);
    expect(DGN_TABLE.c2s.peers.parse({ peers: out })).not.toBeNull();
  });
});

// ── canvas end ───────────────────────────────────────────────────────────────

const shellPosts: Array<Record<string, unknown>> = [];
const fakeParent = {
  postMessage: (m: Record<string, unknown>) => shellPosts.push(m),
};
let realParent: PropertyDescriptor | undefined;

function asIframe() {
  realParent = Object.getOwnPropertyDescriptor(window, 'parent');
  Object.defineProperty(window, 'parent', { configurable: true, get: () => fakeParent });
}
function restoreParent() {
  if (realParent) Object.defineProperty(window, 'parent', realParent);
  else delete (window as unknown as { parent?: unknown }).parent;
}

let ctxA: ReturnType<typeof useToolMode> | null = null;
let ctxB: ReturnType<typeof useToolMode> | null = null;
const CapA = () => {
  ctxA = useToolMode();
  return null;
};
const CapB = () => {
  ctxB = useToolMode();
  return null;
};
let roots: Root[] = [];
function mount(ui: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const r = createRoot(host);
  roots.push(r);
  act(() => r.render(ui));
}
afterEach(() => {
  act(() => {
    for (const r of roots) r.unmount();
  });
  roots = [];
  ctxA = ctxB = null;
  shellPosts.length = 0;
});

const setMode = (seq: number, mode: string, extra: Record<string, unknown> = {}) =>
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        source: fakeParent as unknown as Window,
        data: { dgn: 'set-mode', v: 2, seq, mode, present: null, caps: EDITOR, ...extra },
      })
    );
  });
const echoes = () => shellPosts.filter((m) => m.dgn === 'mode-changed');

describe('canvas: governed by set-mode (M1–M3)', () => {
  beforeAll(asIframe);
  afterAll(restoreParent);

  test('two providers (comment-mount + canvas-lib) adopt one set-mode; exactly one echo, same seq (M2)', () => {
    // Two separate React trees = the two bundles' separate contexts in one document.
    mount(
      <ToolProvider initial="browse">
        <CapA />
      </ToolProvider>
    );
    mount(
      <ToolProvider governed>
        <CapB />
      </ToolProvider>
    );
    const base = canvasModeStore(window).get().modeSeq + 1;
    setMode(base, 'preview');
    expect([ctxA?.mode, ctxA?.tool, ctxB?.mode, ctxB?.tool]).toEqual([
      'preview',
      'browse',
      'preview',
      'browse',
    ]);
    expect(echoes()).toEqual([
      {
        dgn: 'mode-changed',
        seq: base,
        mode: 'preview',
        tool: 'browse',
        present: null,
        cause: 'set-mode',
      },
    ]);
    // a sibling frame's set-mode is not the parent's: ignored
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: { name: 'sibling' } as unknown as Window,
          data: {
            dgn: 'set-mode',
            v: 2,
            seq: base + 50,
            mode: 'edit',
            present: null,
            caps: EDITOR,
          },
        })
      );
    });
    expect(ctxB?.mode).toBe('preview');
    // an older seq is dropped
    setMode(base - 1, 'edit');
    expect(ctxB?.mode).toBe('preview');
    expect(echoes().length).toBe(1);
  });

  test('a seed of the current mode keeps the armed tool; a mode change arms its resting tool', () => {
    mount(
      <ToolProvider governed>
        <CapB />
      </ToolProvider>
    );
    const base = canvasModeStore(window).get().modeSeq + 1;
    setMode(base, 'preview');
    act(() => ctxB?.setTool('pen'));
    setMode(base + 1, 'preview'); // a ladder seed / a newly active canvas
    expect([ctxB?.mode, ctxB?.tool]).toEqual(['preview', 'pen']);
    setMode(base + 2, 'preview', { tool: 'browse' }); // the active segment re-chosen
    expect(ctxB?.tool).toBe('browse');
    setMode(base + 3, 'edit');
    expect([ctxB?.mode, ctxB?.tool]).toEqual(['edit', 'move']);
    expect(echoes().map((m) => m.seq)).toEqual([base, base + 1, base + 2, base + 3]);
  });

  test('a cross-mode gesture is a mode-request, never a local change (M3)', () => {
    mount(
      <ToolProvider governed>
        <CapB />
      </ToolProvider>
    );
    const base = canvasModeStore(window).get().modeSeq + 1;
    setMode(base, 'preview');
    shellPosts.length = 0;
    act(() => ctxB?.setTool('move')); // V, the tool-set lane, ⌘-click in browse
    expect([ctxB?.mode, ctxB?.tool]).toEqual(['preview', 'browse']);
    expect(shellPosts).toEqual([
      { dgn: 'mode-request', mode: 'edit', tool: 'move', cause: 'toolbar' },
    ]);
    shellPosts.length = 0;
    act(() => ctxB?.setMode('edit'));
    expect(ctxB?.mode).toBe('preview');
    expect(shellPosts).toEqual([{ dgn: 'mode-request', mode: 'edit', cause: 'toolbar' }]);
    // a same-mode tool stays local
    shellPosts.length = 0;
    act(() => ctxB?.setTool('pen'));
    expect(ctxB?.tool).toBe('pen');
    expect(shellPosts.filter((m) => m.dgn === 'mode-request')).toEqual([]);
    for (const m of shellPosts.filter((x) => x.dgn === 'mode-request'))
      expect(DGN_TABLE.c2s['mode-request'].parse(m)).not.toBeNull();
  });

  // Found by the v1-keys read (V2-4.3b): the three cases below were real defects of the first cut.
  test('both providers see one keydown: the document asks the shell ONCE', () => {
    mount(
      <ToolProvider initial="browse">
        <CapA />
      </ToolProvider>
    );
    mount(
      <ToolProvider governed>
        <CapB />
      </ToolProvider>
    );
    setMode(canvasModeStore(window).get().modeSeq + 1, 'preview');
    shellPosts.length = 0;
    act(() => {
      ctxA?.setTool('move');
      ctxB?.setTool('move');
    });
    expect(shellPosts.filter((m) => m.dgn === 'mode-request')).toEqual([
      { dgn: 'mode-request', mode: 'edit', tool: 'move', cause: 'toolbar' },
    ]);
  });

  test('Present keeps its posture: an Esc ladder’s resting-tool arm neither leaves nor asks', () => {
    mount(
      <ToolProvider governed>
        <CapB />
      </ToolProvider>
    );
    setMode(canvasModeStore(window).get().modeSeq + 1, 'present');
    shellPosts.length = 0;
    act(() => ctxB?.resetTool());
    act(() => ctxB?.setTool('move'));
    expect([ctxB?.mode, ctxB?.tool]).toEqual(['preview', 'browse']);
    expect(shellPosts.filter((m) => m.dgn === 'mode-request')).toEqual([]);
  });

  test('the governed provider mounting after the seeds adopts the mode (its own state, not prevMode)', () => {
    const base = canvasModeStore(window).get().modeSeq + 1;
    setMode(base, 'preview');
    setMode(base + 1, 'preview'); // ladder seeds landed before canvas-lib's DesignCanvas mounted
    mount(
      <ToolProvider governed>
        <CapB />
      </ToolProvider>
    );
    expect([ctxB?.mode, ctxB?.tool]).toEqual(['preview', 'browse']);
  });

  test('the comment-mount ancestor is NOT governed: a bare DS specimen stays alive in Edit', () => {
    setMode(canvasModeStore(window).get().modeSeq + 1, 'edit');
    mount(
      <ToolProvider initial="browse">
        <CapA />
      </ToolProvider>
    );
    setMode(canvasModeStore(window).get().modeSeq + 1, 'edit');
    expect([ctxA?.mode, ctxA?.tool]).toEqual(['preview', 'browse']);
    expect(echoes().length).toBe(0); // no DesignCanvas, nobody echoes — the shell needs none
  });

  test('a read-only canvas clamps Edit to Viewing and says so (cause clamp)', () => {
    (window as unknown as { happyDOM?: { setURL?: (u: string) => void } }).happyDOM?.setURL?.(
      'http://localhost/?ro=1'
    );
    _resetReadOnlyCache();
    try {
      mount(
        <ToolProvider governed>
          <CapB />
        </ToolProvider>
      );
      const base = canvasModeStore(window).get().modeSeq + 1;
      setMode(base, 'edit');
      expect(echoes().at(-1)).toMatchObject({ seq: base, mode: 'viewing', cause: 'clamp' });
      expect([ctxB?.mode, ctxB?.tool]).toEqual(['edit', 'move']); // v1's read-only select & inspect
    } finally {
      (window as unknown as { happyDOM?: { setURL?: (u: string) => void } }).happyDOM?.setURL?.(
        'http://localhost/'
      );
      _resetReadOnlyCache();
    }
  });
});
