// input-router — Phase 4.1 Task 1. Pure classifier table tests.

import { describe, expect, test } from 'bun:test';

import {
  annotationToolOwnsPointer,
  type ClassifyInput,
  classify,
  crossedDragThreshold,
  DRAG_THRESHOLD_PX,
  dragPansCanvas,
  isArtboardDragChrome,
  isDesignSurface,
  isEditableTarget,
  isOpenTextEditor,
  isOverlayTarget,
  pressStartsPan,
  type Tool,
  yieldsClickToArtboardChrome,
  yieldsToArtboardDrag,
} from '../input-router.tsx';

const base = (over: Partial<ClassifyInput>): ClassifyInput => ({
  type: 'pointermove',
  activeTool: 'move' as Tool,
  ...over,
});

describe('input-router / pointermove — move (select) tool', () => {
  // feature-4 (browse/move split, DDR-187) — the Move tool is now a SELECT
  // tool: a bare hover paints a TOP-level preview halo (Figma's hover outline),
  // Cmd-hover previews the deepest element.
  test('bare hover → hover preview with deep=false (top-level outline)', () => {
    const action = classify(base({ type: 'pointermove', clientX: 10, clientY: 20 }));
    expect(action).toMatchObject({ kind: 'hover', deep: false });
  });

  test('cmd-hover → hover preview with deep=true', () => {
    const action = classify(base({ type: 'pointermove', metaKey: true, clientX: 5, clientY: 6 }));
    expect(action).toMatchObject({ kind: 'hover', deep: true });
  });

  test('ctrl-hover (windows/linux) → hover with deep=true', () => {
    const action = classify(base({ type: 'pointermove', ctrlKey: true }));
    expect(action).toMatchObject({ kind: 'hover', deep: true });
  });

  test('hover in hand tool → no-op', () => {
    const action = classify(base({ type: 'pointermove', activeTool: 'hand' }));
    expect(action.kind).toBe('no-op');
  });

  test('hover in comment tool → hover with deep=true (preview deepest)', () => {
    const action = classify(
      base({ type: 'pointermove', activeTool: 'comment', clientX: 1, clientY: 2 })
    );
    expect(action).toEqual({ kind: 'hover', deep: true, clientX: 1, clientY: 2 });
  });
});

describe('input-router / pointerdown — move (select) tool ladder', () => {
  // feature-4 (browse/move split, DDR-187) — the full Figma select ladder.
  test('bare left-click → select replace, deep=false (TOP-level object)', () => {
    const action = classify(base({ type: 'pointerdown', button: 0, clientX: 100, clientY: 200 }));
    expect(action).toEqual({
      kind: 'select',
      mode: 'replace',
      deep: false,
      clientX: 100,
      clientY: 200,
    });
  });

  test('shift+left-click (no cmd) → select add, deep=false (add TOP-level)', () => {
    const action = classify(base({ type: 'pointerdown', button: 0, shiftKey: true }));
    expect(action).toMatchObject({ kind: 'select', mode: 'add', deep: false });
  });

  test('cmd+left-click → select replace, deep=true (nested single)', () => {
    const action = classify(
      base({ type: 'pointerdown', button: 0, metaKey: true, clientX: 11, clientY: 22 })
    );
    expect(action).toEqual({
      kind: 'select',
      mode: 'replace',
      deep: true,
      clientX: 11,
      clientY: 22,
    });
  });

  test('cmd+shift+left-click → select add, deep=true (multi nested)', () => {
    const action = classify(
      base({ type: 'pointerdown', button: 0, metaKey: true, shiftKey: true })
    );
    expect(action).toMatchObject({ kind: 'select', mode: 'add', deep: true });
  });

  test('ctrl+left-click (linux/windows cmd-equivalent) → select replace deep', () => {
    const action = classify(base({ type: 'pointerdown', button: 0, ctrlKey: true }));
    expect(action).toMatchObject({ kind: 'select', mode: 'replace', deep: true });
  });
});

describe('input-router / pointerdown — non-left buttons', () => {
  test('middle-button → no-op (viewport-controller owns it)', () => {
    const action = classify(base({ type: 'pointerdown', button: 1 }));
    expect(action.kind).toBe('no-op');
  });

  test('right-button → context-menu', () => {
    const action = classify(base({ type: 'pointerdown', button: 2, clientX: 50, clientY: 60 }));
    expect(action).toEqual({ kind: 'context-menu', clientX: 50, clientY: 60 });
  });

  test('space-held + left-click → no-op (viewport-controller pans)', () => {
    const action = classify(base({ type: 'pointerdown', button: 0, spaceHeld: true }));
    expect(action.kind).toBe('no-op');
  });
});

