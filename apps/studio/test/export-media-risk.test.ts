// #128 §1 / #127 (burndown T3.4) — when an mp4 export falls back to frame-by-frame capture (so: no sound)
// and the comp holds a clip the audio renderer cannot decode (HEVC, variable frame rate, a second audio
// track), the notice names THAT clip and its codec and points at the fix. The clips are tiny synthetic
// ones made by ffmpeg; without ffmpeg the test says so and skips.

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBus } from '../context.ts';
import { undecodableMediaGap } from '../exporters/degraded.ts';
import type { ExportContext, ExportResult } from '../exporters/index.ts';
import { createExportJobQueue, type EnqueueArgs } from '../exporters/jobs.ts';
import { clipsNamedIn, riskyMediaIn } from '../video/media-risk.ts';
import { synthClip, toolsFor } from './_media-synth.ts';

const T = toolsFor();
if (!T.ok) console.warn(`export-media-risk.test: skipped — ${T.why}`);

const HEVC = 'assets/aaaaaaaa.mp4';
const PLAIN = 'assets/bbbbbbbb.mp4';

const comp = (...srcs: string[]) =>
  [
    "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
    "import { Video } from '@remotion/media';",
    "import { Sequence } from 'remotion';",
    'const Reel = () => (',
    '  <>',
    ...srcs.map(
      (s, i) =>
        `    <Sequence name="s${i}" from={${i * 30}} durationInFrames={30}><Video src="${s}" /></Sequence>`
    ),
    '  </>',
    ');',
    'export default function Canvas() {',
    '  return (',
    '    <DesignCanvas>',
    '      <DCArtboard id="reel" width={1080} height={1920}><VideoComp component={Reel} durationInFrames={90} fps={30} /></DCArtboard>',
    '    </DesignCanvas>',
    '  );',
    '}',
  ].join('\n');

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A repo with `.design/ui/Reel.tsx` naming the given clips; each clip is made (or not) with the given opts. */
function project(clips: Array<{ rel: string; make?: Parameters<typeof synthClip>[2] }>) {
  const repo = mkdtempSync(join(tmpdir(), 'maude-t34-exp-'));
  dirs.push(repo);
  const design = join(repo, '.design');
  mkdirSync(join(design, 'ui'), { recursive: true });
  mkdirSync(join(design, 'assets'), { recursive: true });
  const source = comp(...clips.map((c) => c.rel));
  writeFileSync(join(design, 'ui', 'Reel.tsx'), source);
  if (T.ok) {
    for (const c of clips) {
      if (c.make) synthClip(join(design, 'assets'), c.rel.slice('assets/'.length), c.make);
    }
  }
  return { repo, design, source };
}

describe('clipsNamedIn', () => {
  test('lists each assets/ clip once, in order; stills and audio are not clips', () => {
    const src =
      comp(HEVC, PLAIN, HEVC) +
      '\n<Img src="assets/cccccccc.png" /><Audio src="assets/dddddddd.mp3" />';
    expect(clipsNamedIn(src)).toEqual([HEVC, PLAIN]);
  });
});

describe('undecodableMediaGap — the notice', () => {
  test('names the clip and the codec, flags the audio as dropped, and gives the fix', () => {
    const d = undecodableMediaGap([{ asset: HEVC, what: 'HEVC (H.265), variable frame rate' }]);
    expect(d.audioDropped).toBe(true);
    expect(d.reason).toContain(HEVC);
    expect(d.reason).toContain('HEVC (H.265)');
    expect(d.remedy).toContain(`maude design video-proxy ${HEVC}`);
  });

  test('past three clips the rest are counted, not listed', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((x) => ({
      asset: `assets/${x.repeat(8)}.mp4`,
      what: 'HEVC (H.265)',
    }));
    const d = undecodableMediaGap(many);
    expect(d.reason).toContain('and 2 more');
    expect(d.reason).not.toContain('eeeeeeee');
  });
});

