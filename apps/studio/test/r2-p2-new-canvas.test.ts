// R2-P2 (TD2) — New canvas opens an empty "Untitled canvas" with the size picker up; the brief canvas keeps its own
// door and speaks the app's voice (CONTRACT §3/§4: canvas not board, no slash command, no "Claude").
import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { takeNameDialogRequest } from '../client/v2/create/name-dialog-bus.js';
import { createBlankCanvas, openBriefBoardComposer } from '../client/v2/create/new-canvas.js';
import {
  clearSizePickerRequest,
  OPEN_SIZES_TTL_MS,
  requestSizePicker,
  takeSizePicker,
} from '../client/v2/create/open-sizes.js';
import { takeCanvasesOps } from '../client/v2/left-panel/left-panel-bus.js';
import { createMenuHandlers } from '../client/v2/shell/menu-runner.js';

const ROOT = join(import.meta.dir, '..', '..', '..');
const none = null as unknown as Window;

afterEach(() => {
  clearSizePickerRequest();
  takeCanvasesOps();
  takeNameDialogRequest();
});

describe('the size-picker request (open-sizes.js)', () => {
  test('it waits for its canvas: another open canvas takes nothing, its own takes it once', () => {
    requestSizePicker('ui/Untitled canvas.tsx', none, 1000);
    expect(takeSizePicker('ui/Pricing.tsx', 1100)).toBeNull();
    expect(takeSizePicker('ui/Untitled canvas.tsx', 1200)).toBe('ui/Untitled canvas.tsx');
    expect(takeSizePicker('ui/Untitled canvas.tsx', 1300)).toBeNull();
  });
  test('moved into a folder meanwhile: the same file name is the match, and the answer is where it now is', () => {
    requestSizePicker('ui/Untitled canvas.tsx', none, 1000);
    expect(takeSizePicker('ui/2027/Untitled canvas.tsx', 1100)).toBe('ui/2027/Untitled canvas.tsx');
  });
  test('a canvas that never opens does not pop the picker up later', () => {
    requestSizePicker('ui/Untitled canvas.tsx', none, 1000);
    expect(takeSizePicker('ui/Untitled canvas.tsx', 1000 + OPEN_SIZES_TTL_MS + 1)).toBeNull();
  });
  test('the shell host takes it when the open canvas matches', () => {
    const host = readFileSync(join(ROOT, 'apps/studio/client/v2/kinds/SizePickerHost.jsx'), 'utf8');
    expect(host).toContain('takeSizePicker(live.current.activePath)');
    expect(host).toContain('onOpen?.({ canvas, anchor: null })');
    const app = readFileSync(join(ROOT, 'apps/studio/client/app.jsx'), 'utf8');
    expect(app).toContain('<SizePickerHost req={sizesReq} onOpen={setSizesReq}');
  });
});

describe('createBlankCanvas — name and size picker', () => {
  const answer = (file: string) =>
    (async () => ({ ok: true, status: 201, json: async () => ({ ok: true, file }) })) as never;
  test('a committed name rides in the body: the file is written once, under its final name', async () => {
    let body = '';
    const r = await createBlankCanvas({
      fetchImpl: (async (_u: string, init: RequestInit) => {
        body = String(init.body);
        return { ok: true, status: 201, json: async () => ({ ok: true, file: 'ui/Poster.tsx' }) };
      }) as never,
      open: () => {},
      name: 'Poster',
    });
    expect(r.ok).toBe(true);
    expect(JSON.parse(body)).toEqual({ kind: 'blank', name: 'Poster' });
  });
  test('sizes: true asks for the size picker on what the server made, after it is opened', async () => {
    const order: string[] = [];
    await createBlankCanvas({
      fetchImpl: answer('ui/Untitled canvas.tsx'),
      open: () => order.push('open'),
      sizes: true,
    });
    order.push(`picker:${takeSizePicker('ui/Untitled canvas.tsx')}`);
    expect(order).toEqual(['open', 'picker:ui/Untitled canvas.tsx']);
  });
  test('without sizes (a first draft from a sentence, an intent) no picker is asked for', async () => {
    await createBlankCanvas({ fetchImpl: answer('ui/Poster.tsx'), open: () => {} });
    expect(takeSizePicker('ui/Poster.tsx')).toBeNull();
  });
  test('a failed create asks for no picker', async () => {
    await createBlankCanvas({
      fetchImpl: (async () => ({ ok: false, status: 500, json: async () => ({}) })) as never,
      open: () => {},
      sizes: true,
    });
    expect(takeSizePicker('ui/Untitled canvas.tsx')).toBeNull();
  });
  // R3 (6): the person's own doors (menu, ⌘N, ⌘K) ask for the name first; the dialog's Create is what calls
  // createBlankCanvas({ sizes: true }), so the picker still comes up on the new canvas (NameDialogHost).
  test('the menu row (and so ⌘N and ⌘K, same function) asks for the name in a dialog, writing nothing yet', () => {
    const real = globalThis.fetch;
    let posts = 0;
    globalThis.fetch = (async () => {
      posts++;
      return { ok: true, status: 201, json: async () => ({ ok: true, file: 'x.tsx' }) };
    }) as never;
    try {
      const h = createMenuHandlers({ openPanelExclusive: () => {}, toast: () => {} } as never);
      h['canvas.new']();
      expect(takeNameDialogRequest()).toEqual({ kind: 'canvas' });
      expect(posts).toBe(0);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe('the brief canvas keeps a door of its own', () => {
  test('⌘K "New brief canvas" opens the name dialog at once; it does not open the left panel or queue a panel op', () => {
    const panels: string[] = [];
    openBriefBoardComposer({ openPanelExclusive: (id: string) => panels.push(id) });
    expect(panels).toEqual([]);
    expect(takeCanvasesOps()).toEqual([]);
    expect(takeNameDialogRequest()).toEqual({ kind: 'brief' });
  });
  test('the action is labelled "New brief canvas"', () => {
    const defs = readFileSync(join(ROOT, 'apps/studio/actions/defs/canvas.ts'), 'utf8');
    expect(defs).toMatch(/id: 'canvas\.new-brief',\s+label: 'New brief canvas'/);
  });
});

describe('the brief canvas speaks the app’s voice (CONTRACT §3 · §4)', () => {
  const template = readFileSync(
    join(ROOT, 'plugins/design/templates/brief-board.tsx.template'),
    'utf8'
  );
  // the words a person reads: the JSX of the artboard, not the header comment for the agent
  // (the section id `brief-board` is an identifier, not copy)
  const shown = template
    .slice(template.indexOf('export default function'))
    .replace('id="brief-board"', '');
  test('the artboard names no command, no "Claude", no "board", no key letters', () => {
    expect(shown).not.toMatch(/\/design:|Claude|\bboards?\b|\(N\)|\(T\)|\(A\)|annotate me/i);
  });
  test('it says what to do and where AI comes in', () => {
    expect(shown).toContain('Add sticky notes, text and arrows here');
    expect(shown).toContain('ask AI for a first draft');
  });
  test('the server seeds the same words: brief canvas, never brief board', () => {
    const api = readFileSync(join(ROOT, 'apps/studio/api.ts'), 'utf8');
    expect(api).toContain("seedHint: 'Empty brief canvas'");
    expect(api).toContain("subtitle: 'brief canvas'");
    expect(api).not.toContain('annotate me');
  });
});
