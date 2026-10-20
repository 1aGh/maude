// S8.6 — Video in the sheet and Sound only (09 Export › ex-video; Gate 0 C19, C22).
// Two halves: the pure model (the spec a video builds, the ticks, the words, the cap states) and the real
// sheet mounted under happy-dom + React with a recording `fetch` stub (never the render service).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
  formatsNote,
  overCapLine,
  videoButtonLabel,
} from '../client/v2/export/sections/video-copy.js';
import {
  formatsFor,
  lengthState,
  mergeRows,
  reached,
  tickedIds,
  toggleTick,
  videoCtx,
} from '../client/v2/export/sections/video-model.js';
import { buildSpec, initialState, sectionKind } from '../client/v2/export/use-export-spec.js';
import { videoExportContent } from '../client/v2/export/video-content.js';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const ROW = {
  canvas: 'ui/reel.tsx',
  artboard: 'reels',
  label: 'Recap Reels',
  w: 1080,
  h: 1920,
  frames: 900,
  fps: 30,
  cap: 3600,
  over: false,
  clips: [
    { track: 'video', from: 0, frames: 300 },
    { track: 'video', from: 300, frames: 600 },
    { track: 'music', from: 0, frames: 900 },
  ],
};
const WIDE = { ...ROW, artboard: 'wide', label: 'Recap 16:9', w: 1920, h: 1080 };

describe('the spec a video builds', () => {
  const ctx = {
    designRel: '.design',
    activePath: '.design/ui/reel.tsx',
    kind: 'video',
    artboards: ['reels'],
  };
  const base = (format = 'mp4') => ({ ...initialState({}, { hasSelection: true }), format });

  test('only video artboards → the video part', () => {
    expect(sectionKind({ byKind: { video: {} } })).toBe('video');
    expect(sectionKind({ byKind: { video: {}, digital: {} } })).toBe('image');
  });

  test('MP4 opens at 1080p with captions Off — nothing about captions is in the spec (C19)', () => {
    const spec = buildSpec(base(), ctx);
    expect(spec.format).toBe('mp4');
    expect(spec.options).toEqual({ size: { scale: 1 } });
    expect(spec.options?.video).toBeUndefined();
  });

  test('4K is twice the artboard; captions and Allow longer are the person’s words', () => {
    const spec = buildSpec({ ...base(), vq: '4k', captions: true, allowLonger: true }, ctx);
    expect(spec.options?.size).toEqual({ scale: 2 });
    expect(spec.options?.video).toEqual({ captions: true, allowLonger: true });
  });

  test('a GIF has no captions, whatever was left on', () => {
    expect(buildSpec({ ...base('gif'), captions: true }, ctx).options?.video).toBeUndefined();
  });

  test('Sound only: no picture size, m4a unless WAV is picked', () => {
    const m4a = buildSpec(base('audio'), ctx);
    expect(m4a.format).toBe('audio');
    expect(m4a.options?.size).toBeUndefined();
    expect(m4a.options?.audio).toEqual({ codec: 'm4a' });
    expect(buildSpec({ ...base('audio'), audioCodec: 'wav' }, ctx).options?.audio).toEqual({
      codec: 'wav',
    });
  });

  test('the ticked formats are the selection — the linked 16:9 rides with the artboard', () => {
    const formats = [
      {
        artboardId: 'reels',
        label: 'Reels 9:16',
        size: '1080 × 1920',
        linked: false,
        ticked: true,
      },
      { artboardId: 'wide', label: '16:9', size: '1920 × 1080', linked: true, ticked: true },
    ];
    const video = videoCtx(formats);
    expect(video).toEqual({ ids: ['reels', 'wide'], linked: true });
    const spec = buildSpec(base(), { ...ctx, video });
    expect(spec.selection).toEqual({ artboards: ['reels', 'wide'] });
    expect(spec.options?.video).toEqual({ linked: true });
    // unticked: back to the artboard alone, and nothing says "linked"
    const off = videoCtx(formats, { wide: false });
    expect(off).toEqual({ ids: ['reels'], linked: false });
    expect(buildSpec(base(), { ...ctx, video: off }).options?.video).toBeUndefined();
  });

  test('an image export never takes the video’s selection', () => {
    const video = { ids: ['reels', 'wide'], linked: true };
    const spec = buildSpec(base('png'), { ...ctx, video });
    expect(spec.selection).toEqual({ artboards: ['reels'] });
  });
});

