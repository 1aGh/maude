// S6.1 — ⌘N makes a blank canvas and opens it: one POST, no tree composer. The key, the menu row and the
// ⌘K row all land on the same function; the brief board keeps `canvas.new-brief`.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SHELL_KEY_HANDLERS } from '../client/actions/shell-key-handlers.js';
import { createBlankCanvas, NEW_CANVAS_FAILED } from '../client/v2/create/new-canvas.js';
import { CANVAS_OP_EVENT } from '../client/v2/left-panel/left-panel-bus.js';
import { createMenuHandlers } from '../client/v2/shell/menu-runner.js';

type Call = { url: string; init: RequestInit };

function fakeFetch(answer: { ok: boolean; status?: number; json: unknown } | 'throw') {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (answer === 'throw') throw new Error('offline');
    return {
      ok: answer.ok,
      status: answer.status ?? (answer.ok ? 201 : 500),
      json: async () => answer.json,
    };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('createBlankCanvas', () => {
  test('POSTs a blank canvas with no name and opens what the server made', async () => {
    const { fn, calls } = fakeFetch({
      ok: true,
      json: { ok: true, file: '.design/ui/Untitled canvas.tsx' },
    });
    const opened: string[] = [];
    const r = await createBlankCanvas({ fetchImpl: fn, open: (f: string) => opened.push(f) });
    expect(r).toEqual({ ok: true, file: '.design/ui/Untitled canvas.tsx' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/_api/canvas');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ kind: 'blank' });
    expect(opened).toEqual(['.design/ui/Untitled canvas.tsx']);
  });

  test('a sentence rides along as fromPrompt, never as a name', async () => {
    const { fn, calls } = fakeFetch({
      ok: true,
      json: { ok: true, file: '.design/ui/Poster.tsx' },
    });
    await createBlankCanvas({
      fetchImpl: fn,
      open: () => {},
      fromPrompt: 'A poster for my open studio',
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      kind: 'blank',
      fromPrompt: 'A poster for my open studio',
    });
  });

  test('a refused create says one safe line and opens nothing', async () => {
    const { fn } = fakeFetch({ ok: false, status: 403, json: { ok: false, error: 'read only' } });
    const toasts: string[] = [];
    const opened: string[] = [];
    const r = await createBlankCanvas({
      fetchImpl: fn,
      open: (f: string) => opened.push(f),
      toast: (m: string) => toasts.push(m),
    });
    expect(r.ok).toBe(false);
    expect(opened).toEqual([]);
    expect(toasts).toEqual([NEW_CANVAS_FAILED]);
  });

  test('a network failure is the same line, not an exception', async () => {
    const { fn } = fakeFetch('throw');
    const toasts: string[] = [];
    const r = await createBlankCanvas({
      fetchImpl: fn,
      open: () => {},
      toast: (m: string) => toasts.push(m),
    });
    expect(r).toEqual({ ok: false, error: 'offline' });
    expect(toasts).toEqual([NEW_CANVAS_FAILED]);
  });

  test('the failure line follows the voice rules (what · what is safe · one verb; no exclamation)', () => {
    expect(NEW_CANVAS_FAILED).not.toMatch(/!|oops|we |\bI\b/i);
    expect(NEW_CANVAS_FAILED).toContain('Nothing was changed');
    expect(NEW_CANVAS_FAILED).toMatch(/Try again\.$/);
  });
});

describe('the three doors onto canvas.new', () => {
  const realFetch = globalThis.fetch;
  const realWindow = (globalThis as { window?: unknown }).window;
  let target: EventTarget;
  let calls: Call[];
  beforeEach(() => {
    target = new EventTarget();
    (globalThis as { window?: unknown }).window = target;
    const f = fakeFetch({ ok: true, json: { ok: true, file: '.design/ui/Untitled canvas.tsx' } });
    calls = f.calls;
    globalThis.fetch = f.fn;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    (globalThis as { window?: unknown }).window = realWindow;
  });

  function opens(): Promise<string> {
    return new Promise((resolve) => {
      target.addEventListener(CANVAS_OP_EVENT, (e) => {
        const d = (e as CustomEvent).detail;
        resolve(`${d.op}:${d.path}`);
      });
    });
  }

  test('the menu row creates a blank canvas and the shell is told to open it', async () => {
    const h = createMenuHandlers({ openPanelExclusive: () => {}, toast: () => {} } as never);
    const got = opens();
    h['canvas.new']();
    expect(await got).toBe('open:.design/ui/Untitled canvas.tsx');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ kind: 'blank' });
  });

  test('the ⌘N key does the same, and does not open the tree composer', async () => {
    const panels: string[] = [];
    const got = opens();
    let prevented = false;
    SHELL_KEY_HANDLERS['canvas.new'](
      { openPanelExclusive: (id: string) => panels.push(id) },
      {
        event: {
          preventDefault: () => {
            prevented = true;
          },
        },
      }
    );
    expect(await got).toBe('open:.design/ui/Untitled canvas.tsx');
    expect(prevented).toBe(true);
    expect(panels).toEqual([]);
  });

  test('canvas.new-brief is the brief board: it brings up the tree composer and makes nothing', () => {
    const panels: string[] = [];
    const h = createMenuHandlers({
      openPanelExclusive: (id: string) => panels.push(id),
      toast: () => {},
    } as never);
    h['canvas.new-brief']();
    expect(panels).toEqual(['tree']);
    expect(calls).toHaveLength(0);
  });

  test('the ⌘K row runs the same function (no second copy of the composer click for canvas.new)', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'client', 'hooks', 'use-palette-and-panels.jsx'),
      'utf8'
    );
    const row = /'canvas\.new': \(\) => \{[\s\S]*?\n {6}\},/.exec(src)?.[0] ?? '';
    expect(row).toContain('createBlankCanvas');
    expect(row).not.toContain('New blank brief board');
  });
});