describe('input-router / pointerdown — tool-aware', () => {
  test('comment tool + bare click → drop-comment', () => {
    const action = classify(
      base({ type: 'pointerdown', button: 0, activeTool: 'comment', clientX: 12, clientY: 34 })
    );
    expect(action).toEqual({ kind: 'drop-comment', clientX: 12, clientY: 34 });
  });

  test('comment tool + shift+click → drop-comment (modifier ignored for now)', () => {
    const action = classify(
      base({ type: 'pointerdown', button: 0, activeTool: 'comment', shiftKey: true })
    );
    expect(action.kind).toBe('drop-comment');
  });

  test('hand tool + bare click → no-op (viewport-controller claims the drag)', () => {
    const action = classify(base({ type: 'pointerdown', button: 0, activeTool: 'hand' }));
    expect(action.kind).toBe('no-op');
  });

  test('hand tool + cmd+click → still no-op (no select in hand mode)', () => {
    const action = classify(
      base({ type: 'pointerdown', button: 0, activeTool: 'hand', metaKey: true })
    );
    expect(action.kind).toBe('no-op');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// feature-4 (browse/move split, DDR-187) — POSTURE INVARIANTS. The browse tool
// is the boot default and must be a PURE native pass-through: it claims NOTHING,
// so a freshly-opened mock stays alive (buttons click, links follow). This
// promotes the old `input-router.tsx` comment-invariant ("bare clicks pass
// through") into an enforced gate. If any of these flip to a claim, an existing
// canvas silently loses its native interactivity on boot.
describe('input-router / browse tool — pure pass-through (boot default)', () => {
  const browse = (over: Partial<ClassifyInput>): ClassifyInput =>
    base({ activeTool: 'browse', ...over });

  test('bare left-click → no-op (native button/link/input fires)', () => {
    expect(classify(browse({ type: 'pointerdown', button: 0, clientX: 5, clientY: 6 })).kind).toBe(
      'no-op'
    );
  });

  test('cmd+left-click → select deep (the escape hatch; consumer flips tool to move)', () => {
    // User steer 2026-07-19 — "I clicked to edit" shouldn't require V first.
    expect(classify(browse({ type: 'pointerdown', button: 0, metaKey: true }))).toMatchObject({
      kind: 'select',
      mode: 'replace',
      deep: true,
    });
  });

  test('shift+left-click → no-op (Shift alone is NOT the escape hatch)', () => {
    expect(classify(browse({ type: 'pointerdown', button: 0, shiftKey: true })).kind).toBe('no-op');
  });

  test('bare hover → no-op; Cmd-hover previews deep (escape-hatch affordance)', () => {
    expect(classify(browse({ type: 'pointermove', clientX: 1, clientY: 2 })).kind).toBe('no-op');
    expect(classify(browse({ type: 'pointermove', metaKey: true }))).toMatchObject({
      kind: 'hover',
      deep: true,
    });
  });

  test('right-click → still context-menu (chrome, not canvas content)', () => {
    expect(classify(browse({ type: 'pointerdown', button: 2, clientX: 3, clientY: 4 })).kind).toBe(
      'context-menu'
    );
  });

  test('V keydown → tool move (the router stays live in browse so V switches)', () => {
    expect(classify(browse({ type: 'keydown', key: 'v' }))).toEqual({
      kind: 'tool',
      tool: 'move',
    });
  });
});

// The select action must NEVER be produced from a non-select tool on a bare
// gesture. Guards the "select leaked into comment/draw/hand/browse" regression.
describe('input-router / select never leaks into non-select tools', () => {
  const nonSelectBare: Tool[] = ['browse', 'hand', 'comment', 'pen', 'shape', 'sticky', 'eraser'];
  for (const activeTool of nonSelectBare) {
    test(`bare left-click in ${activeTool} → not a select`, () => {
      const action = classify(base({ type: 'pointerdown', button: 0, activeTool }));
      expect(action.kind).not.toBe('select');
    });
  }
});

describe('input-router / contextmenu event', () => {
  test('always opens menu + carries cursor coords', () => {
    const action = classify(base({ type: 'contextmenu', clientX: 77, clientY: 88 }));
    expect(action).toEqual({ kind: 'context-menu', clientX: 77, clientY: 88 });
  });
});

describe('input-router / keydown — tool letters', () => {
  test('V → tool move', () => {
    const action = classify(base({ type: 'keydown', key: 'v' }));
    expect(action).toEqual({ kind: 'tool', tool: 'move' });
  });

  test('uppercase V (Shift held during letter)', () => {
    const action = classify(base({ type: 'keydown', key: 'V' }));
    expect(action).toEqual({ kind: 'tool', tool: 'move' });
  });

  test('H → tool hand', () => {
    expect(classify(base({ type: 'keydown', key: 'h' }))).toEqual({
      kind: 'tool',
      tool: 'hand',
    });
  });

  test('C → tool comment', () => {
    expect(classify(base({ type: 'keydown', key: 'c' }))).toEqual({
      kind: 'tool',
      tool: 'comment',
    });
  });

  test('Escape → escape action', () => {
    expect(classify(base({ type: 'keydown', key: 'Escape' }))).toEqual({
      kind: 'escape',
    });
  });

  test('Cmd+C with modifier → no-op (browser copy / viewport-controller)', () => {
    const action = classify(base({ type: 'keydown', key: 'c', metaKey: true }));
    expect(action.kind).toBe('no-op');
  });

  test('Cmd+V with modifier → no-op', () => {
    const action = classify(base({ type: 'keydown', key: 'v', metaKey: true }));
    expect(action.kind).toBe('no-op');
  });

  test('Cmd+Escape → escape (cancels regardless of modifiers)', () => {
    const action = classify(base({ type: 'keydown', key: 'Escape', metaKey: true }));
    expect(action.kind).toBe('escape');
  });

  test('V in input field → no-op', () => {
    const action = classify(base({ type: 'keydown', key: 'v', isEditable: true }));
    expect(action.kind).toBe('no-op');
  });

  test('Other letters → no-op', () => {
    expect(classify(base({ type: 'keydown', key: 'x' })).kind).toBe('no-op');
    expect(classify(base({ type: 'keydown', key: 'Tab' })).kind).toBe('no-op');
    expect(classify(base({ type: 'keydown', key: 'Enter' })).kind).toBe('no-op');
  });
});

// V2-4.5b — the letters are the two toolbars' (MODE_TOOLS), rewritten deliberately: B I E O ⇧S and the
// ⇧-letter aliases died with the keys that took them (rule 13). These rows are UNGOVERNED (no
// `set-mode` — a standalone canvas): the keys resolve against the posture the tool implies and a
// crossing applies locally, as v1's mode-neutral tools did. The governed half is tool-keys.test.ts.
describe('input-router / keydown — the toolbar letters, ungoverned', () => {
  const key = (k: string, extra: Partial<ClassifyInput> = {}) =>
    classify(base({ type: 'keydown', key: k, ...extra }));
  const preview = { activeTool: 'browse' as Tool };

  test('B, O, ⇧S, ⇧B → no-op (Pen → Marker M, Ellipse → Edit › More, Section → S)', () => {
    expect(key('b').kind).toBe('no-op');
    expect(key('o').kind).toBe('no-op');
    expect(key('S', { shiftKey: true }).kind).toBe('no-op');
    expect(key('B', { shiftKey: true }).kind).toBe('no-op');
  });

  test("R in Edit's posture → the design Shape tool (S2.13); in Preview's → annotation shape", () => {
    expect(key('r')).toEqual({ kind: 'tool', tool: 'el-shape' });
    expect(key('r', preview)).toEqual({ kind: 'tool', tool: 'shape' });
  });

  test('N A S M → the annotation tool, locally (standalone)', () => {
    expect(key('n')).toEqual({ kind: 'tool', tool: 'sticky' });
    expect(key('a')).toEqual({ kind: 'tool', tool: 'arrow' });
    expect(key('s')).toEqual({ kind: 'tool', tool: 'section' });
    expect(key('m')).toEqual({ kind: 'tool', tool: 'pen' });
    expect(key('m', { markerTip: 'highlighter' })).toEqual({ kind: 'tool', tool: 'highlighter' });
  });

  test('E → the Stickers panel (no tool); I → the Assets tab (S2.15), not the highlighter', () => {
    expect(key('e')).toEqual({ kind: 'panel', panel: 'stickers' });
    expect(key('i')).toEqual({ kind: 'panel', panel: 'assets' });
  });

  test("T: Edit's posture arms click-to-type (el-text, S2.12); Preview's arms annotation Text", () => {
    expect(key('t')).toEqual({ kind: 'tool', tool: 'el-text' });
    expect(key('t', preview)).toEqual({ kind: 'tool', tool: 'text' });
  });

  test('shape tool owns bare pointer events (SVG overlay claims)', () => {
    expect(classify(base({ type: 'pointerdown', activeTool: 'shape', button: 0 })).kind).toBe(
      'no-op'
    );
    expect(classify(base({ type: 'pointermove', activeTool: 'shape' })).kind).toBe('no-op');
  });

  test('Cmd+B (modifier-held) → no-op so the browser keeps it', () => {
    expect(key('b', { metaKey: true }).kind).toBe('no-op');
  });
});

describe('input-router / pointer events — Phase 5 annotation tools', () => {
  test('pointermove in pen tool → no-op (SVG overlay owns it)', () => {
    expect(
      classify(base({ type: 'pointermove', activeTool: 'pen', clientX: 1, clientY: 2 })).kind
    ).toBe('no-op');
  });

  test('pointermove in eraser tool → no-op', () => {
    expect(classify(base({ type: 'pointermove', activeTool: 'eraser' })).kind).toBe('no-op');
  });

  test('bare left-click in rect tool → no-op (SVG overlay claims)', () => {
    expect(classify(base({ type: 'pointerdown', activeTool: 'rect', button: 0 })).kind).toBe(
      'no-op'
    );
  });

  test('bare left-click in ellipse tool → no-op (Phase 5.1)', () => {
    expect(classify(base({ type: 'pointerdown', activeTool: 'ellipse', button: 0 })).kind).toBe(
      'no-op'
    );
  });

  test('pointermove in ellipse tool → no-op (SVG overlay owns it)', () => {
    expect(classify(base({ type: 'pointermove', activeTool: 'ellipse' })).kind).toBe('no-op');
  });

  test('sticky + text tools own bare pointer events (Phase 21 — SVG overlay claims)', () => {
    for (const activeTool of ['sticky', 'text'] as const) {
      expect(classify(base({ type: 'pointerdown', activeTool, button: 0 })).kind).toBe('no-op');
      expect(classify(base({ type: 'pointermove', activeTool })).kind).toBe('no-op');
    }
  });

  test('cmd+left-click in arrow tool → select replace (escape hatch to move)', () => {
    expect(
      classify(
        base({
          type: 'pointerdown',
          activeTool: 'arrow',
          button: 0,
          metaKey: true,
          clientX: 4,
          clientY: 5,
        })
      )
    ).toEqual({
      kind: 'select',
      mode: 'replace',
      deep: true,
      clientX: 4,
      clientY: 5,
    });
  });

  test('right-click in pen tool → context-menu (unchanged)', () => {
    expect(classify(base({ type: 'pointerdown', activeTool: 'pen', button: 2 })).kind).toBe(
      'context-menu'
    );
  });
});

describe('input-router / isEditableTarget', () => {
  test('null target → false', () => {
    expect(isEditableTarget(null)).toBe(false);
  });

  test('plain div → false', () => {
    const el = { tagName: 'DIV', isContentEditable: false } as HTMLElement;
    expect(isEditableTarget(el)).toBe(false);
  });

  test('INPUT → true', () => {
    const el = { tagName: 'INPUT', isContentEditable: false } as HTMLElement;
    expect(isEditableTarget(el)).toBe(true);
  });

  test('TEXTAREA → true', () => {
    const el = { tagName: 'TEXTAREA', isContentEditable: false } as HTMLElement;
    expect(isEditableTarget(el)).toBe(true);
  });

  test('contentEditable=true → true', () => {
    const el = { tagName: 'DIV', isContentEditable: true } as HTMLElement;
    expect(isEditableTarget(el)).toBe(true);
  });

  // Dogfood fix — the reported bug: typing "R" while editing in-canvas
  // element text (canvas-shell.tsx's contenteditable="plaintext-only") fired
  // the Rectangle tool shortcut. `.isContentEditable` SHOULD reflect
  // "plaintext-only" per spec, but engine/version inconsistencies mean it
  // can't be the only check — these lock in the raw-attribute fallback that
  // now makes isEditableTarget resilient regardless.
  test('contenteditable="plaintext-only" (isContentEditable false or unreliable) → true', () => {
    const el = {
      tagName: 'DIV',
      isContentEditable: false,
      getAttribute: (name: string) => (name === 'contenteditable' ? 'plaintext-only' : null),
    } as unknown as HTMLElement;
    expect(isEditableTarget(el)).toBe(true);
  });

  test('bare contenteditable="" attribute → true', () => {
    const el = {
      tagName: 'DIV',
      isContentEditable: false,
      getAttribute: (name: string) => (name === 'contenteditable' ? '' : null),
    } as unknown as HTMLElement;
    expect(isEditableTarget(el)).toBe(true);
  });

  test('plain div WITH a getAttribute method (real-element shape) still → false', () => {
    const el = {
      tagName: 'DIV',
      isContentEditable: false,
      getAttribute: () => null,
    } as unknown as HTMLElement;
    expect(isEditableTarget(el)).toBe(false);
  });
});

// issue-71 — a bare (no-modifier) pointerdown/mousedown on an artboard's own
// drag chrome (the label strip + border, OUTSIDE `.dc-artboard-body`) must
// still be identified so useInputRouter can skip stopImmediatePropagation and
// let use-artboard-drag.tsx's own bubble-phase onPointerDown arm its
// pending→dragging state machine — otherwise no artboard could ever be
// repositioned by dragging its header (the router's capture-phase claim
// killed the event before it reached that listener).
describe('input-router / isArtboardDragChrome', () => {
  // `closest(sel)` here mimics Element.closest: return a truthy stub for any
  // selector this fake node "matches" (is, or is a descendant of), null else.
  const fakeTarget = (memberOf: string[]): EventTarget =>
    ({
      closest: (sel: string) => (memberOf.includes(sel) ? {} : null),
    }) as unknown as EventTarget;

  test('null target → false', () => {
    expect(isArtboardDragChrome(null)).toBe(false);
  });

  test('target with no closest() (non-Element) → false', () => {
    expect(isArtboardDragChrome({} as EventTarget)).toBe(false);
  });

  test('outside any artboard → false', () => {
    expect(isArtboardDragChrome(fakeTarget([]))).toBe(false);
  });

  test('the label strip / border chrome (inside an artboard, not its body) → true', () => {
    expect(isArtboardDragChrome(fakeTarget(['[data-dc-screen]']))).toBe(true);
  });

  test('inside .dc-artboard-body (the canvas content, not chrome) → false', () => {
    expect(isArtboardDragChrome(fakeTarget(['[data-dc-screen]', '.dc-artboard-body']))).toBe(false);
  });
});

// issue-90 — once comment mode is armed, a bare click anywhere on the shell's
// floating chrome (tool palette, zoom pill, minimap, right-click context
// menu) was claimed as `drop-comment` and dropped a stray pin at the
// chrome's own coordinates instead of reaching the chrome's own React
// onClick — the palette became unusable the moment the user picked the
// Comment tool. `classifyContextKind` (canvas-shell.tsx) already treats
// these same selectors as non-canvas `'overlay'` chrome; `isOverlayTarget`
// was the one claim gate that didn't.
describe('input-router / isOverlayTarget — shell chrome exemptions (issue-90)', () => {
  // isOverlayTarget makes ONE `closest(a, b, c, ...)` call against the full
  // comma-joined selector list, unlike isArtboardDragChrome's fakeTarget
  // above (which mimics one call per bare selector) — so the stub instead
  // checks whether any of the target's own classes appears among the
  // selector's comma-separated parts, same as a real `Element.closest` would
  // resolve for a node carrying that class.
  const fakeTarget = (memberOf: string[]): EventTarget =>
    ({
      closest: (sel: string) => (memberOf.some((cls) => sel.includes(cls)) ? {} : null),
    }) as unknown as EventTarget;

  test('null target → false', () => {
    expect(isOverlayTarget(null)).toBe(false);
  });

  test('a click on the tool palette is exempt', () => {
    expect(isOverlayTarget(fakeTarget(['.dc-tool-palette']))).toBe(true);
  });

  test('a click on the zoom toolbar is exempt', () => {
    expect(isOverlayTarget(fakeTarget(['.dc-zoom-tb']))).toBe(true);
  });

  test('a click on the minimap is exempt', () => {
    expect(isOverlayTarget(fakeTarget(['.dc-mm']))).toBe(true);
  });

  test('a click on the right-click context menu is exempt', () => {
    expect(isOverlayTarget(fakeTarget(['.dc-context-menu']))).toBe(true);
  });

  test('a click on ordinary canvas content is NOT exempt', () => {
    expect(isOverlayTarget(fakeTarget([]))).toBe(false);
  });

  test('the pre-existing comment-overlay exemptions still hold', () => {
    expect(isOverlayTarget(fakeTarget(['.cm-composer']))).toBe(true);
    expect(isOverlayTarget(fakeTarget(['.cm-thread']))).toBe(true);
    expect(isOverlayTarget(fakeTarget(['.cm-mention-popup']))).toBe(true);
    expect(isOverlayTarget(fakeTarget(['.cm-pin']))).toBe(true);
    expect(isOverlayTarget(fakeTarget(['[data-mediaref-player]']))).toBe(true);
  });

  // Security review finding (issue-90) — `.dc-world` is where the ACTIVE
  // CANVAS's own untrusted, AI/user-authored JSX renders. None of the real
  // chrome ever lives there, so an element inside `.dc-world` that ALSO
  // carries one of these class names is necessarily a same-name imposter —
  // untrusted canvas content spoofing the shell's own chrome to make the
  // router yield (skip preventDefault) on it instead of claiming the
  // gesture. Must be rejected regardless of which chrome class it copies.
  test('an element inside .dc-world carrying a spoofed chrome class is NOT exempt', () => {
    expect(isOverlayTarget(fakeTarget(['.dc-world', '.dc-tool-palette']))).toBe(false);
    expect(isOverlayTarget(fakeTarget(['.dc-world', '.dc-zoom-tb']))).toBe(false);
    expect(isOverlayTarget(fakeTarget(['.dc-world', '.dc-mm']))).toBe(false);
    expect(isOverlayTarget(fakeTarget(['.dc-world', '.dc-context-menu']))).toBe(false);
    expect(isOverlayTarget(fakeTarget(['.dc-world', '.cm-composer']))).toBe(false);
  });
});

// issue-71 — the actual regression: before this fix, useInputRouter's
// pointerdown/mousedown handlers called `stopImmediatePropagation()` on EVERY
// claimed action, including a bare click on an artboard's own drag chrome —
// which killed the event before use-artboard-drag.tsx's bubble-phase
// onPointerDown (bound to that same artboard) ever saw it, so dragging an
// artboard by its header did nothing in either the Move or the (former)
// always-select tool state. `yieldsToArtboardDrag` is the exact decision the
// handlers now gate `stopImmediatePropagation` on.
describe('input-router / yieldsToArtboardDrag', () => {
  const chrome = (): EventTarget =>
    ({
      closest: (sel: string) => (sel === '[data-dc-screen]' ? {} : null),
    }) as unknown as EventTarget;
  const body = (): EventTarget => ({ closest: () => ({}) }) as unknown as EventTarget; // matches every selector, incl. .dc-artboard-body

  test('bare click on artboard chrome (the reported bug) → true (let the drag hook see it)', () => {
    const action = classify({ type: 'pointerdown', activeTool: 'move', button: 0 });
    expect(yieldsToArtboardDrag(action, chrome(), { metaKey: false, ctrlKey: false })).toBe(true);
  });

  test('shift+click on artboard chrome (multi-select-and-drag) → true', () => {
    const action = classify({
      type: 'pointerdown',
      activeTool: 'move',
      button: 0,
      shiftKey: true,
    });
    expect(yieldsToArtboardDrag(action, chrome(), { metaKey: false, ctrlKey: false })).toBe(true);
  });

  test('cmd+click on artboard chrome (deep-select, not a drag) → false', () => {
    const action = classify({
      type: 'pointerdown',
      activeTool: 'move',
      button: 0,
      metaKey: true,
    });
    expect(yieldsToArtboardDrag(action, chrome(), { metaKey: true, ctrlKey: false })).toBe(false);
  });

  test('bare click on .dc-artboard-body content (not chrome) → false', () => {
    const action = classify({ type: 'pointerdown', activeTool: 'move', button: 0 });
    expect(yieldsToArtboardDrag(action, body(), { metaKey: false, ctrlKey: false })).toBe(false);
  });

  test('bare click outside any artboard → false (nothing to yield to)', () => {
    const action = classify({ type: 'pointerdown', activeTool: 'move', button: 0 });
    const outside = { closest: () => null } as unknown as EventTarget;
    expect(yieldsToArtboardDrag(action, outside, { metaKey: false, ctrlKey: false })).toBe(false);
  });

  test('right-click (context-menu) on chrome → false — not a select at all', () => {
    const action = classify({ type: 'pointerdown', activeTool: 'move', button: 2 });
    expect(yieldsToArtboardDrag(action, chrome(), { metaKey: false, ctrlKey: false })).toBe(false);
  });
});

// issue-78 — the actual regression: the router's capture-phase `click`
// listener claimed every bare click while in the Move tool (and every
// Cmd/Ctrl+click from Browse/annotation tools) and called
// `stopImmediatePropagation()` unconditionally, unlike its pointerdown/
// mousedown siblings above. That killed the native click on any artboard-
// chrome control BEFORE React's delegated onClick ever ran — including the
// video-timeline badge (`.dc-artboard-video-badge`, DDR-148), which sits
// outside `.dc-artboard-body` as chrome. Clicking it did nothing.
// `yieldsClickToArtboardChrome` is the decision the click handler now gates
// its suppression on, mirroring `yieldsToArtboardDrag` above.
describe('input-router / yieldsClickToArtboardChrome', () => {
  const chrome = (): EventTarget =>
    ({
      closest: (sel: string) => (sel === '[data-dc-screen]' ? {} : null),
    }) as unknown as EventTarget;
  const body = (): EventTarget => ({ closest: () => ({}) }) as unknown as EventTarget; // matches every selector, incl. .dc-artboard-body

  test('bare click on the video-timeline badge in Move tool (the reported bug) → true', () => {
    expect(
      yieldsClickToArtboardChrome('select', chrome(), { metaKey: false, ctrlKey: false })
    ).toBe(true);
  });

  test('cmd+click on artboard chrome (deep-select, not a chrome control) → false', () => {
    expect(yieldsClickToArtboardChrome('select', chrome(), { metaKey: true, ctrlKey: false })).toBe(
      false
    );
  });

  test('bare click on .dc-artboard-body content (not chrome) → false', () => {
    expect(yieldsClickToArtboardChrome('select', body(), { metaKey: false, ctrlKey: false })).toBe(
      false
    );
  });

  test('bare click outside any artboard → false (nothing to yield to)', () => {
    const outside = { closest: () => null } as unknown as EventTarget;
    expect(yieldsClickToArtboardChrome('select', outside, { metaKey: false, ctrlKey: false })).toBe(
      false
    );
  });

  test('non-select routed kind (e.g. context-menu) on chrome → false', () => {
    expect(
      yieldsClickToArtboardChrome('context-menu', chrome(), { metaKey: false, ctrlKey: false })
    ).toBe(false);
  });

  test('null routed kind on chrome → false', () => {
    expect(yieldsClickToArtboardChrome(null, chrome(), { metaKey: false, ctrlKey: false })).toBe(
      false
    );
  });
});

// T25 — Drag-vs-click threshold. Centralized here so every drag-class gesture
// (artboard drag, artboard marquee, element marquee, annotation pen/rect/etc.)
// reads the same value. Microsoft Win32 SM_CXDRAG default + d3-drag convention.
describe('input-router / crossedDragThreshold', () => {
  test('constant is 4', () => {
    expect(DRAG_THRESHOLD_PX).toBe(4);
  });

  test('no movement → false', () => {
    expect(crossedDragThreshold(100, 200, 100, 200)).toBe(false);
  });

  test('3 px move (sub-threshold) → false', () => {
    expect(crossedDragThreshold(0, 0, 3, 0)).toBe(false);
    expect(crossedDragThreshold(0, 0, 2, 2)).toBe(false); // hypot ≈ 2.83
  });

  test('exactly 4 px → true (boundary inclusive)', () => {
    expect(crossedDragThreshold(0, 0, 4, 0)).toBe(true);
    expect(crossedDragThreshold(0, 0, 0, 4)).toBe(true);
  });

  test('5 px diagonal → true', () => {
    // 3-4-5 right triangle: hypot = 5
    expect(crossedDragThreshold(10, 20, 13, 24)).toBe(true);
  });

  test('negative deltas — hypot is direction-agnostic', () => {
    expect(crossedDragThreshold(50, 50, 47, 46)).toBe(true); // hypot = 5
    expect(crossedDragThreshold(50, 50, 48, 49)).toBe(false); // hypot ≈ 2.24
  });
});

describe('input-router / keydown — undo + redo (Phase 20)', () => {
  test('Cmd+Z → undo', () => {
    expect(classify(base({ type: 'keydown', key: 'z', metaKey: true })).kind).toBe('undo');
  });

  test('Cmd+Shift+Z → redo', () => {
    expect(classify(base({ type: 'keydown', key: 'z', metaKey: true, shiftKey: true })).kind).toBe(
      'redo'
    );
  });

  test('Ctrl+Z → undo (Windows / Linux mac-less)', () => {
    expect(classify(base({ type: 'keydown', key: 'z', ctrlKey: true })).kind).toBe('undo');
  });

  test('Ctrl+Y → redo (Windows convention)', () => {
    expect(classify(base({ type: 'keydown', key: 'y', ctrlKey: true })).kind).toBe('redo');
  });

  test('Cmd+Y → redo (mac users with Windows muscle-memory)', () => {
    expect(classify(base({ type: 'keydown', key: 'y', metaKey: true })).kind).toBe('redo');
  });

  test('Cmd+Z inside editable → no-op (browser native text undo wins)', () => {
    expect(
      classify(base({ type: 'keydown', key: 'z', metaKey: true, isEditable: true })).kind
    ).toBe('no-op');
  });

  test('Cmd+Opt+Z → no-op (Alt is reserved for browser text gestures)', () => {
    expect(classify(base({ type: 'keydown', key: 'z', metaKey: true, altKey: true })).kind).toBe(
      'no-op'
    );
  });

  test('bare Z → no-op (Z is not a tool letter; needs Cmd)', () => {
    expect(classify(base({ type: 'keydown', key: 'z' })).kind).toBe('no-op');
  });

  test('Cmd+Shift+Y → no-op (only Cmd+Y; we do not over-claim)', () => {
    expect(classify(base({ type: 'keydown', key: 'y', metaKey: true, shiftKey: true })).kind).toBe(
      'no-op'
    );
  });
});

// S3.9 (V2-1.2 Q3) — Preview's Hand rests on `browse`: a click uses the design, a drag on empty canvas (or
// outside an artboard's design surface) pans, a drag on the design goes to the design, Space-drag pans
// everywhere. The viewport controller asks this per pointerdown.
describe('input-router / dragPansCanvas — Preview Hand (Q3)', () => {
  test('hand pans anywhere', () => {
    expect(dragPansCanvas('hand', true)).toBe(true);
    expect(dragPansCanvas('hand', false)).toBe(true);
  });
  test('browse pans on empty canvas and outside the design surface, never on the design', () => {
    expect(dragPansCanvas('browse', false)).toBe(true);
    expect(dragPansCanvas('browse', true)).toBe(false);
  });
  test('every other tool leaves the drag to its own handler', () => {
    for (const t of ['move', 'comment', 'pen', 'shape', 'sticky', 'text', 'eraser'] as Tool[]) {
      expect(dragPansCanvas(t, false)).toBe(false);
      expect(dragPansCanvas(t, true)).toBe(false);
    }
  });
  // A press inside an open text editor is text editing (caret, word select): Preview's Hand must not start a pan
  // there, because the pan takes the pointer (setPointerCapture) and the editor then never sees its mouseup, click or
  // dblclick — the dblclick lands on the canvas and fit() throws the view away (annotations-ui R2b).
  test('pressStartsPan: the Hand does not pan from inside an open text editor', () => {
    const el = (sel: string) => ({ closest: (q: string) => (q.includes(sel) ? {} : null) });
    const editor = el('[data-annot-editor]') as unknown as EventTarget;
    const bare = el('nothing') as unknown as EventTarget;
    expect(pressStartsPan('browse', bare)).toBe(true);
    expect(pressStartsPan('browse', editor)).toBe(false);
    expect(pressStartsPan('hand', editor)).toBe(true); // the dedicated Hand pans anywhere
    expect(isOpenTextEditor(editor)).toBe(true);
    expect(isOpenTextEditor(null)).toBe(false);
  });
  test('isDesignSurface: inside an artboard body, not its label strip or the bare canvas', () => {
    const el = (hit: boolean) => ({
      closest: (sel: string) => (hit && sel === '.dc-artboard-body' ? {} : null),
    });
    expect(isDesignSurface(el(true) as unknown as EventTarget)).toBe(true);
    expect(isDesignSurface(el(false) as unknown as EventTarget)).toBe(false);
    expect(isDesignSurface(null)).toBe(false);
    expect(isDesignSurface({} as EventTarget)).toBe(false);
  });
});

// S4.9 (an-visibility) - the posture rows: Edit shows the annotation layer quiet and click-through, so a
// leftover annotation tool id owns no pointer there; Preview's owns it; a canvas no shell governs is v1.
describe('input-router / annotation tools by mode (S4.9)', () => {
  test('Edit: a bare click with a leftover annotation tool selects the design under the sticky', () => {
    const action = classify(
      base({ type: 'pointerdown', button: 0, activeTool: 'sticky' as Tool, mode: 'edit' })
    );
    expect(action).toMatchObject({ kind: 'select', mode: 'replace' });
  });

  test('Edit: hover with a leftover annotation tool still paints the design halo', () => {
    const action = classify(base({ type: 'pointermove', activeTool: 'pen' as Tool, mode: 'edit' }));
    expect(action.kind).toBe('hover');
  });

  test('Preview: the armed annotation tool owns the click', () => {
    expect(
      classify(
        base({ type: 'pointerdown', button: 0, activeTool: 'sticky' as Tool, mode: 'preview' })
      )
    ).toEqual({ kind: 'no-op' });
    expect(
      classify(base({ type: 'pointermove', activeTool: 'pen' as Tool, mode: 'preview' }))
    ).toEqual({ kind: 'no-op' });
  });

  test('a canvas no shell governs keeps v1: the armed annotation tool owns the click', () => {
    expect(
      classify(base({ type: 'pointerdown', button: 0, activeTool: 'sticky' as Tool }))
    ).toEqual({ kind: 'no-op' });
  });

  test('Viewing and Present never hand the pointer to an annotation tool', () => {
    for (const mode of ['viewing', 'present'] as const)
      expect(annotationToolOwnsPointer({ activeTool: 'pen' as Tool, mode })).toBe(false);
  });
});