describe('the ticks', () => {
  const formats = [
    { artboardId: 'reels', label: 'Reels', size: '', linked: false, ticked: true },
    { artboardId: 'wide', label: '16:9', size: '', linked: true, ticked: true },
    { artboardId: 'copy', label: 'Unlinked copy', size: '', linked: true, ticked: false },
  ];
  test('an unlinked copy arrives unticked; a tick the person sets wins', () => {
    expect(tickedIds(formats)).toEqual(['reels', 'wide']);
    expect(tickedIds(formats, { copy: true, wide: false })).toEqual(['reels', 'copy']);
  });
  test('the last ticked format cannot be unticked — there would be nothing to export', () => {
    let o = toggleTick(formats, {}, 'wide');
    expect(tickedIds(formats, o)).toEqual(['reels']);
    o = toggleTick(formats, o, 'reels');
    expect(tickedIds(formats, o)).toEqual(['reels']);
  });
  test('the formats on offer are the selected artboards (the S7 selectors are absent), a Selection only', () => {
    const rows = [ROW, WIDE];
    expect(videoExportContent('ui/reel.tsx', ['reels'], rows).formats).toEqual([
      {
        artboardId: 'reels',
        label: 'Recap Reels',
        size: '1080 × 1920',
        linked: false,
        ticked: true,
      },
    ]);
    expect(videoExportContent('ui/reel.tsx', [], rows).captions).toEqual({
      available: false,
      defaultMode: 'off',
    });
    expect(formatsFor({ scope: 'canvas', canvas: 'ui/reel.tsx', base: ['reels'], rows })).toEqual(
      []
    );
    expect(
      formatsFor({ scope: 'selection', canvas: 'ui/reel.tsx', base: ['reels'], rows })
    ).toHaveLength(1);
  });
  test('rows are kept as they come, so unticking one does not drop it', () => {
    const a = mergeRows([], [ROW, WIDE]);
    expect(mergeRows(a, [ROW])).toBe(a);
    expect(mergeRows(a, []).map((r: { artboard: string }) => r.artboard)).toEqual([
      'reels',
      'wide',
    ]);
    expect(reached(a, ['wide'], 'selection').map((r: { artboard: string }) => r.artboard)).toEqual([
      'wide',
    ]);
    expect(reached(a, ['wide'], 'canvas')).toHaveLength(2);
  });
});

describe('the words', () => {
  test('"1 artboard selected, 2 videos" — the linked 16:9 is ticked too', () => {
    expect(formatsNote({ selected: 1, videos: 2, linked: true })).toBe(
      'Its linked 16:9 is ticked too — 1 artboard selected, 2 videos.'
    );
    expect(formatsNote({ selected: 1, videos: 1, linked: false })).toBe(
      '1 artboard selected, 1 video.'
    );
  });
  test('the button names what it makes', () => {
    expect(videoButtonLabel({ n: 2, format: 'mp4', busy: false })).toBe('Export 2 videos');
    expect(videoButtonLabel({ n: 1, format: 'audio', busy: false })).toBe('Export sound only');
    expect(videoButtonLabel({ n: 1, format: 'mp4', busy: false })).toBe('Export');
  });
  test('past the cap: the length, the limit, in frames (C22)', () => {
    expect(overCapLine({ label: 'Recap', frames: 4800, fps: 30, cap: 3600, allowed: false })).toBe(
      'Recap is 2:40 long — one export goes up to 2:00 (3,600 frames at 30 fps).'
    );
  });
  test('the cap states: nothing, a warning, longer is on, even longer is not allowed', () => {
    const long = { ...ROW, frames: 4800 };
    expect(lengthState([ROW], false).kind).toBe('ok');
    expect(lengthState([long], false).kind).toBe('warn');
    expect(lengthState([{ ...long, cap: 18000 }], true).kind).toBe('longer');
    expect(lengthState([{ ...long, frames: 20000, cap: 18000, over: true }], true).kind).toBe(
      'past'
    );
  });
});

// ── the real sheet ────────────────────────────────────────────────────────────────────────────────
interface Call {
  method: string;
  url: string;
  body?: { spec?: { format?: string; selection?: unknown; options?: Record<string, unknown> } };
}
let calls: Call[] = [];
const realFetch = globalThis.fetch;
let longVideo = false;

function est(spec: Call['body']): unknown {
  const allow = (spec?.spec?.options?.video as { allowLonger?: boolean } | undefined)?.allowLonger;
  const frames = longVideo ? 4800 : 900;
  const cap = allow ? 18000 : 3600;
  return {
    counts: { selection: 1, canvas: 2, folder: 2, project: 2 },
    files: 1,
    bytes: 6_000_000,
    seconds: 40,
    lane: 'this-mac',
    byKind: { video: { artboards: 1, files: 1, format: spec?.spec?.format ?? 'mp4' } },
    skipped: [],
    video: [{ ...ROW, frames, cap, over: frames > cap }],
  };
}

function stubFetch() {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/_api/export-history')) return json({ history: [] });
    if (url.endsWith('/_api/export-estimate')) return json(est(body));
    if (url.endsWith('/_api/export-jobs')) return json({ jobId: 'job-1' }, 202);
    return json({}, 404);
  }) as typeof fetch;
}

