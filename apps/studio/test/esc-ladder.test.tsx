// S3.12 — the esc ladder end to end (V2-1.2 §5.4 transitions, 04 md-esc: "esc always steps back one place … never two
// at once, never out of the project").
//
//  A · the ladder as data: every md-esc row, driven press by press through `runEscRung`, takes exactly ONE step;
//  B · the canvas router: a real `useInputRouter` + governed ToolProvider with the ladder as its onEscape — what a
//      press posts and what it leaves alone (the half-written reply, an open menu, the mode);
//  C · the shell: esc with the shell focused (`shellEscDecision` / `shellStepBack`) and the mode request the canvas
//      sends (`decideModeRequest`), for Preview, Present, Viewing and a held past version.
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

import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { canvasModeStore } from '../bridge/canvas-mode-store.ts';
import type { CanvasModeV2 } from '../bridge/canvas-modes.ts';
import {
  ESC_LADDER,
  ESC_OWNER_ATTR,
  ESC_TERMINAL,
  type EscOutcome,
  escOwnerOpen,
  runEscRung,
} from '../bridge/esc-ladder.ts';
import {
  capsFor,
  createShellMode,
  decideModeRequest,
  shellEscDecision,
} from '../client/v2/shell/canvas-mode.js';
import { useInputRouter } from '../input-router.tsx';
import { ToolProvider, useToolMode } from '../use-tool-mode.tsx';

// ── A · the ladder as data ────────────────────────────────────────────────────────────────────────────

/** What is open on a canvas at a moment. `owner` = a menu / thread / picker that closes itself. */
interface Canvas {
  mode: CanvasModeV2;
  tool: string;
  stroke?: boolean;
  selection?: boolean;
  owner?: boolean;
}

const REST: Record<CanvasModeV2, string> = {
  edit: 'move',
  preview: 'browse',
  viewing: 'inspect',
  present: 'browse',
};

/** One press against a fake canvas: the handlers ARE the canvas's rungs, over mutable state. */
function press(c: Canvas): EscOutcome {
  const owner = !!c.owner;
  c.owner = false; // the owner closes itself on the press (or was never open)
  return runEscRung(
    c.mode,
    c.tool,
    {
      stroke: () => {
        if (!c.stroke) return false;
        c.stroke = false;
        return true;
      },
      selection: () => {
        if (!c.selection) return false;
        c.selection = false;
        return true;
      },
      tool: () => {
        c.tool = REST[c.mode];
        return true;
      },
    },
    owner
  );
}

/** How many things a press changed: stroke, selection, tool, an owner closing — the mode steps count as one. */
function changed(before: Canvas, after: Canvas, outcome: EscOutcome): number {
  let n = 0;
  if (before.stroke && !after.stroke) n += 1;
  if (before.selection && !after.selection) n += 1;
  if (before.tool !== after.tool) n += 1;
  if (before.owner && !after.owner) n += 1;
  if (outcome === 'back') n += 1;
  return n;
}

