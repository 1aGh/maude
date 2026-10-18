// tool-palette — V2-4.5a: the canvas has TWO toolbars, one per mode, replacing the v1 palette
// (V2-1.2 §5.5). REWRITTEN on purpose; what is kept is named:
//   kept    — the icon module exports a glyph for every default tool (v1 contract, unchanged)
//   kept    — the SSR mount smoke test
//   new     — the slot data (MODE_TOOLS) per mode and role, pending ids hidden and pinned to S2
//   new     — the two toolbars in a live DOM: Edit and Preview slots, Marker tips, Shape kinds,
//             Frame / Text / Image riding today's insert, Stickers → today's picker, sticky lock
//   new     — ToolbarMorph (class + reduced-motion cut + compositor-only keyframes)
//   new     — `toolbar-rect`: ≤ 1 per frame, only on change
// DOM sections run ungoverned FIRST: the mode store is per-document and turns governed for good on
// the first `set-mode`.

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
import { renderToStaticMarkup } from 'react-dom/server';
import { canvasModeStore } from '../bridge/canvas-mode-store.ts';
import {
  ALL_CAPS,
  armTarget,
  CANVAS_MODES,
  type CanvasModeV2,
  isToolId,
  MODE_TOOLS,
  NO_CAPS,
  pendingSlots,
  roleOfCaps,
  type ToolId,
  V2_TOOL_IDS,
  visibleSlots,
} from '../bridge/canvas-modes.ts';
import { TOOL_ICONS } from '../canvas-icons.tsx';
import { _resetReadOnlyCache } from '../read-only-mode.ts';
import { ToolPalette } from '../tool-palette.tsx';
import { lastMarkerTip } from '../toolbars/marker-tip.ts';
import { TOOLBAR_CSS } from '../toolbars/toolbar-css.ts';
import { createRectPoster, type ToolbarRectPayload, wholeRect } from '../toolbars/toolbar-rect.ts';
import { AnnotationsVisibilityProvider } from '../use-annotations-visibility.tsx';
import { DEFAULT_TOOLS, ToolProvider, useToolMode } from '../use-tool-mode.tsx';

const DEFAULT_IDS = new Set<string>(DEFAULT_TOOLS.map((t) => t.id));
const armableDefault = (t: ToolId) => DEFAULT_IDS.has(t);
const ids = (slots: ReturnType<typeof visibleSlots>) => slots.map((s) => s.tool ?? s.panel);

describe('canvas-icons / TOOL_ICONS', () => {
  test('exposes a component for every default tool id', () => {
    for (const t of DEFAULT_TOOLS) {
      expect(TOOL_ICONS[t.id]).toBeDefined();
    }
  });

  test('icons render as <svg> elements with currentColor stroke', () => {
    for (const t of DEFAULT_TOOLS) {
      const Icon = TOOL_ICONS[t.id];
      if (!Icon) continue;
      const html = renderToStaticMarkup(<Icon />);
      expect(html).toContain('<svg');
      expect(html).toContain('stroke="currentColor"');
    }
  });
});

