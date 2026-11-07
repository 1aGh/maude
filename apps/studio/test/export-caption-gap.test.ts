// #128 §7 (burndown T1.3) — a video export whose comp has <Captions> over a clip with no
// `assets/<sha8>.transcript.json` used to ship with no captions and no word about it. Now the job is
// `done` + `degraded`, and the notice NAMES the asset. Both lanes: the check runs in the cell around
// the render, so a cloud (render worker) export gets it too.

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBus } from '../context.ts';
import { captionGap } from '../exporters/degraded.ts';
import type { ExportContext, ExportResult } from '../exporters/index.ts';
import { createExportJobQueue, type EnqueueArgs } from '../exporters/jobs.ts';
import { missingTranscriptsFor } from '../video/inject.ts';

const A = 'assets/aaaaaaaa.mp4';
const M = 'assets/dddddddd.mp3';
const IMG = 'assets/eeeeeeee.png';

const comp = (captions = '<Captions words="line" />', extra = '') =>
  [
    "import { Captions, DCArtboard, DesignCanvas, Duck, VideoComp } from '@maude/canvas-lib';",
    "import { Audio, Video } from '@remotion/media';",
    "import { Sequence } from 'remotion';",
    'const Reel = () => (',
    '  <>',
    `    <Sequence name="a" from={0} durationInFrames={90}><Video src="${A}" /></Sequence>`,
    extra,
    `    <Duck db={-12} attackMs={100} releaseMs={100}><Audio src="${M}" volume={0.8} /></Duck>`,
    `    ${captions}`,
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

const TRANSCRIPT = JSON.stringify({
  format: 'maude.transcript',
  v: 1,
  asset: A,
  engine: { id: 'elevenlabs-scribe', timing: 'provider' },
  words: [{ id: 'w0', t0: 0.1, t1: 0.4, text: 'ahoj' }],
  speech: { source: 'words', regions: [[0.1, 0.4]] },
  createdAt: '2026-11-07T10:00:00.000Z',
});

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
/** A repo with `.design/ui/Reel.tsx` (the given source) and, optionally, the clip's transcript. */
function project(source: string, withTranscript: boolean) {
  const repo = mkdtempSync(join(tmpdir(), 'maude-t13-gap-'));
  dirs.push(repo);
  const design = join(repo, '.design');
  mkdirSync(join(design, 'ui'), { recursive: true });
  mkdirSync(join(design, 'assets'), { recursive: true });
  writeFileSync(join(design, 'ui', 'Reel.tsx'), source);
  if (withTranscript) writeFileSync(join(design, 'assets', 'aaaaaaaa.transcript.json'), TRANSCRIPT);
  return { repo, design, canvas: join(design, 'ui', 'Reel.tsx') };
}

describe('missingTranscriptsFor — which captioned clips have no words', () => {
  test('names the clip with no transcript; the music bed and a present transcript are not named', () => {
    const p = project(comp(), false);
    expect(missingTranscriptsFor(comp(), p.canvas, p.design)).toEqual([A]);
    const q = project(comp(), true);
    expect(missingTranscriptsFor(comp(), q.canvas, q.design)).toEqual([]);
  });

  test('no <Captions> in the comp: nothing is captioned, nothing to warn about', () => {
    const src = comp('');
    const p = project(src, false);
    expect(missingTranscriptsFor(src, p.canvas, p.design)).toEqual([]);
  });

  test('a still image under the captions is not a speech clip', () => {
    const src = comp(
      '<Captions words="line" />',
      `    <Sequence name="b" from={0} durationInFrames={30}><Video src="${IMG}" /></Sequence>`
    );
    const p = project(src, true);
    expect(missingTranscriptsFor(src, p.canvas, p.design)).toEqual([]);
  });

  test('an unreadable or invalid transcript counts as missing', () => {
    const p = project(comp(), false);
    writeFileSync(join(p.design, 'assets', 'aaaaaaaa.transcript.json'), '{ not json');
    expect(missingTranscriptsFor(comp(), p.canvas, p.design)).toEqual([A]);
  });
});

describe('captionGap — the notice', () => {
  test('names every asset, and says what to do', () => {
    const d = captionGap([A, 'assets/bbbbbbbb.mov']);
    expect(d.captionsMissing).toEqual([A, 'assets/bbbbbbbb.mov']);
    expect(d.reason).toContain(A);
    expect(d.reason).toContain('assets/bbbbbbbb.mov');
    expect(d.remedy).toMatch(/transcribe|captions/i);
  });
});

function enqueueArgs(p: ReturnType<typeof project>, format: EnqueueArgs['format']): EnqueueArgs {
  const ctx: ExportContext = {
    designRoot: p.design,
    repoRoot: p.repo,
    serverOrigin: 'http://127.0.0.1:1', // never reached: the engine is stubbed
  };
  return {
    format,
    scope: 'artboard',
    options: {},
    resolve: {
      activeJson: { active: '.design/ui/Reel.tsx', selected: null },
      designRoot: p.design,
      repoRoot: p.repo,
    },
    ctx,
    remoteCanvas: { origin: 'https://tenant.example', token: 'tok-abc' },
  };
}

const OK: ExportResult = {
  filename: 'reel.mp4',
  contentType: 'video/mp4',
  body: new Uint8Array([0, 0, 0, 24]),
};

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

describe('the export job — local lane', () => {
  test('mp4 of a captioned comp with no transcript: done + degraded, asset named', async () => {
    delete process.env.MAUDE_WORKSPACE_MODE;
    delete process.env.MAUDE_RENDER_URL;
    const p = project(comp(), false);
    const queue = createExportJobQueue(createBus(), p.design, { runExport: async () => OK });
    const { id, result } = queue.enqueue(enqueueArgs(p, 'mp4'));
    await result;
    const job = queue.get(id);
    expect(job?.status).toBe('done');
    expect(job?.degraded?.captionsMissing).toEqual([A]);
    expect(job?.degraded?.reason).toContain(A);
  });

  test('with the transcript present, or on a gif, there is no notice', async () => {
    delete process.env.MAUDE_WORKSPACE_MODE;
    delete process.env.MAUDE_RENDER_URL;
    const p = project(comp(), true);
    const q1 = createExportJobQueue(createBus(), p.design, { runExport: async () => OK });
    const a = q1.enqueue(enqueueArgs(p, 'mp4'));
    await a.result;
    expect(q1.get(a.id)?.degraded).toBeUndefined();

    const bare = project(comp(), false);
    const q2 = createExportJobQueue(createBus(), bare.design, { runExport: async () => OK });
    const b = q2.enqueue(enqueueArgs(bare, 'gif'));
    await b.result;
    expect(q2.get(b.id)?.degraded).toBeUndefined();
  });

  test('keeps an existing degradation and adds to it', async () => {
    delete process.env.MAUDE_WORKSPACE_MODE;
    delete process.env.MAUDE_RENDER_URL;
    const p = project(comp(), false);
    const queue = createExportJobQueue(createBus(), p.design, {
      runExport: async () => ({
        ...OK,
        degraded: { audioDropped: true, reason: 'the audio renderer failed' },
      }),
    });
    const { id, result } = queue.enqueue(enqueueArgs(p, 'mp4'));
    await result;
    const d = queue.get(id)?.degraded;
    expect(d?.audioDropped).toBe(true);
    expect(d?.captionsMissing).toEqual([A]);
    expect(d?.reason).toContain('the audio renderer failed');
    expect(d?.reason).toContain(A);
  });
});

describe('the export job — cloud (render worker) lane', () => {
  test('the same notice rides a worker-rendered mp4', async () => {
    const service = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () =>
        new Response(OK.body, {
          headers: { 'content-type': 'video/mp4', 'x-maude-filename': 'reel.mp4' },
        }),
    });
    try {
      process.env.MAUDE_WORKSPACE_MODE = '1';
      process.env.MAUDE_RENDER_URL = `http://127.0.0.1:${service.port}`;
      process.env.MAUDE_RENDER_SECRET = 'shh';
      const p = project(comp(), false);
      const queue = createExportJobQueue(createBus(), p.design);
      const { id, result } = queue.enqueue(enqueueArgs(p, 'mp4'));
      await result;
      const job = queue.get(id);
      expect(job?.status).toBe('done');
      expect(job?.degraded?.captionsMissing).toEqual([A]);
    } finally {
      service.stop(true);
      delete process.env.MAUDE_RENDER_SECRET;
    }
  });
});

describe('the Exports panel says it', () => {
  test('the row and the pill name the missing captions (not just "reduced fidelity")', () => {
    const row = readFileSync(join(import.meta.dir, '..', 'client/v2/export/job-row.jsx'), 'utf8');
    const words = readFileSync(
      join(import.meta.dir, '..', 'client/v2/export/exports-model.js'),
      'utf8'
    );
    expect(row).toContain('captionsMissing');
    expect(words).toContain('Ready · no captions');
  });
});
