// S11.2 — the empty canvas and the empty artboard (05 es-canvas-ai · es-canvas-three · es-artboard-new)
// + Phase 4 W7 "no door".
//
// Done when: a new canvas says the CONTRACT line exactly (rule/the-empty-canvas-line) in three variants
// that come from the readiness state (ready · offline · not connected) · Can view / Can comment get no
// create affordance at all · an empty canvas always has a way in that is not the AI (W7) · the AI ask
// pre-fills the composer and never sends · the empty-artboard hint rides the canvas's `artboard-empty` and
// leaves on the first `layers-tree` that has a layer · Layers says "No layers on Tablet yet." · the canvas
// side reports `artboards` + `artboard-empty` from its own DOM.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import { OFFLINE_BACK } from '../client/v2/ai/gate-lines.js';
import { COPY } from '../client/v2/empty/empty-copy.js';
import {
  createAskFlow,
  createEmptyLane,
  emptyCanvasModel,
  fillPrompt,
  hintNext,
  hintPlacement,
  OFFLINE_LINE,
} from '../client/v2/empty/use-empty-canvas.js';
import {
  createEmptyReporter,
  EMPTY_CHROME_SEL,
  measureEmptyArtboard,
} from '../editing/empty-report.ts';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

const STUDIO = join(import.meta.dir, '..');
const REPO = join(STUDIO, '..', '..');
const CONTRACT = readFileSync(join(REPO, '.design/system/maude-v2/CONTRACT.md'), 'utf8');

const base = {
  count: 0,
  mode: 'edit',
  canEdit: true,
  online: true,
  claude: 'present',
  canAsk: true,
};

describe('the empty-canvas model: three variants from the readiness state', () => {
  test('ready: online and connected → the line + Ask AI, nothing else said', () => {
    const m = emptyCanvasModel(base);
    expect(m).toMatchObject({ variant: 'ready', quiet: false, ask: true, offlineLine: null });
  });

  test('offline: the line keeps its first sentence and adds the S5.13 words, the spot goes quiet', () => {
    const m = emptyCanvasModel({ ...base, online: false });
    expect(m).toMatchObject({ variant: 'offline', quiet: true, ask: true });
    expect(m?.offlineLine).toBe('AI is back when this Mac is online.');
    expect(OFFLINE_LINE).toBe(OFFLINE_BACK); // the S5.13 words, not a second copy
    expect(COPY['es-canvas-three.offline'].offline).toBe(OFFLINE_BACK);
  });

  test('not connected: the line never changes (CONTRACT §6) — only the ask knows', () => {
    const m = emptyCanvasModel({ ...base, claude: 'absent' });
    expect(m).toMatchObject({ variant: 'connect', quiet: false, ask: true, offlineLine: null });
  });

  test('an unknown claude state is not nagged about: ready', () => {
    expect(emptyCanvasModel({ ...base, claude: 'unknown' })?.variant).toBe('ready');
  });

  test('hidden for Can view and Can comment: no create affordance at all', () => {
    expect(emptyCanvasModel({ ...base, canEdit: false })).toBeNull();
  });

  test('hidden when the canvas has artboards, has not reported yet, or is not in Edit', () => {
    expect(emptyCanvasModel({ ...base, count: 3 })).toBeNull();
    expect(emptyCanvasModel({ ...base, count: null })).toBeNull();
    expect(emptyCanvasModel({ ...base, count: undefined })).toBeNull();
    expect(emptyCanvasModel({ ...base, mode: 'present' })).toBeNull();
    expect(emptyCanvasModel({ ...base, mode: 'preview' })).toBeNull();
  });

  test('W7: with no AI here (cloud tab, browser) the canvas still offers a way in', () => {
    const m = emptyCanvasModel({ ...base, canAsk: false });
    expect(m?.ask).toBe(false);
    expect(m?.door).toBe(true);
    expect(emptyCanvasModel(base)?.door).toBe(true); // and beside Ask AI as well
  });
});