describe('MODE_TOOLS / the slots per mode (V2-1.2 §5.5)', () => {
  test('Edit: Select V · Hand H · Frame F · Shape R · Pen P · Text T · Image I · Component ⇧I · More', () => {
    expect(MODE_TOOLS.edit.slots.map((s) => `${s.label} ${s.key}`.trim())).toEqual([
      'Select V',
      'Hand H',
      'Frame F',
      'Shape R',
      'Pen P',
      'Text T',
      'Image I',
      'Component ⇧I',
      'More',
    ]);
    expect(MODE_TOOLS.edit.rest).toBe('move');
    expect(MODE_TOOLS.edit.slots.every((s) => s.minRole === 'edit')).toBe(true);
    expect(MODE_TOOLS.edit.slots.at(-1)?.more?.map((s) => s.label)).toEqual([
      'Line',
      'Ellipse',
      'Polygon',
      'Crop',
      'Export area',
    ]);
  });

  test('Preview: Hand · Sticky N · Comment C · Marker M · Arrow A · Shape R · Text T · Stickers E · Section S', () => {
    expect(MODE_TOOLS.preview.slots.map((s) => `${s.label} ${s.key}`)).toEqual([
      'Hand H',
      'Sticky N',
      'Comment C',
      'Marker M',
      'Arrow A',
      'Shape R',
      'Text T',
      'Stickers E',
      'Section S',
    ]);
    expect(MODE_TOOLS.preview.rest).toBe('browse');
    const byLabel = Object.fromEntries(MODE_TOOLS.preview.slots.map((s) => [s.label, s]));
    expect(byLabel.Hand.minRole).toBe('view');
    expect(byLabel.Comment.minRole).toBe('comment');
    expect(byLabel.Marker.tips).toEqual(['pen', 'highlighter', 'eraser']); // C14
    expect(byLabel.Shape.popover).toBe('shape-kinds');
    expect(byLabel.Sticky.popover).toBe('sticky-colours');
    expect(byLabel.Stickers.tool).toBeNull(); // E arms no tool: it opens the gallery
    expect(byLabel.Stickers.panel).toBe('stickers');
    for (const l of ['Sticky', 'Marker', 'Arrow', 'Shape', 'Text', 'Stickers', 'Section'])
      expect(byLabel[l].minRole).toBe('edit');
  });

  test('Viewing: Hand → inspect · Comment; Present has no toolbar', () => {
    expect(MODE_TOOLS.viewing.slots.map((s) => `${s.label} ${s.key}`)).toEqual([
      'Hand H',
      'Comment C',
    ]);
    expect(MODE_TOOLS.viewing.rest).toBe('inspect');
    expect(MODE_TOOLS.present.hidden).toBe(true);
    // S3.2b: no toolbar, but one key — the presenter's Pointer (data so the key table knows L).
    expect(MODE_TOOLS.present.slots.map((s) => `${s.label} ${s.key} ${s.tool}`)).toEqual([
      'Pointer L pointer',
    ]);
  });

  test('every slot names a real tool id; v1 ids keep their v1 meaning', () => {
    for (const mode of CANVAS_MODES) {
      for (const s of MODE_TOOLS[mode].slots) {
        for (const t of [s.tool, ...(s.tips ?? []), ...(s.lights ?? [])])
          if (t !== null) expect(isToolId(t)).toBe(true);
        for (const c of s.more ?? []) expect(isToolId(c.tool)).toBe(true);
      }
    }
  });
});

