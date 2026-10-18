// S7.6c — the agent path of the Timeline's video tools (V2-1.10 §5.7; rule 14: the same bytes as
// the UI). `maude design cut-words` / `captions add|list` / `cut-to-beat` ask the project's running
// studio for ONE edit op; here the studio is the real `/_api/comp-media` + `/_api/edit-op` route
// specs behind a loopback server the verbs locate the usual way (`_server.json` + `/_health`).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { rootIdentity } from '../../../cli/lib/studio-locate.mjs';
import { target, wordIds } from '../bin/_video-verbs.mjs';
import { EDIT_OPS } from '../edit-ops/dispatch.ts';
import { createEditRoutes } from '../routes/edit.ts';
import { createVideoRoutes } from '../routes/video.ts';
import { transcriptCut } from '../video/derive.ts';
import { serializeTranscript, type Transcript } from '../video/schema.ts';

const BIN = join(import.meta.dir, '..', 'bin');
const SRC = [
  "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
  "import { TransitionSeries } from '@remotion/transitions';",
  "import { Video } from '@remotion/media';",
  'const TOTAL = 270;',
  'const Comp = () => (',
  '  <>',
  '    <TransitionSeries>',
  '      <TransitionSeries.Sequence name="one" durationInFrames={90}><Video src="assets/a1.mp4" /></TransitionSeries.Sequence>',
  '      <TransitionSeries.Sequence name="interview" durationInFrames={120}><Video src="assets/int1.mp4" trimBefore={30} /></TransitionSeries.Sequence>',
  '      <TransitionSeries.Sequence name="three" durationInFrames={60}><Video src="assets/c1.mp4" /></TransitionSeries.Sequence>',
  '    </TransitionSeries>',
  '  </>',
  ');',
  'export default function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="reel" kind="video" width={1080} height={1920}><VideoComp component={Comp} durationInFrames={TOTAL} fps={30} /></DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
  '',
].join('\n');

// "interview" plays source 1.0 … 5.0 s at comp frames 90 … 210
const T = {
  format: 'maude.transcript',
  v: 1,
  asset: 'assets/int1.mp4',
  engine: { id: 'whisper.cpp', timing: 'dtw+energy' },
  words: [
    { id: 'w0', t0: 1.2, t1: 1.8, text: 'Tak' },
    { id: 'w1', t0: 2.0, t1: 2.2, text: 'Ehm…' },
    { id: 'w2', t0: 2.4, t1: 2.8, text: 'jsem' },
    { id: 'w3', t0: 3.0, t1: 3.4, text: 'tady' },
  ],
  speech: { source: 'words', regions: [] },
  createdAt: '2026-10-18T09:00:00.000Z',
} as unknown as Transcript;

let root = '';
let abs = '';
let server: ReturnType<typeof Bun.serve> | null = null;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'maude-video-verbs-'));
  const design = join(root, '.design');
  mkdirSync(join(design, 'ui'), { recursive: true });
  mkdirSync(join(design, 'assets'), { recursive: true });
  writeFileSync(join(design, 'config.json'), '{}\n');
  abs = join(design, 'ui', 'Reel.tsx');
  writeFileSync(abs, SRC);
  for (const a of ['a1', 'int1', 'c1']) writeFileSync(join(design, 'assets', `${a}.mp4`), 'x');
  writeFileSync(join(design, 'assets', 'int1.transcript.json'), serializeTranscript(T));
  // a1 and c1 say nothing: give them empty transcripts so `captions add` has nothing to transcribe
  for (const a of ['a1', 'c1'])
    writeFileSync(
      join(design, 'assets', `${a}.transcript.json`),
      serializeTranscript({ ...T, asset: `assets/${a}.mp4`, words: [] } as Transcript)
    );

  const specs = [
    ...createVideoRoutes({ designRoot: design, designRel: '.design' }),
    ...createEditRoutes({
      designRoot: design,
      designRel: '.design',
      repoRoot: root,
      emit: () => {},
    }),
  ];
  const id = rootIdentity(root);
  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/_health') return Response.json({ app: 'design', rootId: id });
      const spec = specs.find((s) => s.path === url.pathname && s.method === req.method);
      return spec ? spec.handle(req, {}) : new Response('not here', { status: 404 });
    },
  });
  writeFileSync(
    join(design, '_server.json'),
    JSON.stringify({ pid: process.pid, port: server.port, url: `http://127.0.0.1:${server.port}` })
  );
});