describe('Ask AI: opens the chat, pre-fills, never sends; the connect sheet waits for a send', () => {
  const make = () => {
    const calls: string[] = [];
    const flow = createAskFlow({
      openChat: () => calls.push('chat'),
      prefill: (t: string) => calls.push(`fill:${t}`),
      openConnect: () => calls.push('connect'),
    });
    return { calls, flow };
  };

  test('connected: opens the chat; with words it pre-fills them', () => {
    const { calls, flow } = make();
    flow.ask({ variant: 'ready' });
    flow.ask({ variant: 'ready' }, 'Fill Tablet starting from Desktop.');
    expect(calls).toEqual(['chat', 'chat', 'fill:Fill Tablet starting from Desktop.']);
  });

  // A6c (decision v2-lead-connect-sheet-on-first-send, CONTRACT §6): Ask AI opens and pre-fills the
  // chat even when no Claude account is connected — the connect sheet comes on the first SEND, in the chat.
  test('not connected: Ask AI opens the chat and pre-fills, every time — no sheet on the press', () => {
    const { calls, flow } = make();
    expect(flow.ask({ variant: 'connect' })).toBe('chat');
    expect(flow.ask({ variant: 'connect' }, 'Fill Tablet.')).toBe('chat');
    expect(calls).toEqual(['chat', 'chat', 'fill:Fill Tablet.']);
  });

  test('offline: still opens the chat (Ask AI always works; the prompt waits in line)', () => {
    const { calls, flow } = make();
    flow.ask({ variant: 'offline' });
    expect(calls).toEqual(['chat']);
  });

  test('the pre-fill goes through the ⌘K channel and carries no `send` — the person presses ↵', async () => {
    const { sendToAskAI, ASK_AI_EVENT } = await import('../client/v2/search/search-env.js');
    const seen: unknown[] = [];
    const target = new EventTarget();
    target.addEventListener(ASK_AI_EVENT, (e) => seen.push((e as CustomEvent).detail));
    sendToAskAI(fillPrompt({ label: 'Tablet', from: 'Desktop' }), target);
    expect(seen).toEqual([{ text: 'Fill Tablet starting from Desktop.' }]);
    expect((seen[0] as { send?: boolean }).send).toBeUndefined();
  });

  test('fillPrompt without a source artboard still names the board', () => {
    expect(fillPrompt({ label: 'Tablet' })).toBe('Fill Tablet.');
  });
});

describe("the words are the CONTRACT's", () => {
  test('rule/the-empty-canvas-line: the copy table says it exactly', () => {
    const line = CONTRACT.split('\n').find((l) => l.includes('**Empty canvas line:**')) ?? '';
    const quoted = line.match(/"([^"]+)"/)?.[1] ?? '';
    expect(quoted).toBe('Your canvas is ready. Ask AI for a first draft, or start drawing.');
    const c = COPY['es-canvas-ai.canvas-ready'];
    expect(`${c.title} ${c.next}`).toBe(quoted);
  });

  test('the artboard hint ends in one sentence when there is no other board to start from', () => {
    expect(hintNext('Desktop')).toBe(
      'Draw a frame with [[F]], place an image [[I]] or a component [[⇧I]], or let AI start it from Desktop.'
    );
    expect(hintNext(undefined)).toBe(
      'Draw a frame with [[F]], place an image [[I]] or a component [[⇧I]].'
    );
  });
});