describe('visibleSlots / role, pending and read-only', () => {
  test('an editor sees the Edit slots that exist today; the S2 tools and an empty More stay hidden', () => {
    expect(ids(visibleSlots('edit', 'edit', armableDefault))).toEqual([
      'move',
      'hand',
      'frame', // today's insert Div
      'el-text', // today's insert Text
      'image', // today's insert Image
      'components', // S2.16's panel-only slot: the shell's Component picker
    ]);
  });

  test('pending hides a slot even once the tool exists: only S2 landing may show it', () => {
    // `armable: everything` is the day S2 registers the descriptors; the slot data still says pending.
    expect(ids(visibleSlots('edit', 'edit', () => true))).toEqual([
      'move',
      'hand',
      'frame',
      'el-text',
      'image',
      'components',
    ]);
  });

  test('an editor sees the whole Preview toolbar', () => {
    expect(ids(visibleSlots('preview', 'edit', armableDefault))).toEqual([
      'browse',
      'sticky',
      'comment',
      'pen',
      'arrow',
      'shape',
      'text',
      'stickers',
      'section',
    ]);
  });

  test('Can comment sees Hand + Comment in Preview and in Viewing; Can view sees no toolbar', () => {
    expect(ids(visibleSlots('preview', 'comment', armableDefault))).toEqual(['browse', 'comment']);
    expect(ids(visibleSlots('viewing', 'comment', armableDefault))).toEqual(['inspect', 'comment']);
    for (const m of CANVAS_MODES) expect(visibleSlots(m, 'view', armableDefault)).toEqual([]);
  });

  test('Present shows nothing for anyone', () => {
    expect(visibleSlots('present', 'edit', armableDefault)).toEqual([]);
  });

  test('roles come from the caps the shell sends', () => {
    expect(roleOfCaps(ALL_CAPS)).toBe('edit');
    expect(roleOfCaps({ edit: false, annotate: false, comment: true })).toBe('comment');
    expect(roleOfCaps(NO_CAPS)).toBe('view');
  });

  test('a slot whose tool this canvas does not have is not a button (read-only strips the draw tools)', () => {
    const readOnly = (t: ToolId) => t === 'browse' || t === 'move' || t === 'hand';
    expect(ids(visibleSlots('viewing', 'comment', readOnly))).toEqual(['inspect']); // via the v1 bridge
    expect(ids(visibleSlots('preview', 'comment', readOnly))).toEqual(['browse']);
  });

  test('`inspect` rides `move` until S3 gives it a descriptor', () => {
    expect(armTarget('inspect', armableDefault)).toBe('move');
    expect(armTarget('inspect', (t) => t === 'inspect')).toBe('inspect');
    expect(armTarget('el-pen', armableDefault)).toBeNull();
  });
});

describe('pending slots / no dead buttons', () => {
  // The same pin as V2-4.2's pending menu ids: every not-yet-built tool names its package, and the
  // package list only shrinks when that package lands (the lead edits this list in the same commit).
  test('every pending slot is a v2 tool owned by S2; the list is exactly the unbuilt Edit tools', () => {
    const pend = pendingSlots();
    expect(pend.map((p) => p.slot.tool).sort()).toEqual(
      ['crop', 'el-pen', 'el-shape', 'ellipse', 'line', 'polygon', 'slice'].sort()
    );
    for (const p of pend) {
      expect(p.slot.pending).toBe('S2');
      expect(p.mode).toBe('edit');
      expect((V2_TOOL_IDS as readonly string[]).includes(p.slot.tool as string)).toBe(true);
    }
  });

  test('every other slot is backed by something that works today', () => {
    const pendingTools = new Set(pendingSlots().map((p) => p.slot.tool));
    const check = (s: (typeof MODE_TOOLS)['edit']['slots'][number]) => {
      if (s.pending) return;
      if (s.more) return void s.more.forEach(check);
      if (s.insert) return; // today's insert action
      if (s.tool === null) return expect(s.panel).toBeDefined(); // Stickers
      expect(pendingTools.has(s.tool)).toBe(false);
      expect(armTarget(s.tool, armableDefault)).not.toBeNull();
    };
    // A hidden bar (Present) draws no buttons: its slot is a key, not a button that could be dead.
    for (const m of CANVAS_MODES) if (!MODE_TOOLS[m].hidden) MODE_TOOLS[m].slots.forEach(check);
  });
});

describe('tool-palette / SSR render contract', () => {
  // First render under SSR returns null (the `mounted` gate is intentional — avoids hydration
  // drift); this confirms the import + provider stack don't throw.
  test('mounts inside ToolProvider + visibility provider without throwing', () => {
    expect(() =>
      renderToStaticMarkup(
        <AnnotationsVisibilityProvider>
          <ToolProvider>
            <ToolPalette />
          </ToolProvider>
        </AnnotationsVisibilityProvider>
      )
    ).not.toThrow();
  });
});

