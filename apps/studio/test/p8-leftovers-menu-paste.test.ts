// p8-sweep-leftovers item 8: Menu › Edit › Paste into the canvas.
//
// The menu's Paste posted `run-action edit.paste` and the FRAME read the clipboard — blocked by the iframe's
// permissions policy (`allow="clipboard-write"` only): "The Clipboard API has been blocked…", nothing pasted.
// The canvas origin is untrusted (DDR-054) and does NOT get `clipboard-read`. The shell reads the clipboard on the
// pick and forwards a bounded, typed `paste-data` message; the frame replays it as the paste event ⌘V raises.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const STUDIO = join(import.meta.dir, '..');
type Mod = typeof import('../bridge/paste-data.ts');
let pd: Mod;
let dgn: typeof import('../bridge/dgn-protocol.ts');
let runner: typeof import('../client/v2/shell/menu-runner.js');
let fwd: typeof import('../client/v2/shell/paste-forward.js');

beforeAll(async () => {
  GlobalRegistrator.register();
  pd = await import('../bridge/paste-data.ts');
  dgn = await import('../bridge/dgn-protocol.ts');
  runner = await import('../client/v2/shell/menu-runner.js');
  fwd = await import('../client/v2/shell/paste-forward.js');
});
afterAll(() => GlobalRegistrator.unregister());

const png = (n = 8) => new Blob([new Uint8Array(n)], { type: 'image/png' });
const iframe = () => {
  const f = document.createElement('iframe');
  document.body.append(f);
  return f;
};

describe('the shell forwards the clipboard', () => {
  test('menu Paste on the canvas posts paste-data, never the frame-side clipboard read', async () => {
    const posts: unknown[] = [];
    await runner.cutCopyPaste('paste', iframe(), {
      postToActiveCanvas: (m: unknown) => posts.push(m),
      readClipboard: async () => ({ v: 1, text: 'hello' }),
    });
    expect(posts).toEqual([{ dgn: 'paste-data', v: 1, text: 'hello' }]);
  });

  test('an empty or refused clipboard falls back to the canvas lane (the shell-held object clipboard)', async () => {
    const posts: unknown[] = [];
    await runner.cutCopyPaste('paste', iframe(), {
      postToActiveCanvas: (m: unknown) => posts.push(m),
      readClipboard: async () => null,
    });
    await runner.cutCopyPaste('paste', iframe(), {
      postToActiveCanvas: (m: unknown) => posts.push(m),
      readClipboard: async () => {
        throw new Error('denied');
      },
    });
    // `canvas.paste` reads no system clipboard; no paste-data crosses
    expect(posts).toEqual([
      { dgn: 'run-action', v: 1, id: 'edit.paste' },
      { dgn: 'run-action', v: 1, id: 'edit.paste' },
    ]);
  });

  test('the reader keeps text, html and one allowlisted picture; drops oversize and other types', async () => {
    const item = (types: Record<string, Blob>) => ({
      types: Object.keys(types),
      getType: async (t: string) => types[t],
    });
    const big = 'x'.repeat(pd.PASTE_TEXT_MAX + 1);
    const read = await fwd.readPasteData({
      read: async () => [
        item({
          'text/plain': new Blob([big]),
          'image/svg+xml': new Blob(['<svg/>'], { type: 'image/svg+xml' }),
        }),
        item({ 'text/html': new Blob(['<b>x</b>']), 'image/png': png() }),
      ],
    } as any);
    expect(read?.v).toBe(1);
    expect(read?.text).toBeUndefined();
    expect(read?.html).toBe('<b>x</b>');
    expect(read?.image?.type).toBe('image/png');
    const textOnly = await fwd.readPasteData({ readText: async () => 'plain' } as any);
    expect(textOnly).toEqual({ v: 1, text: 'plain' });
  });
});

describe('the frame validates what crosses', () => {
  test('a well-formed payload passes the table', () => {
    const spec = dgn.s2cSpec('paste-data');
    expect(spec?.gate).toBe('parent');
    expect(spec?.parse({ dgn: 'paste-data', v: 1, text: 'a', html: '<i>a</i>' } as any)).toEqual({
      v: 1,
      text: 'a',
      html: '<i>a</i>',
    });
    expect(pd.parsePasteData({ dgn: 'paste-data', v: 1, image: png() })?.image?.size).toBe(8);
  });

  test('malformed or oversized payloads are refused whole', () => {
    const bad = [
      null,
      'text',
      { v: 1 },
      { v: 2, text: 'a' },
      { v: 1, text: 42 },
      { v: 1, text: 'a', extra: 1 },
      { v: 1, text: 'x'.repeat(pd.PASTE_TEXT_MAX + 1) },
      { v: 1, html: 'x'.repeat(pd.PASTE_TEXT_MAX + 1) },
      { v: 1, image: new Blob(['<svg/>'], { type: 'image/svg+xml' }) },
      { v: 1, image: new Blob([], { type: 'image/png' }) },
      { v: 1, image: { size: 1, type: 'image/png' } },
      { v: 1, image: new Blob([new Uint8Array(pd.PASTE_IMAGE_MAX + 1)], { type: 'image/png' }) },
    ];
    for (const b of bad) {
      expect(pd.parsePasteData(b)).toBeNull();
      if (b && typeof b === 'object') expect(dgn.s2cSpec('paste-data')?.parse(b as any)).toBeNull();
    }
  });

  test('only the shell may send it', () => {
    const win = { parent: { id: 'shell' } } as unknown as Window;
    const msg = { dgn: 'paste-data', v: 1, text: 'a' };
    const fromSibling = { data: msg, source: { id: 'sibling' } } as unknown as MessageEvent;
    const fromShell = { data: msg, source: win.parent } as unknown as MessageEvent;
    expect(dgn.acceptFromShell(fromSibling, win)).toBeNull();
    expect(dgn.acceptFromShell(fromShell, win)).toEqual({
      dgn: 'paste-data',
      v: 1,
      text: 'a',
    } as any);
  });

  test('replayed as the ⌘V paste event (the same listeners), and a text field gets the text', () => {
    const seen: string[] = [];
    const on = (e: Event) =>
      seen.push((e as ClipboardEvent).clipboardData?.getData('text/plain') ?? '');
    document.addEventListener('paste', on);
    (document.activeElement as HTMLElement | null)?.blur?.();
    expect(pd.dispatchPasteData({ v: 1, text: 'from the menu' }, document)).toBe('dispatched');
    document.removeEventListener('paste', on);
    expect(seen).toEqual(['from the menu']);

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    let inserted: unknown[] | null = null;
    (document as any).execCommand = (...a: unknown[]) => {
      inserted = a;
      return true;
    };
    expect(pd.dispatchPasteData({ v: 1, text: 'typed' }, document)).toBe('inserted');
    expect(inserted).toEqual(['insertText', false, 'typed']);
  });

  test('the canvas handles paste-data from the shell only, and the iframe gains no clipboard-read', () => {
    const shell = readFileSync(join(STUDIO, 'canvas-shell.tsx'), 'utf8');
    const at = shell.indexOf("m.dgn === 'paste-data'");
    expect(at).toBeGreaterThan(0);
    expect(shell.slice(at, at + 200)).toContain('e.source !== window.parent');
    for (const f of ['client/shell/viewport.jsx', 'client/embed-view.jsx']) {
      const src = readFileSync(join(STUDIO, f), 'utf8');
      expect(src).not.toContain('clipboard-read');
      expect(src).toContain("allow: 'clipboard-write'");
    }
  });
});