describe.skipIf(!T.ok)('riskyMediaIn — probes what the comp names', () => {
  test('finds the HEVC clip, leaves the plain one, ignores a clip that is not there', () => {
    const p = project([
      { rel: HEVC, make: { codec: 'hevc' } },
      { rel: PLAIN, make: {} },
      { rel: 'assets/cccccccc.mp4' },
    ]);
    const r = riskyMediaIn(p.source, p.design);
    expect(r.map((x) => x.asset)).toEqual([HEVC]);
    expect(r[0]?.what).toContain('HEVC');
  });
});

const OK: ExportResult = {
  filename: 'reel.mp4',
  contentType: 'video/mp4',
  body: new Uint8Array([0, 0, 0, 24]),
};
const DECODE_FAIL = {
  audioDropped: true,
  reason: `Cannot render video "${HEVC}": The video could not be decoded by the browser.`,
};

function enqueueArgs(
  p: ReturnType<typeof project>,
  options: EnqueueArgs['options'] = {}
): EnqueueArgs {
  const ctx: ExportContext = {
    designRoot: p.design,
    repoRoot: p.repo,
    serverOrigin: 'http://127.0.0.1:1', // never reached: the engine is stubbed
  };
  return {
    format: 'mp4',
    scope: 'artboard',
    options,
    resolve: {
      activeJson: { active: '.design/ui/Reel.tsx', selected: null },
      designRoot: p.design,
      repoRoot: p.repo,
    },
    ctx,
    remoteCanvas: { origin: 'https://tenant.example', token: 'tok-abc' },
  };
}

const SAVED = { mode: process.env.MAUDE_WORKSPACE_MODE, url: process.env.MAUDE_RENDER_URL };
afterEach(() => {
  for (const [k, v] of [
    ['MAUDE_WORKSPACE_MODE', SAVED.mode],
    ['MAUDE_RENDER_URL', SAVED.url],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function runJob(p: ReturnType<typeof project>, res: ExportResult, options = {}) {
  delete process.env.MAUDE_WORKSPACE_MODE;
  delete process.env.MAUDE_RENDER_URL;
  const queue = createExportJobQueue(createBus(), p.design, { runExport: async () => res });
  const { id, result } = queue.enqueue(enqueueArgs(p, options));
  await result;
  return queue.get(id);
}

describe.skipIf(!T.ok)('the export job — the fallback names the clip', () => {
  test('frame-step fallback + an HEVC clip: the notice names the asset and the codec', async () => {
    const p = project([{ rel: HEVC, make: { codec: 'hevc' } }]);
    const job = await runJob(p, { ...OK, degraded: DECODE_FAIL });
    expect(job?.status).toBe('done');
    expect(job?.degraded?.audioDropped).toBe(true);
    expect(job?.degraded?.reason).toContain('could not be decoded');
    expect(job?.degraded?.reason).toContain(HEVC);
    expect(job?.degraded?.reason).toContain('HEVC (H.265)');
    expect(job?.degraded?.remedy).toContain('maude design video-proxy');
  });

  test('the warning is logged before the render starts', async () => {
    const p = project([{ rel: HEVC, make: { codec: 'hevc' } }]);
    const lines: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => {
      lines.push(a.join(' '));
    };
    try {
      await runJob(p, OK);
    } finally {
      console.error = orig;
    }
    const warn = lines.find((l) => l.includes(HEVC) && l.includes('HEVC (H.265)'));
    expect(warn).toBeDefined();
    expect(warn).toContain('no sound');
  });

  test('a plain H.264 comp that falls back for another reason gets no codec accusation', async () => {
    const p = project([{ rel: PLAIN, make: {} }]);
    const job = await runJob(p, {
      ...OK,
      degraded: { audioDropped: true, reason: 'the renderer overflowed' },
    });
    expect(job?.degraded?.reason).toBe('the renderer overflowed');
  });

  test('an HEVC clip but the render kept its sound: no notice at all', async () => {
    const p = project([{ rel: HEVC, make: { codec: 'hevc' } }]);
    const job = await runJob(p, OK);
    expect(job?.degraded).toBeUndefined();
  });

  test('audio switched off: no probe, no notice', async () => {
    const p = project([{ rel: HEVC, make: { codec: 'hevc' } }]);
    const job = await runJob(p, { ...OK, degraded: DECODE_FAIL }, { audio: false });
    expect(job?.degraded?.reason).toBe(DECODE_FAIL.reason);
  });
});