describe('toolbar-rect / ≤ 1 per frame, only on change', () => {
  function harness() {
    const frames: Array<() => void> = [];
    const posts: ToolbarRectPayload[] = [];
    let mode: CanvasModeV2 = 'edit';
    let box: ReturnType<typeof wholeRect> | null = { x: 10, y: 20, w: 300, h: 44 };
    const poster = createRectPoster({
      measure: () => box,
      mode: () => mode,
      post: (m) => posts.push(m),
      raf: (fn) => frames.push(fn),
      caf: () => {},
    });
    const frame = () => {
      for (const f of frames.splice(0)) f();
    };
    return {
      poster,
      posts,
      frame,
      set: (m: CanvasModeV2, b: typeof box) => {
        mode = m;
        box = b;
      },
      pending: () => frames.length,
    };
  }

  test('any number of requests inside one frame cost one post', () => {
    const h = harness();
    for (let i = 0; i < 25; i++) h.poster.request();
    expect(h.pending()).toBe(1);
    h.frame();
    expect(h.posts).toEqual([
      { dgn: 'toolbar-rect', mode: 'edit', rect: { x: 10, y: 20, w: 300, h: 44 } },
    ]);
  });

  test('an unchanged rect and mode posts nothing; a mode change or a resize posts once', () => {
    const h = harness();
    h.poster.request();
    h.frame();
    h.poster.request();
    h.frame();
    expect(h.posts.length).toBe(1);
    h.set('preview', { x: 10, y: 20, w: 420, h: 44 });
    h.poster.request();
    h.poster.request();
    h.frame();
    expect(h.posts.map((p) => p.mode)).toEqual(['edit', 'preview']);
    expect(h.posts[1]?.rect?.w).toBe(420);
  });

  test('no toolbar → rect null, once', () => {
    const h = harness();
    h.poster.request();
    h.frame();
    h.set('present', null);
    h.poster.request();
    h.frame();
    h.poster.request();
    h.frame();
    expect(h.posts.at(-1)).toEqual({ dgn: 'toolbar-rect', mode: 'present', rect: null });
    expect(h.posts.length).toBe(2);
  });

  test('cancel drops the pending frame', () => {
    const h = harness();
    h.poster.request();
    h.poster.cancel();
    h.frame();
    // the frame callback was queued before cancel in this fake raf; the real caf removes it
    expect(h.pending()).toBe(0);
  });

  test('wholeRect rounds to whole px and never goes negative or NaN', () => {
    expect(wholeRect({ left: 10.4, top: 20.6, width: 299.5, height: 43.2 })).toEqual({
      x: 10,
      y: 21,
      w: 300,
      h: 43,
    });
    expect(wholeRect({ left: -5, top: Number.NaN, width: 1, height: 1 })).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });
});

describe('TOOLBAR_CSS / material and the morph', () => {
  test('the morph animates compositor-only properties, from the panel token, in a 1 ms cut when reduced', () => {
    const keyframes = [...TOOLBAR_CSS.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?\n\})/g)];
    expect(keyframes.length).toBeGreaterThanOrEqual(2); // in + out
    for (const [, , body] of keyframes) {
      const props = [...(body as string).matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const p of props) expect(['opacity', 'transform']).toContain(p);
    }
    expect(TOOLBAR_CSS).toMatch(/animation:[^;]*var\(--dur-panel,\s*220ms\)/);
    const rm = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(
      TOOLBAR_CSS
    )?.[1];
    expect(rm).toBeDefined();
    expect(rm).toMatch(/1ms/);
  });

  test('one material: no blur in the iframe island (V2-1.8 M1/M4)', () => {
    const decls = [...TOOLBAR_CSS.matchAll(/(?:-webkit-)?backdrop-filter\s*:\s*([^;]+);/g)].map(
      (m) => (m[1] as string).trim()
    );
    for (const d of decls) expect(d).toMatch(/^(none|var\(--island-backdrop\))$/);
    expect(TOOLBAR_CSS).not.toMatch(/\bblur\(/);
  });
});

// ── live DOM ─────────────────────────────────────────────────────────────────────────────────────