describe('the lane: counts, the hint, and when it leaves', () => {
  const ORIGIN = 'http://127.0.0.1:9';
  const win = {} as Window;
  const lane = () =>
    createEmptyLane({
      canvasOrigin: () => ORIGIN,
      activePath: () => '.design/ui/Home.tsx',
      frameOf: () => ({ contentWindow: win }),
    });
  const msg = (data: Record<string, unknown>, source: unknown = win, origin = ORIGIN) =>
    ({ origin, source, data }) as unknown as MessageEvent;

  test('`artboards {count}` from the active canvas sets what the shell knows; a stranger is ignored', () => {
    const l = lane();
    expect(l.get().count).toBeNull();
    l.onMessage(msg({ dgn: 'artboards', count: 0 }));
    expect(l.get().count).toBe(0);
    l.onMessage(msg({ dgn: 'artboards', count: 4 }, {} as Window)); // not the active window
    l.onMessage(msg({ dgn: 'artboards', count: 4 }, win, 'http://evil.test'));
    expect(l.get().count).toBe(0);
    l.onMessage(msg({ dgn: 'artboards', count: 2 }));
    expect(l.get().count).toBe(2);
  });

  test('`artboard-empty` with a rect shows the hint; rect null clears it', () => {
    const l = lane();
    const rect = { x: 40, y: 60, w: 200, h: 300 };
    l.onMessage(
      msg({ dgn: 'artboard-empty', artboardId: 'tab', rect, label: 'Tablet', from: 'Desktop' })
    );
    expect(l.get().hint).toMatchObject({
      artboardId: 'tab',
      label: 'Tablet',
      from: 'Desktop',
      rect,
    });
    l.onMessage(msg({ dgn: 'artboard-empty', artboardId: 'tab', rect: null }));
    expect(l.get().hint).toBeNull();
  });

  test('the hint leaves on the first `layers` change that has a layer — and not before', () => {
    const l = lane();
    const rect = { x: 0, y: 0, w: 100, h: 100 };
    l.onMessage(msg({ dgn: 'artboard-empty', artboardId: 'tab', rect, label: 'Tablet' }));
    l.onMessage(msg({ dgn: 'layers-tree', artboardId: 'other', tree: [{ id: 'a' }] }));
    expect(l.get().hint).not.toBeNull(); // another board's layers
    l.onMessage(msg({ dgn: 'layers-tree', artboardId: 'tab', tree: [] }));
    expect(l.get().hint).not.toBeNull(); // still no layer
    l.onMessage(msg({ dgn: 'layers-tree', artboardId: 'tab', tree: [{ id: 'a' }] }));
    expect(l.get().hint).toBeNull(); // drawn on: gone
  });

  test('a hostile payload is refused by the table (no rect, huge label)', () => {
    const l = lane();
    l.onMessage(msg({ dgn: 'artboard-empty', artboardId: 'tab', rect: 'x' }));
    l.onMessage(
      msg({ dgn: 'artboard-empty', artboardId: 'tab', rect: null, label: 'x'.repeat(9000) })
    );
    expect(l.get().hint).toBeNull();
  });

  test('a canvas that closed is forgotten', () => {
    const l = lane();
    l.onMessage(msg({ dgn: 'artboards', count: 0 }));
    l.forget('.design/ui/Home.tsx');
    expect(l.get().count).toBeNull();
  });

  test('hintPlacement: centred on the artboard, kept inside the window', () => {
    const frame = { left: 100, top: 50 };
    const at = hintPlacement(
      frame,
      { x: 40, y: 60, w: 200, h: 300 },
      { w: 1200, h: 800 },
      { w: 320, h: 150 }
    );
    expect(at).toEqual({ left: 100 + 40 + 100 - 160, top: 50 + 60 + 150 - 75 });
    const off = hintPlacement(
      frame,
      { x: -500, y: -500, w: 10, h: 10 },
      { w: 1200, h: 800 },
      { w: 320, h: 150 }
    );
    expect(off.left).toBeGreaterThanOrEqual(8);
    expect(off.top).toBeGreaterThanOrEqual(8);
  });
});