/** The 04 md-esc rows, as presses: each line is the outcome of the 1st, 2nd … press from that state. */
const ROWS: Array<{ row: string; from: Canvas; presses: EscOutcome[] }> = [
  // Edit — "Deselects, closes a menu, or leaves a tool for Select. Nothing selected: nothing happens."
  {
    row: 'Edit · a selection',
    from: { mode: 'edit', tool: 'move', selection: true },
    presses: ['selection', 'stay'],
  },
  {
    row: 'Edit · a menu is open',
    from: { mode: 'edit', tool: 'move', selection: true, owner: true },
    presses: ['owner', 'selection', 'stay'],
  },
  {
    row: 'Edit · a tool (Frame)',
    from: { mode: 'edit', tool: 'frame' },
    presses: ['tool', 'stay'],
  },
  {
    row: 'Edit · a selection AND a tool: deselect first (contract), then Select',
    from: { mode: 'edit', tool: 'frame', selection: true },
    presses: ['selection', 'tool', 'stay'],
  },
  {
    row: 'Edit · nothing selected',
    from: { mode: 'edit', tool: 'move' },
    presses: ['stay', 'stay'],
  },
  // Preview — "Closes a menu or overlay inside the design first. Then back to Edit."
  {
    row: 'Preview · a menu / overlay',
    from: { mode: 'preview', tool: 'browse', owner: true },
    presses: ['owner', 'back'],
  },
  { row: 'Preview · at rest', from: { mode: 'preview', tool: 'browse' }, presses: ['back'] },
  // Present — "Back to the canvas" (Artboards: the artboard settles, presenter view closes; Canvas: same view)
  { row: 'Present · Artboards', from: { mode: 'present', tool: 'browse' }, presses: ['back'] },
  { row: 'Present · Canvas', from: { mode: 'present', tool: 'browse' }, presses: ['back'] },
  {
    row: 'Present · a menu first ("esc first")',
    from: { mode: 'present', tool: 'browse', owner: true },
    presses: ['owner', 'back'],
  },
  // Image · Component — "Closes the picker; nothing is placed. Second esc: back to Select."
  {
    row: 'Image · Component picker',
    from: { mode: 'edit', tool: 'image', owner: true },
    presses: ['owner', 'tool', 'stay'],
  },
  // Comment · C — "Closes the open thread; a half-written reply is kept. Second esc: back to Hand, then to Edit."
  {
    row: 'Comment · thread open',
    from: { mode: 'preview', tool: 'comment', owner: true },
    presses: ['owner', 'tool', 'back'],
  },
  {
    row: 'Comment · Viewing',
    from: { mode: 'viewing', tool: 'comment', owner: true },
    presses: ['owner', 'tool', 'stay'],
  },
  // Annotation tools — "Leaves the tool for Hand; stickies, marker and arrows stay. Second esc: back to Edit."
  {
    row: 'Annotation tool (N C M A E S got you here)',
    from: { mode: 'preview', tool: 'sticky' },
    presses: ['tool', 'back'],
  },
  // Inspect · ⌘-click — "Clears the selection. Second esc: back to Edit."
  {
    row: 'Inspect · ⌘-click',
    from: { mode: 'preview', tool: 'browse', selection: true },
    presses: ['selection', 'back'],
  },
  {
    row: 'Inspect · Viewing click',
    from: { mode: 'viewing', tool: 'inspect', selection: true },
    presses: ['selection', 'stay'],
  },
  // Viewing — "There's no Edit to return to."
  {
    row: 'Viewing · at rest',
    from: { mode: 'viewing', tool: 'inspect' },
    presses: ['stay', 'stay'],
  },
  // Switching mid-drag — a drag is set down where it is
  {
    row: 'Mid-drag arrow in Preview',
    from: { mode: 'preview', tool: 'arrow', stroke: true },
    presses: ['stroke', 'tool', 'back'],
  },
];