const shellPosts: Array<Record<string, unknown>> = [];
const fakeParent = { postMessage: (m: Record<string, unknown>) => shellPosts.push(m) };
let realParent: PropertyDescriptor | undefined;
function asIframe() {
  realParent = Object.getOwnPropertyDescriptor(window, 'parent');
  Object.defineProperty(window, 'parent', { configurable: true, get: () => fakeParent });
}
function restoreParent() {
  if (realParent) Object.defineProperty(window, 'parent', realParent);
  else Reflect.deleteProperty(window, 'parent');
}

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
  root = host = null;
  ctx = null;
  shellPosts.length = 0;
  _resetReadOnlyCache();
});

// the provider also tells the shell its cursor on every tool change; that is not this toolbar's post
const verbs = () => shellPosts.filter((m) => m.dgn !== 'tool-cursor');
const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const slotIds = () =>
  [...document.querySelectorAll('[data-testid^="toolbar-slot-"]')].map((e) =>
    (e.getAttribute('data-testid') as string).replace('toolbar-slot-', '')
  );
const click = (el: Element | null) => act(() => void (el as HTMLElement).click());
const dblclick = (el: Element | null) =>
  act(() => {
    el?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
const mountBar = (children: ReactNode = null, provider: { governed?: boolean } = {}) =>
  mount(
    <ToolProvider {...provider}>
      <Capture />
      <ToolPalette />
      {children}
    </ToolProvider>
  );

describe('the Edit toolbar (ungoverned, an editor)', () => {
  beforeAll(asIframe);
  afterAll(restoreParent);

  test('renders toolbar-edit with the slots that exist today; no pending id, no More, no Export', () => {
    mountBar();
    expect(q('toolbar-edit')?.getAttribute('role')).toBe('toolbar');
    expect(q('toolbar-edit')?.classList.contains('dc-tool-palette')).toBe(true); // chrome selectors keep matching
    expect(slotIds()).toEqual(['move', 'hand', 'frame', 'el-text', 'image', 'components']);
    for (const dead of ['el-shape', 'el-pen', 'component', 'more', 'line', 'ellipse'])
      expect(q(`toolbar-slot-${dead}`)).toBeNull();
    expect(document.querySelector('[aria-label^="Export"]')).toBeNull();
    expect(document.querySelector('[aria-label^="Insert element"]')).toBeNull(); // the "+" is Frame/Text/Image now
    expect(q('toolbar-slot-move')?.getAttribute('aria-pressed')).toBe('true'); // boots on Select
    expect(q('toolbar-slot-move')?.getAttribute('aria-label')).toBe('Select (V)');
    expect(document.querySelector('[aria-label^="Hand (H)"]')).not.toBeNull();
  });

  test('Hand arms the hand tool; the mode stays Edit', () => {
    mountBar();
    click(q('toolbar-slot-hand'));
    expect(ctx?.tool).toBe('hand');
    expect(ctx?.mode).toBe('edit');
    expect(q('toolbar-slot-hand')?.getAttribute('aria-pressed')).toBe('true');
  });

  test('Frame / Image add one at its default size through today’s insert verbs, and arm nothing', () => {
    const art = document.createElement('div');
    art.innerHTML =
      '<article data-dc-screen="a1" aria-current="true"><div class="dc-artboard-body"><p data-cd-id="p1">x</p></div></article>';
    document.body.appendChild(art);
    mountBar();
    click(q('toolbar-slot-frame'));
    click(q('toolbar-slot-image'));
    expect(verbs()).toEqual([
      { dgn: 'insert-request', refId: 'p1', position: 'after', kind: 'div' },
      { dgn: 'insert-image-request', refId: 'p1', position: 'after' },
    ]);
    expect(ctx?.tool).toBe('move');
    expect(q('toolbar-slot-frame')?.hasAttribute('aria-pressed')).toBe(false); // momentary, not a tool
    art.remove();
  });

  test('Text is a tool (click to type, S2.12): it arms el-text, stays pressed and adds nothing by itself', () => {
    const art = document.createElement('div');
    art.innerHTML =
      '<article data-dc-screen="a1" aria-current="true"><div class="dc-artboard-body"><p data-cd-id="p1">x</p></div></article>';
    document.body.appendChild(art);
    mountBar();
    expect(q('toolbar-slot-el-text')?.getAttribute('aria-pressed')).toBe('false');
    click(q('toolbar-slot-el-text'));
    expect(ctx?.tool).toBe('el-text');
    expect(ctx?.mode).toBe('edit');
    expect(q('toolbar-slot-el-text')?.getAttribute('aria-pressed')).toBe('true');
    expect(verbs()).toEqual([]);
    art.remove();
  });
});

describe('the Preview toolbar (ungoverned, an editor)', () => {
  beforeAll(asIframe);
  afterAll(restoreParent);

  test('switching the mode swaps the toolbar and the testid; Hand is the pressed resting tool', () => {
    mountBar();
    act(() => ctx?.setMode('preview'));
    expect(q('toolbar-edit')).toBeNull();
    expect(q('toolbar-preview')).not.toBeNull();
    expect(slotIds()).toEqual([
      'browse',
      'sticky',
      'comment',
      'pen',
      'arrow',
      'shape',
      'text',
      'stickers',
      'section',
    ]);
    expect(q('toolbar-slot-browse')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('toolbar-slot-browse')?.getAttribute('aria-label')).toBe('Hand (H)');
    expect(document.querySelector('[aria-label^="Marker (M)"]')).not.toBeNull();
  });

  test('annotation tools arm and light their slot', () => {
    mountBar();
    act(() => ctx?.setMode('preview'));
    for (const id of ['sticky', 'comment', 'arrow', 'text', 'section']) {
      click(q(`toolbar-slot-${id}`));
      expect(ctx?.tool).toBe(id as never);
      expect(q(`toolbar-slot-${id}`)?.getAttribute('aria-pressed')).toBe('true');
    }
    expect(ctx?.mode).toBe('preview'); // annotation tools are mode-neutral
  });

  test('Marker: the first click arms the default tip; the next opens the tips; a pick arms it and sticks (Q4)', () => {
    mountBar();
    act(() => ctx?.setMode('preview'));
    expect(lastMarkerTip()).toBe('pen');
    click(q('toolbar-slot-pen'));
    expect(ctx?.tool).toBe('pen');
    expect(q('toolbar-popover-marker-tips')).toBeNull();
    click(q('toolbar-slot-pen'));
    const pop = q('toolbar-popover-marker-tips');
    expect(pop?.getAttribute('role')).toBe('menu');
    expect(
      [...(pop?.querySelectorAll('[role="menuitemradio"]') ?? [])].map((e) => e.textContent?.trim())
    ).toEqual(['Marker', 'Highlighter', 'Eraser']);
    click(q('toolbar-tip-highlighter'));
    expect(ctx?.tool).toBe('highlighter');
    expect(lastMarkerTip()).toBe('highlighter');
    expect(q('toolbar-popover-marker-tips')).toBeNull();
    // the slot stays lit for every tip, and shows the tip in use
    expect(q('toolbar-slot-pen')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('toolbar-slot-pen')?.getAttribute('data-tip')).toBe('highlighter');
    // leaving the Marker and coming back re-arms the last tip, not the first
    click(q('toolbar-slot-arrow'));
    expect(q('toolbar-slot-pen')?.getAttribute('aria-pressed')).toBe('false');
    click(q('toolbar-slot-pen'));
    expect(ctx?.tool).toBe('highlighter');
    click(q('toolbar-slot-pen'));
    click(q('toolbar-tip-pen')); // restore for later tests
    expect(lastMarkerTip()).toBe('pen');
  });

  test('Shape: kinds popover as before — arm, click again, pick', () => {
    mountBar();
    act(() => ctx?.setMode('preview'));
    click(q('toolbar-slot-shape'));
    expect(ctx?.tool).toBe('shape');
    expect(q('toolbar-popover-shape-kinds')).toBeNull();
    click(q('toolbar-slot-shape'));
    const pop = q('toolbar-popover-shape-kinds');
    expect(pop?.getAttribute('aria-label')).toBe('Shape type');
    expect(pop?.querySelectorAll('[role="menuitemradio"]').length).toBe(6);
    click(pop?.querySelector('[aria-label="Circle"]') ?? null);
    expect(ctx?.shapeKind).toBe('circle');
    expect(q('toolbar-popover-shape-kinds')).toBeNull();
  });

  test('esc and an outside press close a popover; arming another tool closes it', () => {
    mountBar();
    act(() => ctx?.setMode('preview'));
    click(q('toolbar-slot-shape'));
    click(q('toolbar-slot-shape'));
    expect(q('toolbar-popover-shape-kinds')).not.toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(q('toolbar-popover-shape-kinds')).toBeNull();
    click(q('toolbar-slot-shape'));
    expect(q('toolbar-popover-shape-kinds')).not.toBeNull();
    click(q('toolbar-slot-arrow'));
    expect(q('toolbar-popover-shape-kinds')).toBeNull();
  });

  test('sticky lock: double-click locks a draw slot, a mode change clears it (Q7); Hand and Comment never lock', () => {
    mountBar();
    act(() => ctx?.setMode('preview'));
    dblclick(q('toolbar-slot-arrow'));
    expect(ctx?.sticky).toEqual({ tool: 'arrow', locked: true });
    expect(q('toolbar-slot-arrow')?.getAttribute('data-sticky')).toBe('true');
    act(() => ctx?.setMode('edit'));
    expect(ctx?.sticky.locked).toBe(false);
    act(() => ctx?.setMode('preview'));
    dblclick(q('toolbar-slot-comment'));
    expect(ctx?.sticky.locked).toBe(false);
  });

  test('Stickers asks the shell for its panel (tool-panel-open, not the retired open-sticker-picker); it arms no tool', () => {
    mountBar();
    act(() => ctx?.setMode('preview'));
    const before = ctx?.tool;
    click(q('toolbar-slot-stickers'));
    expect(verbs()).toEqual([{ dgn: 'tool-panel-open', panel: 'stickers', anchor: null }]);
    expect(ctx?.tool).toBe(before);
    expect(q('toolbar-slot-stickers')?.hasAttribute('aria-pressed')).toBe(false);
  });
});

describe('ToolbarMorph', () => {
  beforeAll(asIframe);
  afterAll(restoreParent);

  test('a mode change morphs within the panel duration: a leaving ghost + a morphing class, then clean', async () => {
    mountBar();
    expect(q('toolbar-edit')?.getAttribute('data-morph')).toBeNull();
    act(() => ctx?.setMode('preview'));
    const bar = q('toolbar-preview') as HTMLElement;
    expect(bar.getAttribute('data-morph')).toBe('edit>preview');
    const ghost = bar.querySelector('.dc-tb-ghost');
    expect(ghost?.getAttribute('aria-hidden')).toBe('true');
    // the ghost is a picture, not a second set of controls: no buttons, no testids to collide with
    expect(ghost?.querySelector('button, [data-testid]')).toBeNull();
    expect(document.querySelectorAll('[data-testid="toolbar-slot-move"]').length).toBe(0);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(q('toolbar-preview')?.getAttribute('data-morph')).toBeNull();
    expect(document.querySelector('.dc-tb-ghost')).toBeNull();
  });

  test('reduced motion is a cut: no ghost, no morph state', () => {
    const real = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: /reduce/.test(query),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      mountBar();
      act(() => ctx?.setMode('preview'));
      expect(q('toolbar-preview')?.getAttribute('data-morph')).toBeNull();
      expect(document.querySelector('.dc-tb-ghost')).toBeNull();
    } finally {
      window.matchMedia = real;
    }
  });
});

describe('toolbar-rect from the island', () => {
  beforeAll(asIframe);
  afterAll(restoreParent);
  const rects = () => shellPosts.filter((m) => m.dgn === 'toolbar-rect');
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });

  test('posts the island box on mount and again on a mode change — not on every render', async () => {
    const real = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      const w = this.getAttribute('data-testid') === 'toolbar-preview' ? 420 : 300;
      return {
        left: 100,
        top: 700,
        width: w,
        height: 44,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
      } as DOMRect;
    };
    try {
      mountBar();
      await settle();
      expect(rects()).toEqual([
        { dgn: 'toolbar-rect', mode: 'edit', rect: { x: 100, y: 700, w: 300, h: 44 } },
      ]);
      act(() => ctx?.setTool('hand')); // a re-render with the same box posts nothing
      await settle();
      expect(rects().length).toBe(1);
      act(() => ctx?.setMode('preview'));
      await settle();
      expect(rects().at(-1)).toEqual({
        dgn: 'toolbar-rect',
        mode: 'preview',
        rect: { x: 100, y: 700, w: 420, h: 44 },
      });
      expect(rects().length).toBe(2);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = real;
    }
  });
});

