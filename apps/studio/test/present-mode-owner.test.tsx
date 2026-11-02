// S3.1 (decision v2-S3-single-present-owner, D1) — Present lives in the ONE mode owner. The shell's
// `presentMode` (DDR-117's chrome hiding) is derived from the shell mode store (`mode === 'present'`
// + its `PresentSpec`), never a second piece of state, so the two can never disagree; every way into
// Present (the switch, Present ⌄, ⌥⌘↵ / ⇧⌥⌘↵, View › Present the canvas, a canvas `mode-request`)
// goes through it, and esc returns to `returnTo`.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  // `document`, not `window`: a `window` stub another file left must not skip the DOM.
  if (typeof document === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import {
  capsFor,
  createShellMode,
  decideModeRequest,
  presentSpecFor,
  setModeMessage,
} from '../client/v2/shell/canvas-mode.js';
import {
  presentFrom,
  setPresentSource,
  shellMode,
  togglePresentCanvas,
  useCanvasModeLane,
  usePresentMode,
} from '../client/v2/shell/use-canvas-mode-lane.js';

const EDITOR = capsFor({ canEdit: true });
const COMMENTER = capsFor({ canEdit: false, role: 'viewer' });
const STUDIO = join(import.meta.dir, '..');

describe('the store: Present with a spec and a returnTo', () => {
  test('present(spec) remembers where it came from; back() returns there', () => {
    const s = createShellMode();
    s.select('preview');
    expect(s.present({ kind: 'artboards', from: 'post-1x1' })).toBe(true);
    expect(s.get()).toMatchObject({
      mode: 'present',
      present: { kind: 'artboards', from: 'post-1x1' },
      returnTo: 'preview',
    });
    // already presenting: nothing (Present's menu is gone; esc leaves first)
    expect(s.present({ kind: 'canvas' })).toBe(false);
    expect(s.back()).toBe(true);
    expect(s.get()).toMatchObject({ mode: 'preview', present: null, returnTo: null });
    expect(s.back()).toBe(false);
  });

  test('choosing a mode while presenting leaves Present for it', () => {
    const s = createShellMode();
    s.present({ kind: 'canvas' });
    s.select('edit', { tool: 'move' });
    expect(s.get()).toMatchObject({ mode: 'edit', tool: 'move', present: null, returnTo: null });
    s.select('present'); // Present only through present(spec)
    expect(s.get().mode).toBe('edit');
  });

  test('a role change while presenting keeps Present and clamps where it returns to', () => {
    const s = createShellMode();
    s.select('edit');
    s.present({ kind: 'artboards', from: 'start' });
    s.clamp(COMMENTER);
    expect(s.get()).toMatchObject({ mode: 'present', returnTo: 'viewing' });
    s.back();
    expect(s.get().mode).toBe('viewing');
  });

  test('position is kept only while presenting artboards, and only when it changes', () => {
    const s = createShellMode();
    let n = 0;
    s.subscribe(() => {
      n += 1;
    });
    s.position({ index: 1, total: 3, artboardId: 'a' });
    expect(s.get().position).toBeNull();
    s.present({ kind: 'artboards', from: 'a' });
    const before = n;
    s.position({ index: 1, total: 3, artboardId: 'a' });
    s.position({ index: 1, total: 3, artboardId: 'a' });
    expect(n).toBe(before + 1);
    expect(s.get().position).toEqual({ index: 1, total: 3, artboardId: 'a' });
    s.back();
    expect(s.get().position).toBeNull();
  });

  test('where Present starts: the selected artboard, else the one in view, else the start', () => {
    expect(presentSpecFor('selection', { selectedArtboard: 'b', inViewArtboard: 'c' })).toEqual({
      kind: 'artboards',
      from: 'b',
    });
    expect(presentSpecFor('selection', { inViewArtboard: 'c' })).toEqual({
      kind: 'artboards',
      from: 'c',
    });
    expect(presentSpecFor('selection')).toEqual({ kind: 'artboards', from: 'start' });
    expect(presentSpecFor('start', { selectedArtboard: 'b' })).toEqual({
      kind: 'artboards',
      from: 'start',
    });
    expect(presentSpecFor('canvas', { selectedArtboard: 'b' })).toEqual({ kind: 'canvas' });
  });

  test('set-mode carries the spec (PresentSpec.kind honoured) and still parses, ≤ 300 bytes', () => {
    const msg = setModeMessage({
      seq: 4,
      mode: 'present',
      caps: EDITOR,
      present: { kind: 'artboards', from: 'post-1x1' },
    });
    expect(msg.present).toEqual({ kind: 'artboards', from: 'post-1x1' });
    expect(JSON.stringify(msg).length).toBeLessThanOrEqual(300);
    expect(DGN_TABLE.s2c['set-mode'].parse(msg)).toMatchObject({
      present: { kind: 'artboards', from: 'post-1x1' },
    });
    expect(
      setModeMessage({ seq: 5, mode: 'edit', caps: EDITOR, present: { kind: 'canvas' } }).present
    ).toBeNull();
  });

  test('a canvas asking for Present passes its spec through the one door', () => {
    const base = { caps: EDITOR, presenting: false, mode: 'edit', modalOpen: false };
    expect(
      decideModeRequest({ mode: 'present', present: { kind: 'artboards', from: 'x' } }, base)
    ).toEqual({ kind: 'present', present: { kind: 'artboards', from: 'x' } });
    expect(decideModeRequest({ mode: 'present' }, base)).toEqual({
      kind: 'present',
      present: { kind: 'canvas' },
    });
    expect(decideModeRequest({ mode: 'present' }, { ...base, presenting: true })).toBeNull();
  });
});

// ── the wired lane: presentMode is derived, so it never disagrees with the store ──────────────

const ORIGIN = 'http://canvas.test';
let root: Root | null = null;
let host: HTMLDivElement | null = null;
const seen: Array<{ presentMode: boolean; laneMode: string; storeMode: string }> = [];
let laneApi: ReturnType<typeof useCanvasModeLane> | null = null;
const frameLog: Array<Record<string, unknown>> = [];
const frameWin = { postMessage: (m: Record<string, unknown>) => frameLog.push(m) };

function Harness() {
  const [presentMode] = usePresentMode();
  const iframesRef = { current: new Map([['ui/Campaign.tsx', { contentWindow: frameWin }]]) };
  const lane = useCanvasModeLane({
    activePath: 'ui/Campaign.tsx',
    iframesRef,
    cfg: { canvasOrigin: ORIGIN },
    canEdit: true,
    role: undefined,
  });
  laneApi = lane;
  seen.push({ presentMode, laneMode: lane.mode, storeMode: shellMode.get().mode });
  return null;
}

function fromCanvas(data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { origin: ORIGIN, source: frameWin as unknown as Window, data })
    );
  });
}