describe('A · every md-esc row takes exactly one step per press', () => {
  for (const { row, from, presses } of ROWS)
    test(row, () => {
      const c: Canvas = { ...from };
      const seen: EscOutcome[] = [];
      for (const _ of presses) {
        const before = { ...c };
        const outcome = press(c);
        seen.push(outcome);
        // never two at once: the press changed at most one thing, and the terminal changed nothing here
        const n = changed(before, c, outcome);
        expect(n).toBeLessThanOrEqual(1);
        expect(outcome === 'stay' ? n : 1 - n).toBe(outcome === 'stay' ? 0 : 0);
      }
      expect(seen).toEqual(presses);
    });

  test('a ladder always ends at its mode’s terminal, and only Preview and Present have somewhere to go', () => {
    expect(ESC_TERMINAL).toEqual({
      edit: 'stay',
      preview: 'back',
      viewing: 'stay',
      present: 'back',
    });
    for (const m of ['edit', 'preview', 'viewing', 'present'] as const) {
      const c: Canvas = { mode: m, tool: REST[m] };
      expect(press(c)).toBe(ESC_TERMINAL[m]);
    }
  });

  test('the rungs run in the contract’s order: Edit deselects BEFORE it leaves a tool; Preview/Viewing leave the tool first', () => {
    expect([...ESC_LADDER.edit]).toEqual(['stroke', 'selection', 'tool']);
    expect([...ESC_LADDER.preview]).toEqual(['stroke', 'tool', 'selection']);
    expect([...ESC_LADDER.viewing]).toEqual(['stroke', 'tool', 'selection']);
    expect([...ESC_LADDER.present]).toEqual([]);
  });

  test('an owner takes the press and NOTHING else runs (no handler is even asked)', () => {
    const asked: string[] = [];
    const out = runEscRung(
      'preview',
      'sticky',
      {
        stroke: () => (asked.push('stroke'), true),
        selection: () => (asked.push('selection'), true),
        tool: () => (asked.push('tool'), true),
      },
      true
    );
    expect(out).toBe('owner');
    expect(asked).toEqual([]);
  });

  test('the tool rung is only asked when a tool is armed — at rest it never reports a step it did not take', () => {
    let asked = 0;
    expect(runEscRung('preview', 'browse', { tool: () => (asked++, true) })).toBe('back');
    expect(runEscRung('edit', 'move', { tool: () => (asked++, true) })).toBe('stay');
    expect(runEscRung('viewing', 'inspect', { tool: () => (asked++, true) })).toBe('stay');
    expect(asked).toBe(0);
  });
});

// ── B · the canvas router ─────────────────────────────────────────────────────────────────────────────

const shellPosts: Array<Record<string, unknown>> = [];
const fakeParent = { postMessage: (m: Record<string, unknown>) => shellPosts.push(m) };
let realParent: PropertyDescriptor | undefined;
const asIframe = () => {
  realParent = Object.getOwnPropertyDescriptor(window, 'parent');
  Object.defineProperty(window, 'parent', { configurable: true, get: () => fakeParent });
};
const restoreParent = () => {
  if (realParent) Object.defineProperty(window, 'parent', realParent);
  else delete (window as unknown as { parent?: unknown }).parent;
};

const EDITOR = capsFor({ canEdit: true });
let roots: Root[] = [];
let ctx: ReturnType<typeof useToolMode> | null = null;
const canvas = { stroke: false, selection: false };
const log: EscOutcome[] = [];

/** canvas-shell's wiring in miniature: the real router, a governed provider, the real ladder as `onEscape`. */
function LadderRouter() {
  const c = useToolMode();
  ctx = c;
  const host = useRef<HTMLDivElement | null>(null);
  useInputRouter({
    hostRef: host,
    getActiveTool: () => c.tool,
    callbacks: {
      onEscape: () => {
        const mode = canvasModeStore(window).get().mode;
        if (!mode) return;
        const outcome = runEscRung(mode, c.tool, {
          stroke: () => {
            if (!canvas.stroke) return false;
            canvas.stroke = false;
            return true;
          },
          selection: () => {
            if (!canvas.selection) return false;
            canvas.selection = false;
            return true;
          },
          tool: () => {
            c.clearSticky();
            c.resetTool();
            return true;
          },
        });
        log.push(outcome);
        return outcome !== 'back' && outcome !== 'stay';
      },
    },
  });
  return <div ref={host} />;
}

const mount = () => {
  const h = document.createElement('div');
  document.body.append(h);
  const r = createRoot(h);
  roots.push(r);
  act(() =>
    r.render(
      <ToolProvider governed>
        <LadderRouter />
      </ToolProvider>
    )
  );
};
const setMode = (mode: string, extra: Record<string, unknown> = {}) =>
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
          caps: EDITOR,
          ...extra,
        },
      })
    );
  });
const esc = () => {
  let ev: KeyboardEvent | null = null;
  act(() => {
    ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
  });
  return ev as unknown as KeyboardEvent;
};
const back = () => shellPosts.filter((m) => m.dgn === 'mode-request' && m.mode === 'back');