let root: Root | null = null;
let host: HTMLElement | null = null;
beforeEach(() => {
  longVideo = false;
  try {
    localStorage.clear();
  } catch {}
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  globalThis.fetch = realFetch;
});

const tick = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const click = async (sel: string) => {
  const el = $(sel);
  expect(el !== null, `${sel} is on the sheet`).toBe(true);
  await act(async () => {
    el?.click();
    await tick(300);
  });
};
const jobs = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/_api/export-jobs'));
const lastEstimate = () => calls.filter((c) => c.url.endsWith('/_api/export-estimate')).at(-1);

async function mountSheet() {
  stubFetch();
  const { ExportDialog } = await import('../client/dialogs/export-dialog.jsx');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <ExportDialog
        mode="export"
        activePath=".design/ui/reel.tsx"
        designRel=".design"
        exportLane="local"
        hasSelection={true}
        selectedArtboards={['reels']}
        selectionLabel="Recap Reels"
        onClose={() => {}}
      />
    );
    await tick();
  });
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await tick(250);
    });
    if ($('[data-testid="export-film"]')) break;
  }
}

describe('the sheet: a video artboard', () => {
  test('opens on MP4 at 1080p with the picture size, captions Off and the filmstrip', async () => {
    await mountSheet();
    expect($('[data-testid="export-rows"]')?.getAttribute('data-section')).toBe('video');
    expect($('[data-testid="export-format-mp4"]')?.getAttribute('aria-checked')).toBe('true');
    expect($('[data-testid="export-quality-1080p"]')?.getAttribute('aria-checked')).toBe('true');
    expect(text('[data-testid="export-quality-1080p"]')).toContain('1080 × 1920');
    expect(text('[data-testid="export-quality-4k"]')).toContain('2160 × 3840');
    expect($('[data-testid="export-captions-off"]')?.getAttribute('aria-checked')).toBe('true');
    expect(($('[data-testid="export-captions-burned"]') as HTMLButtonElement).disabled).toBe(true);
    expect(text('[data-testid="export-captions-note"]')).toBe('No speech to caption');
    expect(text('[data-testid="export-row-formats"]')).toContain('1 artboard selected, 1 video.');
    expect($('[data-testid="export-film"]') !== null).toBe(true);
    expect($('[data-testid="export-video-length"]')).toBeNull(); // 900 frames: nothing to warn about
  });

  test('MP4 exports the artboard at 1080p; 4K asks for twice the size', async () => {
    await mountSheet();
    await click('[data-testid="export-quality-4k"]');
    await click('[data-testid="export-submit"]');
    const spec = jobs()[0]?.body?.spec;
    expect(spec?.format).toBe('mp4');
    expect(spec?.selection).toEqual({ artboards: ['reels'] });
    expect(spec?.options).toEqual({ size: { scale: 2 } });
  });

  test('GIF has no sound and no captions; WebM is one click down, under Other…', async () => {
    await mountSheet();
    await click('[data-testid="export-format-gif"]');
    expect(text('[data-testid="export-sound-note"]')).toBe('A GIF has no sound');
    expect(text('[data-testid="export-captions-note"]')).toBe('A GIF has no captions');
    await click('[data-testid="export-submit"]');
    expect(jobs()[0]?.body?.spec?.format).toBe('gif');
  });

  test('Sound only: a sound file (m4a or wav), no picture size, the same artboard', async () => {
    await mountSheet();
    await click('[data-testid="export-format-audio"]');
    expect($('[data-testid="export-quality"]')).toBeNull();
    expect($('[data-testid="export-sound-m4a"]')?.getAttribute('aria-checked')).toBe('true');
    expect(text('[data-testid="export-submit-label"]')).toBe('Export sound only');
    await click('[data-testid="export-sound-wav"]');
    await click('[data-testid="export-submit"]');
    const spec = jobs()[0]?.body?.spec;
    expect(spec?.format).toBe('audio');
    expect(spec?.selection).toEqual({ artboards: ['reels'] });
    expect(spec?.options).toEqual({ audio: { codec: 'wav' } });
  });

  test('a video past 3 600 frames warns; Allow longer lifts the limit and says to what', async () => {
    longVideo = true;
    await mountSheet();
    expect(text('[data-testid="export-video-length"]')).toContain(
      'Recap Reels is 2:40 long — one export goes up to 2:00 (3,600 frames at 30 fps).'
    );
    await click('[data-testid="export-video-allow-longer"]');
    expect(
      (lastEstimate()?.body?.spec?.options?.video as { allowLonger?: boolean })?.allowLonger
    ).toBe(true);
    expect(text('[data-testid="export-video-length"]')).toContain('this export may go up to 10:00');
    await click('[data-testid="export-submit"]');
    expect((jobs()[0]?.body?.spec?.options?.video as { allowLonger?: boolean })?.allowLonger).toBe(
      true
    );
  });
});