// ── governed (the shell's set-mode) — LAST: the store turns governed for good ────────────────────

describe('the toolbars follow the shell’s mode and role', () => {
  beforeAll(asIframe);
  afterAll(restoreParent);
  const setMode = (mode: string, caps: Record<string, boolean>, extra = {}) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: fakeParent as unknown as Window,
          data: {
            dgn: 'set-mode',
            v: 2,
            seq: canvasModeStore(window).get().modeSeq + 1,
            mode,
            present: null,
            caps,
            ...extra,
          },
        })
      );
    });
  const CAN_COMMENT = { edit: false, annotate: false, comment: true };

  test('an editor: set-mode preview → the Preview toolbar; edit → the Edit toolbar; present → none', () => {
    mountBar(null, { governed: true });
    setMode('preview', ALL_CAPS);
    expect(q('toolbar-preview')).not.toBeNull();
    setMode('edit', ALL_CAPS);
    expect(q('toolbar-edit')).not.toBeNull();
    expect(q('toolbar-preview')).toBeNull();
    setMode('present', ALL_CAPS, { present: { kind: 'canvas' } });
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  });

  test('Can comment: Viewing shows Hand + Comment; Comment arms; Hand rides move until S3', () => {
    mountBar(null, { governed: true });
    setMode('viewing', CAN_COMMENT);
    expect(q('toolbar-viewing')).not.toBeNull();
    expect(slotIds()).toEqual(['inspect', 'comment']);
    expect(q('toolbar-slot-inspect')?.getAttribute('aria-pressed')).toBe('true'); // viewing rests on move
    click(q('toolbar-slot-comment'));
    expect(ctx?.tool).toBe('comment');
    expect(q('toolbar-slot-inspect')?.getAttribute('aria-pressed')).toBe('false');
    click(q('toolbar-slot-inspect'));
    expect(ctx?.tool).toBe('move');
  });

  test('Can comment in Preview: Hand + Comment only', () => {
    mountBar(null, { governed: true });
    setMode('preview', CAN_COMMENT);
    expect(slotIds()).toEqual(['browse', 'comment']);
  });

  test('Can view sees no toolbar in any mode, and the island reports rect null', async () => {
    mountBar(null, { governed: true });
    setMode('preview', ALL_CAPS);
    shellPosts.length = 0;
    setMode('viewing', { edit: false, annotate: false, comment: false });
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    setMode('preview', { edit: false, annotate: false, comment: false });
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(shellPosts.filter((m) => m.dgn === 'toolbar-rect').at(-1)).toMatchObject({ rect: null });
  });
});
