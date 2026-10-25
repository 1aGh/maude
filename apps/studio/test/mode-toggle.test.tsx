// mode-toggle — DDR-223 (issue #93). The preview/edit mode layer over the
// DDR-187 browse/move tool split: boot posture, the mode⇄tool invariant
// (arming a resting tool moves the mode; annotation tools are mode-neutral),
// resetTool, read-only preview boot — and, since V2-4.3b, the switch that
// lives in the Share cluster instead of the palette.
//
// Needs a live DOM (context callbacks fired via act) — register happy-dom +
// drive a createRoot, same convention as browse-posture.test.tsx.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  // `document`, not `window`: a `window` stub another file left must not skip the DOM.
  if (typeof document === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ALL_CAPS } from '../bridge/canvas-modes.ts';
import { ModeSwitch } from '../client/v2/shell/mode-switch.jsx';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';
import { ShareCluster } from '../client/v2/shell/share-cluster.jsx';
import type { Tool } from '../input-router.tsx';
import { _resetReadOnlyCache } from '../read-only-mode.ts';
import { ToolPalette } from '../tool-palette.tsx';
import { type CanvasMode, ToolProvider, useToolMode } from '../use-tool-mode.tsx';

// Capture the live context value so tests can drive setMode/setTool/resetTool
// directly and assert the resulting (tool, mode) pair.
let ctx: ReturnType<typeof useToolMode> | null = null;
function Capture() {
  ctx = useToolMode();
  return null;
}

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(ui: ReactNode): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(ui);
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
  ctx = null;
  _resetReadOnlyCache();
  setPageUrl('http://localhost/');
});

// happy-dom: `history.replaceState` does not update `location.search`; the
// DetachedWindowAPI `setURL` is the supported seam.
function setPageUrl(url: string): void {
  (window as unknown as { happyDOM?: { setURL?: (u: string) => void } }).happyDOM?.setURL?.(url);
}

const pair = (): { tool: Tool; mode: CanvasMode } => ({
  tool: ctx?.tool as Tool,
  mode: ctx?.mode as CanvasMode,
});

describe('mode-toggle / boot posture (DDR-223)', () => {
  test('default boot = edit with move armed', () => {
    mount(
      <ToolProvider>
        <Capture />
      </ToolProvider>
    );
    expect(pair()).toEqual({ tool: 'move', mode: 'edit' });
  });

  test('initial="browse" boots preview (comment-mount specimen posture)', () => {
    mount(
      <ToolProvider initial="browse">
        <Capture />
      </ToolProvider>
    );
    expect(pair()).toEqual({ tool: 'browse', mode: 'preview' });
  });

  test('read-only (?ro=1) boots preview/browse — the DDR-187 viewer posture', () => {
    setPageUrl('http://localhost/?ro=1');
    _resetReadOnlyCache();
    mount(
      <ToolProvider>
        <Capture />
      </ToolProvider>
    );
    expect(pair()).toEqual({ tool: 'browse', mode: 'preview' });
  });
});

describe('mode-toggle / mode⇄tool invariant', () => {
  test('setMode arms the resting tool both ways', () => {
    mount(
      <ToolProvider>
        <Capture />
      </ToolProvider>
    );
    act(() => ctx?.setMode('preview'));
    expect(pair()).toEqual({ tool: 'browse', mode: 'preview' });
    act(() => ctx?.setMode('edit'));
    expect(pair()).toEqual({ tool: 'move', mode: 'edit' });
  });

  test('arming a resting tool moves the mode (V / tool-set / escape hatch)', () => {
    mount(
      <ToolProvider>
        <Capture />
      </ToolProvider>
    );
    act(() => ctx?.setTool('browse'));
    expect(pair()).toEqual({ tool: 'browse', mode: 'preview' });
    // The Cmd+click-in-browse escape hatch is a plain setTool('move') at its
    // call site — the invariant is what turns it into a coherent mode flip.
    act(() => ctx?.setTool('move'));
    expect(pair()).toEqual({ tool: 'move', mode: 'edit' });
  });

  test('annotation tools are mode-neutral — pen in preview stays preview', () => {
    mount(
      <ToolProvider initial="browse">
        <Capture />
      </ToolProvider>
    );
    act(() => ctx?.setTool('pen'));
    expect(pair()).toEqual({ tool: 'pen', mode: 'preview' });
    act(() => ctx?.setTool('comment'));
    expect(pair()).toEqual({ tool: 'comment', mode: 'preview' });
  });

  test('resetTool arms the CURRENT mode’s resting tool', () => {
    mount(
      <ToolProvider initial="browse">
        <Capture />
      </ToolProvider>
    );
    // Preview: drawing an annotation then resetting returns to browse (the
    // alive posture) — never to move.
    act(() => ctx?.setTool('pen'));
    act(() => ctx?.resetTool());
    expect(pair()).toEqual({ tool: 'browse', mode: 'preview' });
    // Edit: byte-identical to the pre-DDR-223 hardcoded setTool('move').
    act(() => ctx?.setMode('edit'));
    act(() => ctx?.setTool('pen'));
    act(() => ctx?.resetTool());
    expect(pair()).toEqual({ tool: 'move', mode: 'edit' });
  });
});