describe('B · the canvas router posts back only when the press ran no rung', () => {
  beforeAll(asIframe);
  afterAll(restoreParent);
  afterEach(() => {
    act(() => {
      for (const r of roots) r.unmount();
    });
    roots = [];
    ctx = null;
    shellPosts.length = 0;
    log.length = 0;
    canvas.stroke = canvas.selection = false;
    for (const el of Array.from(document.querySelectorAll(`[${ESC_OWNER_ATTR}]`))) el.remove();
  });

  test('an ungoverned canvas (no set-mode) keeps v1: one press runs everything and asks nothing (first: no set-mode has governed this window yet)', () => {
    mount();
    shellPosts.length = 0;
    esc();
    expect(log).toEqual([]); // the governed ladder is not run
    expect(shellPosts.filter((m) => m.dgn === 'mode-request')).toEqual([]);
  });

  test('Inspect: Preview + a selection — the first esc clears it and the mode stays; the second goes back (04 md-esc)', () => {
    mount();
    setMode('preview', { tool: 'browse' });
    canvas.selection = true;
    shellPosts.length = 0;
    esc();
    expect(log).toEqual(['selection']);
    expect(canvas.selection).toBe(false);
    expect(back()).toEqual([]); // not two at once
    esc();
    expect(log).toEqual(['selection', 'back']);
    expect(back()).toEqual([{ dgn: 'mode-request', mode: 'back', cause: 'esc' }]);
  });

  test('an annotation tool: the first esc leaves it for Hand, the second goes back', () => {
    mount();
    setMode('preview', { tool: 'sticky' });
    shellPosts.length = 0;
    esc();
    expect([ctx?.tool, back().length]).toEqual(['browse', 0]);
    esc();
    expect(back().length).toBe(1);
  });

  test('Edit never asks the shell for a mode: deselect, then the tool, then nothing', () => {
    mount();
    setMode('edit');
    canvas.selection = true;
    act(() => ctx?.setTool('move'));
    shellPosts.length = 0;
    esc();
    expect(canvas.selection).toBe(false);
    esc();
    esc();
    expect(log).toEqual(['selection', 'stay', 'stay']);
    expect(shellPosts.filter((m) => m.dgn === 'mode-request')).toEqual([]);
  });

  test('a half-drawn mark is set down by the first press; the tool and the mode wait for the next', () => {
    mount();
    setMode('preview', { tool: 'arrow' });
    canvas.stroke = true;
    shellPosts.length = 0;
    esc();
    expect([log[0], canvas.stroke, ctx?.tool, back().length]).toEqual([
      'stroke',
      false,
      'arrow',
      0,
    ]);
    esc();
    expect([log[1], ctx?.tool, back().length]).toEqual(['tool', 'browse', 0]);
    esc();
    expect(back().length).toBe(1);
  });

  test('an open menu / thread (an esc owner) takes the press: no rung, no back, the key is left unconsumed', () => {
    mount();
    setMode('preview', { tool: 'comment' });
    canvas.selection = true;
    const owner = document.createElement('div');
    owner.setAttribute(ESC_OWNER_ATTR, '');
    document.body.append(owner);
    shellPosts.length = 0;
    const ev = esc();
    expect(log).toEqual([]);
    expect(canvas.selection).toBe(true);
    expect(ctx?.tool).toBe('comment');
    expect(back()).toEqual([]);
    expect(ev.defaultPrevented).toBe(false); // the owner's own listener closes it
    // the owner closed itself; the canvas's rungs follow, one per press
    owner.remove();
    esc();
    expect(log).toEqual(['tool']);
    expect(back()).toEqual([]);
  });

  test('a focus-scoped owner (a thread popover) owns esc only while focus is inside it', () => {
    const thread = document.createElement('div');
    thread.setAttribute(ESC_OWNER_ATTR, 'focus');
    thread.tabIndex = -1;
    const reply = document.createElement('textarea');
    thread.append(reply);
    document.body.append(thread);
    try {
      expect(escOwnerOpen(document)).toBe(false); // focus is on the body: the press is the canvas's
      reply.focus();
      expect(escOwnerOpen(document)).toBe(true); // focus in the reply: the half-written text is the thread's
      reply.blur();
      expect(escOwnerOpen(document)).toBe(false);
    } finally {
      thread.remove();
    }
  });
});