afterAll(() => {
  server?.stop(true);
  rmSync(root, { recursive: true, force: true });
});

async function verb(name: string, ...args: string[]) {
  const p = Bun.spawn(['bash', join(BIN, `${name}.sh`), ...args, '--root', root], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_OPEN: '1', CLAUDE_PROJECT_DIR: root },
  });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { out, err, code };
}

describe('argument parsing', () => {
  test('<canvas>#<artboard>, word ranges and lists', () => {
    expect(target(root, 'ui/Reel.tsx#reel')).toEqual({
      canvas: '.design/ui/Reel.tsx',
      artboard: 'reel',
    });
    expect(() => target(root, 'ui/Reel.tsx')).toThrow(/<canvas>#<artboard>/);
    expect(() => target(root, '../x.tsx#reel')).toThrow(/not a canvas/);
    expect(wordIds('w12-w15')).toEqual(['w12', 'w13', 'w14', 'w15']);
    expect(wordIds('w3,w7')).toEqual(['w3', 'w7']);
    expect(() => wordIds('w9-w2')).toThrow(/not a word range/);
  });
});

describe('the verbs ride the studio’s edit op', () => {
  test('cut-words writes exactly the bytes the UI’s clip.cut-source-range writes', async () => {
    writeFileSync(abs, SRC);
    const cut = transcriptCut(T, ['w1'], undefined, { fps: 30 });
    const op = EDIT_OPS.find((o) => o.id === 'clip.cut-source-range');
    const expected = op?.apply(SRC, {
      file: 'ui/Reel.tsx',
      op: 'clip.cut-source-range',
      targets: [],
      params: {
        artboard: 'reel',
        stableId: 'name:interview',
        srcStart: cut.srcStart,
        srcEnd: cut.srcEnd,
      },
    }).source;
    const r = await verb(
      'cut-words',
      'ui/Reel.tsx#reel',
      '--clip',
      'name:interview',
      '--words',
      'w1',
      '--json'
    );
    expect({ code: r.code, err: r.err }).toEqual({ code: 0, err: '' });
    const j = JSON.parse(r.out);
    expect(j.ok).toBe(true);
    expect(j.writeId).toMatch(/^w_/);
    expect(j.removedSec).toBe(0.4);
    expect(readFileSync(abs, 'utf8')).toBe(expected as string);
  }, 30_000);

  test('captions list prints the words inside the untrusted block; add inserts <Captions>', async () => {
    writeFileSync(abs, SRC);
    const l = await verb('captions', 'list', 'ui/Reel.tsx#reel');
    expect(l.code).toBe(0);
    expect(l.out).toMatch(
      /<<<BEGIN UNTRUSTED DATA [0-9a-f]{16}\n[\s\S]*w1 {2}Ehm…[\s\S]*END UNTRUSTED DATA/
    );
    const a = await verb('captions', 'add', 'ui/Reel.tsx#reel', '--words', '3', '--json');
    expect({ code: a.code, err: a.err }).toEqual({ code: 0, err: '' });
    expect(JSON.parse(a.out)).toMatchObject({ ok: true, inserted: true, transcribed: [] });
    expect(readFileSync(abs, 'utf8')).toContain(
      '<Captions data-cd-id="captions" words={3} position="bottom" />'
    );
    expect((await verb('captions', 'export', 'ui/Reel.tsx#reel')).out).toContain('00:00:');
  }, 30_000);

  test('cut-to-beat with no beat grid says what to run; a refused op exits 1', async () => {
    writeFileSync(abs, SRC);
    const b = await verb('cut-to-beat', 'ui/Reel.tsx#reel');
    expect(b.code).toBe(1);
    expect(b.err).toContain('maude design beats');
    const bad = await verb('cut-words', 'ui/Reel.tsx#reel', '--clip', 'name:nope', '--words', 'w1');
    expect(bad.code).toBe(1);
    expect(readFileSync(abs, 'utf8')).toBe(SRC);
  }, 30_000);
});
