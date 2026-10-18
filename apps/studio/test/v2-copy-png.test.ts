// S8.8 — Copy as PNG (⇧⌘C): what it copies, the render through the export, and the clipboard hand-off
// (client/v2/export/copy-png.js; the desktop fallback is S8.23's native-save.js). Everything that touches the
// world is injected — no server, clipboard or clock.
import { describe, expect, test } from 'bun:test';

import {
  bindCopyPng,
  COPY_WORDS,
  copiedWords,
  copyAsPng,
  copyTarget,
  runCopyPng,
} from '../client/v2/export/copy-png.js';
import {
  buildSpec,
  initialState,
  openExport,
  registerExportOpener,
} from '../client/v2/export/use-export-spec.js';

const FILE = '.design/ui/Post.tsx';
const ARTBOARD = { artboardId: 'post', selector: '[data-dc-screen="post"]', attrs: {}, file: FILE };
const BTN = {
  id: 'cta',
  tag: 'button',
  text: 'Book a call',
  file: FILE,
  artboardId: 'post',
  attrs: {},
};

describe('what ⇧⌘C copies', () => {
  test('one artboard at 1×, one object at 2×; nothing or several say why not', () => {
    expect(copyTarget(ARTBOARD)).toMatchObject({
      ok: true,
      target: { artboardId: 'post' },
      scale: 1,
      name: 'post',
    });
    expect(copyTarget(BTN)).toMatchObject({
      ok: true,
      target: { elementIds: ['cta'] },
      scale: 2,
      name: 'Book a call',
    });
    expect(copyTarget(null)).toEqual({ ok: false, reason: COPY_WORDS.none });
    expect(copyTarget([BTN, ARTBOARD])).toEqual({ ok: false, reason: COPY_WORDS.several });
    expect(
      copyTarget({ ...BTN, id: undefined, artboardId: undefined, selector: 'button.cta' })
    ).toEqual({ ok: false, reason: COPY_WORDS.noId });
  });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
/** A scripted server: the job is `running` for `pending` polls, then `done` (or `failed`). */
function server({ pending = 1, outcome = 'done', type = 'image/png' } = {}) {
  const seen: Array<{ url: string; body?: unknown }> = [];
  let polls = 0;
  const fetchImpl = (async (url: string, init?: { body?: string }) => {
    seen.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url === '/_api/export-jobs' && init?.body)
      return Response.json({ jobId: 'job-1' }, { status: 202 });
    if (url === '/_api/export-jobs') {
      polls += 1;
      const status = polls <= pending ? 'running' : outcome;
      return Response.json({ jobs: [{ id: 'job-1', status, error: 'The render failed.' }] });
    }
    if (url.startsWith('/_api/export-jobs/download'))
      return new Response(PNG, { headers: { 'Content-Type': type } });
    return new Response('nope', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

describe('copyAsPng — the export, then the clipboard', () => {
  test('renders the selection with one PNG spec, waits for the job, copies the bytes', async () => {
    const s = server({ pending: 2 });
    const copied: Blob[] = [];
    const r = await copyAsPng({
      selected: ARTBOARD,
      canvasFile: FILE,
      designRel: '.design',
      fetchImpl: s.fetchImpl,
      copy: async (b: Blob) => {
        copied.push(b);
        return { ok: true, via: 'browser' };
      },
      wait: async () => {},
    });
    expect(r).toEqual({ ok: true, message: copiedWords('post') });
    expect(r.message).toBe('Copied “post” as a PNG — paste it anywhere.');
    expect(s.seen[0]).toEqual({
      url: '/_api/export-jobs',
      body: {
        v: 2,
        spec: {
          v: 2,
          scope: 'selection',
          format: 'png',
          canvas: 'ui/Post.tsx',
          selection: { artboards: ['post'] },
          options: { size: { scale: 1 } },
        },
      },
    });
    expect(s.seen.filter((c) => c.url === '/_api/export-jobs' && !c.body).length).toBe(3);
    expect(s.seen.at(-1)?.url).toBe('/_api/export-jobs/download?id=job-1');
    expect(copied.length).toBe(1);
    expect(copied[0].type).toBe('image/png');
    expect(new Uint8Array(await copied[0].arrayBuffer())).toEqual(PNG);
  });

  test('a failed render, a clipboard that refuses and a non-PNG all answer in one plain line', async () => {
    const base = { selected: BTN, canvasFile: FILE, designRel: '.design', wait: async () => {} };
    const failed = await copyAsPng({
      ...base,
      fetchImpl: server({ outcome: 'failed' }).fetchImpl,
      copy: async () => ({ ok: true }),
    });
    expect(failed).toEqual({ ok: false, message: 'The render failed.' });

    const refused = await copyAsPng({
      ...base,
      fetchImpl: server().fetchImpl,
      copy: async () => ({ ok: false, error: 'That image is too big to copy. Export it instead.' }),
    });
    expect(refused).toEqual({
      ok: false,
      message: 'That image is too big to copy. Export it instead.',
    });

    const zip = await copyAsPng({
      ...base,
      fetchImpl: server({ type: 'application/zip' }).fetchImpl,
      copy: async () => ({ ok: true }),
    });
    expect(zip).toEqual({ ok: false, message: COPY_WORDS.notPng });

    const slow = await copyAsPng({
      ...base,
      fetchImpl: server({ pending: 1e9 }).fetchImpl,
      copy: async () => ({ ok: true }),
      timeoutMs: -1,
    });
    expect(slow).toEqual({ ok: false, message: COPY_WORDS.timeout });
  });

  test('several things never reach the server', async () => {
    const s = server();
    const r = await copyAsPng({
      selected: [BTN, ARTBOARD],
      canvasFile: FILE,
      fetchImpl: s.fetchImpl,
    });
    expect(r).toEqual({ ok: false, message: COPY_WORDS.several });
    expect(s.seen).toEqual([]);
  });
});

describe('the shell’s binding — one function behind ⇧⌘C, the menu and ⌘K', () => {
  test('nothing bound is a plain line; bound, it runs on what the shell has selected', async () => {
    expect(await runCopyPng()).toEqual({ ok: false, message: COPY_WORDS.none });
    const s = server();
    const off = bindCopyPng(() => ({ selected: BTN, canvasFile: FILE, designRel: '.design' }));
    const r = await runCopyPng({
      fetchImpl: s.fetchImpl,
      copy: async () => ({ ok: true }),
      wait: async () => {},
    });
    expect(r.ok).toBe(true);
    off();
    expect(await runCopyPng()).toEqual({ ok: false, message: COPY_WORDS.none });
  });
});

describe('the Export area opens the sheet with its region (S2.13 calls openExport)', () => {
  test('openExport hands the region over untouched, and the sheet’s spec carries it', () => {
    const got: Array<Record<string, unknown>> = [];
    const off = registerExportOpener((r: Record<string, unknown>) => got.push(r));
    const region = { rect: { x: 40, y: 80, w: 600, h: 400 } };
    expect(openExport({ scope: 'canvas', region, unit: 'one' })).toBe(true);
    off();
    expect(got[0]).toMatchObject({ mode: 'export', scope: 'canvas', region, unit: 'one' });
    const state = initialState(got[0], { hasSelection: false });
    expect(state.region).toEqual(region);
    expect(buildSpec(state, { designRel: '.design', activePath: FILE })).toMatchObject({
      v: 2,
      scope: 'canvas',
      format: 'png',
      canvas: 'ui/Post.tsx',
      region,
    });
  });
});