// ── C · the shell ─────────────────────────────────────────────────────────────────────────────────────

describe('C · the shell’s end of esc', () => {
  const EDIT = capsFor({ canEdit: true });
  const VIEW = capsFor({ canEdit: false, role: 'observer' });
  const base = { mode: 'edit', presenting: false, viewing: null, caps: EDIT };

  test('with the shell focused: Preview → baseMode, Present → returnTo, a held version → now; Edit and Viewing nothing', () => {
    expect(shellEscDecision({ ...base, mode: 'preview' })).toEqual({ kind: 'set', mode: 'edit' });
    expect(shellEscDecision({ ...base, mode: 'preview', caps: VIEW })).toEqual({
      kind: 'set',
      mode: 'viewing',
    });
    expect(shellEscDecision({ ...base, mode: 'present', presenting: true })).toEqual({
      kind: 'exit-present',
    });
    expect(shellEscDecision({ ...base, mode: 'preview', viewing: { at: 'r41' } })).toEqual({
      kind: 'exit-viewing',
    });
    expect(shellEscDecision({ ...base, mode: 'edit' })).toBeNull();
    expect(shellEscDecision({ ...base, mode: 'viewing', caps: VIEW })).toBeNull();
  });

  test('menus, sheets, Search and a text field close/keep first — the mode does not move', () => {
    expect(shellEscDecision({ ...base, mode: 'preview', overlayOpen: true })).toBeNull();
    expect(shellEscDecision({ ...base, mode: 'preview', typing: true })).toBeNull();
    expect(
      shellEscDecision({ ...base, mode: 'present', presenting: true, overlayOpen: true })
    ).toBeNull();
  });

  test('the canvas’s `back` request and the store: one step each, and never out of the project', () => {
    const s = createShellMode(EDIT);
    s.select('preview');
    const ctxOf = (over = {}) => ({
      caps: EDIT,
      presenting: false,
      mode: s.get().mode,
      modalOpen: false,
      viewing: s.get().viewing,
      ...over,
    });
    // Preview → Edit
    expect(decideModeRequest({ mode: 'back' }, ctxOf())).toEqual({ kind: 'set', mode: 'edit' });
    // Edit: nothing to go back to
    s.select('edit');
    expect(decideModeRequest({ mode: 'back' }, ctxOf())).toBeNull();
    // Present · Artboards / Canvas → exit-present → returnTo
    for (const spec of [{ kind: 'artboards', from: 'start' }, { kind: 'canvas' }] as const) {
      s.select('preview');
      s.present(spec);
      expect(decideModeRequest({ mode: 'back' }, ctxOf({ presenting: true }))).toEqual({
        kind: 'exit-present',
      });
      s.back();
      expect(s.get().mode).toBe('preview'); // returnTo, not Edit: one step
    }
    // a viewing role: Preview → Viewing; Present → wherever you came from; Viewing → nowhere
    const v = createShellMode(VIEW);
    v.select('preview');
    expect(
      decideModeRequest({ mode: 'back' }, { ...ctxOf({ caps: VIEW }), mode: 'preview' })
    ).toEqual({
      kind: 'set',
      mode: 'viewing',
    });
    v.select('viewing');
    expect(
      decideModeRequest({ mode: 'back' }, { ...ctxOf({ caps: VIEW }), mode: 'viewing' })
    ).toBeNull();
    // a held past version: esc is "back to now", nothing else moves the mode
    s.select('edit');
    s.view({ path: '.design/a.tsx', at: 'r41', title: 't', when: 'w', who: 'x' });
    expect(decideModeRequest({ mode: 'back' }, ctxOf({ viewing: s.get().viewing }))).toEqual({
      kind: 'exit-viewing',
    });
  });
});