describe('the wired lane (D1)', () => {
  beforeEach(() => {
    act(() => {
      shellMode.back();
      shellMode.select('edit');
    });
    setPresentSource(null);
    seen.length = 0;
    frameLog.length = 0;
    if (!host) {
      host = document.createElement('div');
      document.body.appendChild(host);
      root = createRoot(host);
      act(() => root?.render(<Harness />));
    }
  });
  afterAll(() => {
    act(() => root?.unmount());
  });

  const agree = () => {
    for (const s of seen) {
      expect(s.presentMode).toBe(s.storeMode === 'present');
      expect(s.presentMode).toBe(s.laneMode === 'present');
    }
  };
  const lastSetMode = () => [...frameLog].reverse().find((m) => m.dgn === 'set-mode');

  test('⌥⌘↵ path: presentFrom(selection) enters Present · Artboards from the selected artboard', () => {
    setPresentSource({ selectedArtboard: 'post-1x1', inViewArtboard: 'story' });
    act(() => {
      presentFrom('selection');
    });
    expect(shellMode.get()).toMatchObject({
      mode: 'present',
      present: { kind: 'artboards', from: 'post-1x1' },
      returnTo: 'edit',
    });
    expect(lastSetMode()).toMatchObject({
      mode: 'present',
      present: { kind: 'artboards', from: 'post-1x1' },
    });
    expect(seen.at(-1)?.presentMode).toBe(true);
    agree();
  });

  test('esc in the canvas (`mode-request back`) returns to returnTo; presentMode follows', () => {
    act(() => {
      shellMode.select('preview');
    });
    act(() => {
      presentFrom('start');
    });
    fromCanvas({ dgn: 'mode-request', mode: 'back', cause: 'esc' });
    expect(shellMode.get().mode).toBe('preview');
    expect(seen.at(-1)?.presentMode).toBe(false);
    agree();
  });

  test('a canvas `mode-request` for Present and View › Present the canvas land in the same store', () => {
    fromCanvas({
      dgn: 'mode-request',
      mode: 'present',
      present: { kind: 'artboards', from: 'banner' },
      cause: 'key',
    });
    expect(shellMode.get().present).toEqual({ kind: 'artboards', from: 'banner' });
    expect(seen.at(-1)?.presentMode).toBe(true);
    act(() => togglePresentCanvas()); // presenting → the toggle leaves
    expect(shellMode.get().mode).toBe('edit');
    act(() => togglePresentCanvas());
    expect(shellMode.get().present).toEqual({ kind: 'canvas' });
    agree();
  });

  test('present-position from the active canvas is the store’s position; step() asks the canvas', () => {
    act(() => {
      presentFrom('start');
    });
    fromCanvas({ dgn: 'present-position', index: 2, total: 14, artboardId: 'story' });
    expect(shellMode.get().position).toEqual({ index: 2, total: 14, artboardId: 'story' });
    laneApi?.step('next');
    expect(frameLog.at(-1)).toEqual({ dgn: 'present-step', to: 'next' });
    expect(DGN_TABLE.s2c['present-step'].parse(frameLog.at(-1) ?? {})).toEqual({ to: 'next' });
  });

  test('the switch: a click on Present starts from the selection (04 md-present-menu)', () => {
    setPresentSource({ selectedArtboard: null, inViewArtboard: 'story' });
    act(() => laneApi?.select('present'));
    expect(shellMode.get().present).toEqual({ kind: 'artboards', from: 'story' });
    agree();
  });
});

describe('no second Present source (fails against the DDR-117 boolean)', () => {
  test('the shell core derives presentMode from the mode store; nobody holds it as state', () => {
    const core = readFileSync(join(STUDIO, 'client/hooks/use-shell-core.jsx'), 'utf8');
    expect(core).not.toMatch(/\[presentMode,\s*setPresentMode\]\s*=\s*useState/);
    expect(core).toMatch(/\[presentMode,\s*setPresentMode\]\s*=\s*usePresentMode\(\)/);
    const photo = readFileSync(join(STUDIO, 'client/hooks/use-photo-and-timeline.jsx'), 'utf8');
    expect(photo).not.toMatch(/setPresentMode\(\(v\)/);
    // the lane takes no `presenting` from outside: it reads the store
    const host = readFileSync(join(STUDIO, 'client/v2/shell/share-cluster-host.jsx'), 'utf8');
    expect(host).not.toMatch(/presenting:\s*!!presentMode/);
  });
});