// V2-4.3b (V2-1.2 §8 step 7) — REWRITTEN on purpose: the mode switch left the canvas palette for the
// Share cluster (CONTRACT §7, A7). The cluster's segments carry the old `palette-mode-*` testids
// (rule 5) plus `palette-mode-viewing`, and send `set-mode` (mode-lane.test).
// V2-4.5a — the toolbar assertions below were re-pointed from the v1 palette to the two toolbars:
// "Insert element" and "Pen (B)" are gone (Frame / Text / Image and Marker replace them); the claim
// itself — no mode segments, no Present button in the canvas — is unchanged. The boot and invariant
// sections above still hold: they are the ungoverned v1 path, which every canvas runs until the shell's
// first `set-mode` (and a bare specimen or an embed runs for good).
describe('mode-toggle / the toolbar no longer switches modes', () => {
  test('no mode segments, no Present button; Edit has its tools and the insert-backed slots, Preview its annotation tools', () => {
    mount(
      <ToolProvider>
        <Capture />
        <ToolPalette />
      </ToolProvider>
    );
    expect(document.querySelector('[data-testid^="palette-mode-"]')).toBeNull();
    expect(document.querySelector('.dc-tp-mode')).toBeNull();
    expect(document.querySelector('[aria-label^="Presentation mode"]')).toBeNull();
    expect(document.querySelector('[aria-label="Canvas mode"]')).toBeNull();
    expect(document.querySelector('[data-testid="toolbar-edit"]')).not.toBeNull();
    expect(document.querySelector('[aria-label^="Hand (H)"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="toolbar-slot-frame"]')).not.toBeNull();
    expect(document.querySelector('[aria-label^="Marker (M)"]')).toBeNull();
    // Preview (from anywhere — the cluster, a key) swaps in the annotation toolbar.
    act(() => ctx?.setMode('preview'));
    expect(document.querySelector('[data-testid="toolbar-preview"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="toolbar-slot-frame"]')).toBeNull();
    expect(document.querySelector('[aria-label^="Marker (M)"]')).not.toBeNull();
  });
});

