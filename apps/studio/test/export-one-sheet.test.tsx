// V2-2.8 — ⇧⌘E means ONE thing (decision:maude/v2-2.8-shift-cmd-e-one-sheet, Gate 0 D3; V2-1.3
// contract §2 defect 2).
//
// v1 ran two handlers on one press: with canvas focus the canvas forwarded ⇧⌘E and the shell opened
// its Export sheet, AND the iframe's own export dialog ran `rerunLast()`, which silently re-submitted
// the last export. v2: ⇧⌘E opens the shell's Export sheet and nothing else; "Export again" moved
// onto the sheet's Recent rows (export-one-sheet-again.test.tsx covers the button).
//
// Two halves, both fail-first against v1:
//   · the registry: no canvas-exec action binds ⇧⌘E any more, `export.rerun-last` is a keyless
//     shell action, and the generated canvas keymap agrees;
//   · the iframe's real ExportDialogProvider (happy-dom + React): once it has loaded a history
//     entry, ⇧⌘E on the document submits no export job and opens nothing.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { bindingInDocument } from '../actions/documents.ts';
import { ACTIONS, ACTIONS_BY_ID } from '../actions/index.ts';
import { CANVAS_KEYMAP } from '../actions/keymap.gen.ts';

const SHIFT_CMD_E = '⇧⌘E';

describe('registry: ⇧⌘E has one owner', () => {
  test('no action runs in the canvas document on ⇧⌘E — the shell sheet is the only owner', () => {
    const bound = ACTIONS.filter((a) => (a.keys ?? []).some((b) => b.chord === SHIFT_CMD_E));
    expect(bound.map((a) => `${a.id}:${a.exec}`)).toEqual(['export.open:shell']);
    // The canvas only FORWARDS the chord (fromCanvas): no canvas-exec action resolves it locally.
    const canvasLocal = ACTIONS.filter(
      (a) =>
        a.exec === 'canvas' &&
        (a.keys ?? []).some((b) => b.chord === SHIFT_CMD_E && bindingInDocument(b, 'canvas'))
    );
    expect(canvasLocal.map((a) => a.id)).toEqual([]);
  });

  test('the generated canvas keymap only FORWARDS ⇧⌘E (export.open), it runs nothing locally', () => {
    const rows = CANVAS_KEYMAP.filter((a) => a.keys.some((b) => b.chord === SHIFT_CMD_E));
    expect(rows.map((a) => `${a.id}:${a.exec}`)).toEqual(['export.open:shell']);
  });

  test('export.rerun-last is a keyless shell action (its home is the sheet’s Recent rows)', () => {
    const a = ACTIONS_BY_ID.get('export.rerun-last');
    expect(a?.label).toBe('Export again');
    expect(a?.exec).toBe('shell');
    expect(a?.keys ?? []).toEqual([]);
  });

  test('⌘E (the in-canvas export dialog) is untouched by this decision', () => {
    const a = ACTIONS_BY_ID.get('export.canvas-dialog');
    expect(a?.exec).toBe('canvas');
    expect((a?.keys ?? []).map((b) => b.chord)).toEqual(['⌘E']);
  });
});

// ── the iframe's export dialog ────────────────────────────────────────────────────────────────
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const ENTRY = {
  format: 'png',
  scope: 'artboard',
  options: { scale: 2 },
  filename: 'home.png',
  at: '2026-10-10T10:00:00.000Z',
};

interface Call {
  method: string;
  url: string;
  body?: unknown;
}
let calls: Call[] = [];
const realFetch = globalThis.fetch;
function stubFetch() {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/_api/export-history')) return json({ history: [ENTRY] });
    if (url.endsWith('/_api/export-jobs')) return json({ ok: true, id: 'job-1' });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  globalThis.fetch = realFetch;
});

const tick = () => new Promise((r) => setTimeout(r, 20));

async function mountDialog() {
  const { ExportDialogProvider, useExportDialog } = await import('../export-dialog.tsx');
  let handle: ReturnType<typeof useExportDialog> = null;
  function Probe() {
    handle = useExportDialog();
    return null;
  }
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <ExportDialogProvider>
        <Probe />
      </ExportDialogProvider>
    );
  });
  return () => handle;
}

function press(init: KeyboardEventInit) {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  );
}

describe('the iframe export dialog on ⇧⌘E', () => {
  test('submits no export job and opens nothing, even with a history entry already loaded', async () => {
    stubFetch();
    const handle = await mountDialog();
    // Load a history entry the way a real session does: the dialog is opened once (⌘E / toolbar),
    // then closed — v1's rerunLast() re-submitted history[0] from that state.
    await act(async () => {
      handle()?.open();
      await tick();
    });
    await act(async () => {
      handle()?.close();
      await tick();
    });
    expect(calls.some((c) => c.url.endsWith('/_api/export-history'))).toBe(true);
    calls.length = 0;

    await act(async () => {
      press({ key: 'E', code: 'KeyE', metaKey: true, shiftKey: true });
      await tick();
    });

    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
    // nor does the press fetch anything on the iframe's behalf (v1 re-read the history first)
    expect(calls).toEqual([]);
    const dlg = document.querySelector('dialog.dc-export-dialog') as HTMLDialogElement | null;
    expect(dlg?.hasAttribute('open') ?? false).toBe(false);
  });

  test('⌘E still opens the in-canvas dialog (not part of this decision)', async () => {
    stubFetch();
    await mountDialog();
    await act(async () => {
      press({ key: 'e', code: 'KeyE', metaKey: true });
      await tick();
    });
    expect(calls.some((c) => c.url.endsWith('/_api/export-history'))).toBe(true);
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });
});