describe('the canvas side reports from its own DOM', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });
  const board = (id: string, label: string, inner = '') =>
    `<article data-dc-screen="${id}"><header class="dc-artboard-label">${label}</header><div class="dc-artboard-body">${inner}</div></article>`;

  test('an artboard with nothing in it is empty; chrome inside it does not count', () => {
    document.body.innerHTML =
      board('a', 'Desktop', '<div data-cd-id="x">hi</div>') +
      board('b', 'Tablet', '<div class="dgn-pin"></div>') +
      board('c', 'Mobile', '');
    expect(measureEmptyArtboard(document, 'a')).toBeNull();
    expect(measureEmptyArtboard(document, 'b')?.label).toBe('Tablet');
    expect(measureEmptyArtboard(document, 'c')?.label).toBe('Mobile');
    expect(measureEmptyArtboard(document, 'nope')).toBeNull();
    expect(EMPTY_CHROME_SEL).toContain('.dgn-pin');
  });

  test('"from" is the first OTHER board that has something on it', () => {
    document.body.innerHTML =
      board('b', 'Tablet', '') + board('a', 'Desktop', '<p data-cd-id="x">hi</p>');
    expect(measureEmptyArtboard(document, 'b')?.from).toBe('Desktop');
    document.body.innerHTML = board('b', 'Tablet', '');
    expect(measureEmptyArtboard(document, 'b')?.from).toBeUndefined();
  });

  test('the reporter posts the count and the empty selection once per change, one frame at a time', () => {
    document.body.innerHTML =
      board('a', 'Desktop', '<p data-cd-id="x">hi</p>') + board('b', 'Tablet', '');
    const posts: Array<Record<string, unknown>> = [];
    const frames: Array<() => void> = [];
    let selected: string | null = 'b';
    const r = createEmptyReporter({
      doc: document,
      selectedArtboard: () => selected,
      post: (m: Record<string, unknown>) => posts.push(m),
      raf: (fn: () => void) => frames.push(fn),
    });
    r.request();
    r.request(); // coalesced
    expect(frames.length).toBe(1);
    frames.shift()?.();
    expect(posts.map((m) => m.dgn)).toEqual(['artboards', 'artboard-empty']);
    expect(posts[0]).toEqual({ dgn: 'artboards', count: 2 });
    expect(posts[1]).toMatchObject({
      dgn: 'artboard-empty',
      artboardId: 'b',
      label: 'Tablet',
      from: 'Desktop',
    });
    r.request();
    frames.shift()?.();
    expect(posts.length).toBe(2); // nothing changed, nothing sent
    // the artboard gets its first layer
    document.querySelector('[data-dc-screen="b"] .dc-artboard-body')!.innerHTML =
      '<div data-cd-id="y"></div>';
    r.request();
    frames.shift()?.();
    expect(posts[2]).toEqual({ dgn: 'artboard-empty', artboardId: 'b', rect: null });
    // and nothing selected says null once
    selected = null;
    document.querySelector('[data-dc-screen="b"] .dc-artboard-body')!.innerHTML = '';
    r.request();
    frames.shift()?.();
    expect(posts.length).toBe(3);
  });
});

describe('the protocol rows', () => {
  test('artboard-empty is accepted whole and refused malformed; artboards is live', () => {
    const row = (
      DGN_TABLE.c2s as Record<
        string,
        { parse: (v: unknown) => unknown; status: string; orphan?: string }
      >
    )['artboard-empty'];
    expect(row).toBeDefined();
    expect(
      row.parse({ artboardId: 'a', rect: { x: 1, y: 2, w: 3, h: 4 }, label: 'T', from: 'D' })
    ).toBeTruthy();
    expect(row.parse({ artboardId: 'a', rect: null })).toBeTruthy();
    expect(row.parse({ artboardId: 'a', rect: { x: 1 } })).toBeNull();
    const ab = (DGN_TABLE.c2s as Record<string, { status: string; orphan?: string }>).artboards;
    expect(ab.orphan).toBeUndefined();
    expect(ab.status).toBe('live');
  });
});