describe('mode-toggle / the Share cluster switch', () => {
  const seg = (which: string): HTMLButtonElement | null =>
    document.querySelector(`[data-testid="share-cluster"] [data-testid="palette-mode-${which}"]`);
  const mountCluster = (props: Partial<Parameters<typeof ModeSwitch>[0]> = {}) => {
    const chosen: string[] = [];
    let presented = 0;
    mount(
      <ShareCluster
        faces={[]}
        status={null}
        ctx={menuCtx({ native: true, canvasOpen: true })}
        run={() => {}}
        mode={props.mode ?? 'edit'}
        modeSlot={
          <ModeSwitch
            mode="edit"
            caps={ALL_CAPS}
            onSelect={(m) => chosen.push(m)}
            onPresentCanvas={() => {
              presented += 1;
            }}
            {...props}
          />
        }
      />
    );
    return { chosen, presented: () => presented };
  };

  test('editors: Edit · Preview · Present, on the cluster; the pressed one is the mode', () => {
    mountCluster({ mode: 'preview' });
    expect(seg('edit')).not.toBeNull();
    expect(seg('viewing')).toBeNull();
    expect(seg('preview')?.getAttribute('aria-pressed')).toBe('true');
    expect(seg('edit')?.getAttribute('aria-pressed')).toBe('false');
    for (const w of ['edit', 'preview', 'present'])
      expect(seg(w)?.querySelector('svg')).not.toBeNull();
    // Preview makes the cluster compact
    expect(document.querySelector('[data-testid="share-cluster"]')?.getAttribute('data-mode')).toBe(
      'preview'
    );
  });

  test('Can view / Can comment: Viewing in the first slot — Edit is absent, never greyed', () => {
    mountCluster({ mode: 'viewing', caps: { edit: false, annotate: false, comment: true } });
    expect(seg('edit')).toBeNull();
    expect(seg('viewing')?.getAttribute('aria-pressed')).toBe('true');
    expect(seg('viewing')?.getAttribute('aria-label')).toMatch(/^Viewing/);
  });

  test('every segment is a keyboard-reachable button and runs the mode on Enter/Space (a click)', () => {
    const { chosen } = mountCluster();
    for (const w of ['edit', 'preview', 'present']) {
      const b = seg(w);
      expect(b?.tagName).toBe('BUTTON');
      expect(b?.getAttribute('tabindex')).not.toBe('-1');
      expect(b?.hasAttribute('disabled')).toBe(false);
      b?.focus();
      expect(document.activeElement).toBe(b as Element);
      act(() => b?.click());
    }
    expect(chosen).toEqual(['edit', 'preview', 'present']);
  });

  test('Present ⌄ opens its small menu (focus on the first row); Present the canvas runs it', () => {
    const r = mountCluster();
    const chev = document.querySelector<HTMLButtonElement>('[data-testid="mode-present-menu"]');
    expect(chev?.getAttribute('aria-haspopup')).toBe('menu');
    act(() => chev?.click());
    expect(chev?.getAttribute('aria-expanded')).toBe('true');
    const first = document.querySelector('[data-testid="mode-present-from-selection"]');
    expect(document.activeElement).toBe(first as Element);
    const row = document.querySelector<HTMLButtonElement>('[data-testid="mode-present-canvas"]');
    act(() => row?.click());
    expect(r.presented()).toBe(1);
    expect(document.querySelector('[data-testid="mode-present-list"]')).toBeNull();
  });

  test('S3.1 — Present ⌄ lists the artboards one by one (⌥⌘↵, ⇧⌥⌘↵) above the canvas; later rows stay hidden', () => {
    const asked: string[] = [];
    mountCluster({ onPresent: (k: string) => asked.push(k), presentFromLabel: 'Post 1:1' });
    const open = () =>
      act(() =>
        document.querySelector<HTMLButtonElement>('[data-testid="mode-present-menu"]')?.click()
      );
    open();
    const list = document.querySelector('[data-testid="mode-present-list"]');
    expect(
      [...(list?.querySelectorAll('[role="menuitem"]') ?? [])].map((b) => b.textContent)
    ).toEqual([
      'Present from “Post 1:1”⌥⌘↵',
      'Present from the start⇧⌥⌘↵',
      'Present the canvasno chrome, no pins',
      'Order and notes…',
    ]);
    // Presenter view (p8-c7): drawn greyed for an editor with one display, not a menuitem press target
    expect(
      list?.querySelector('[data-testid="mode-present-presenter-view"]')?.getAttribute('aria-disabled')
    ).toBe('true');
    expect(list?.textContent).toContain('Artboards, one by one');
    // Copy presentation link: not until its slice (hidden).
    expect(list?.textContent).not.toMatch(/presentation link/);
    for (const id of ['from-selection', 'from-start', 'canvas']) {
      if (!document.querySelector('[data-testid="mode-present-list"]')) open();
      act(() =>
        document.querySelector<HTMLButtonElement>(`[data-testid="mode-present-${id}"]`)?.click()
      );
    }
    expect(asked).toEqual(['selection', 'start', 'canvas']);
  });

  test('S3.5 — Order and notes… sits under a rule after the canvas row, for editors only', () => {
    const asked: string[] = [];
    const open = () =>
      act(() =>
        document.querySelector<HTMLButtonElement>('[data-testid="mode-present-menu"]')?.click()
      );
    mountCluster({ onPresent: (k: string) => asked.push(k) });
    open();
    const row = document.querySelector<HTMLButtonElement>(
      '[data-testid="mode-present-order-notes"]'
    );
    expect(row?.getAttribute('role')).toBe('menuitem');
    // the rule, the greyed Presenter view row, then Order and notes…
    const presenter = document.querySelector('[data-testid="mode-present-presenter-view"]');
    expect(row?.closest('.st-pm-li')?.previousElementSibling).toBe(presenter?.closest('.st-pm-li'));
    expect(presenter?.closest('.st-pm-li')?.previousElementSibling?.tagName).toBe('HR');
    act(() => row?.click());
    expect(asked).toEqual(['order-notes']);
    act(() => root?.unmount());
    host?.remove();
    root = null;
    // Can view / Can comment: the row is hidden, never greyed.
    mountCluster({
      onPresent: (k: string) => asked.push(k),
      caps: { edit: false, annotate: false, comment: true },
    });
    open();
    expect(document.querySelector('[data-testid="mode-present-list"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="mode-present-order-notes"]')).toBeNull();
    expect(document.querySelector('[data-testid="mode-present-list"] hr')).toBeNull();
  });

  test('with no canvas open Present is disabled; Edit / Preview still switch', () => {
    mountCluster({ canPresent: false });
    expect(seg('present')?.hasAttribute('disabled')).toBe(true);
    expect(seg('preview')?.hasAttribute('disabled')).toBe(false);
  });
});
