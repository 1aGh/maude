// S7.11b — POST /_api/media-analysis (routes/video.ts + video/media-analysis.ts; contract V2-1.10 §5.7).
//
// The two UIs that already call it: the Transcript panel's "Captions from speech" (TranscriptHost
// `analyseAsset`) and the Music inspector's "Find the beat" / Half · Double (music-media `findBeats`).
// No real speech engine and no ffmpeg ever runs here: every job goes through an injected runner.
//   - the table: a main-origin POST, `readOnly: 'refused'`, in neither canvas allowlist;
//   - the handler: asset pattern, kind, bpm, exit-code mapping (0 / 3 / 4 / other), one job per
//     (kind, asset, bpm) at a time, a runner that throws;
//   - the roles: Can view and Can comment are refused BEFORE a job starts; a canvas-only session too;
//   - the default runner's command: the bundled runtime re-entered with BUN_BE_BUN, the helper `.mjs`
//     (never the `.sh` shim, which needs a `bun` on PATH the packaged app does not have);
//   - both UIs against it: the sidecar the stub writes shows up in the next comp-media read.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runWithAccess } from '../access/request.ts';
import { resolveAccess } from '../access/scope.ts';
import { findBeats } from '../client/v2/timeline/lanes/music-media.js';
import { analyseAsset } from '../client/v2/transcript/TranscriptHost.jsx';
import { CANVAS_SAFE_API, type Http } from '../http.ts';
import { canvasOriginRoutes } from '../routes/canvas-origin.ts';
import { allSpecs } from '../routes/index.ts';
import { mountRoutes } from '../routes/table.ts';
import { createVideoRoutes } from '../routes/video.ts';
import { type AnalysisJob, type AnalysisResult, analysisCommand } from '../video/media-analysis.ts';
import { makeSandbox } from './_helpers.ts';
import { stubDeps } from './_route-stubs.ts';

const ROUTE = '/_api/media-analysis';
const A = 'assets/aaaaaaaa.mp4';
const M = 'assets/dddddddd.mp3';

const SOURCE = [
  'const TOTAL = 140;',
  'const Reel = () => (',
  '  <>',
  `    <Sequence name="a" from={0} durationInFrames={90}><OffthreadVideo src="${A}" /></Sequence>`,
  `    <Audio src="${M}" />`,
  '  </>',
  ');',
  'export default function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="reel"><VideoComp component={Reel} durationInFrames={TOTAL} fps={30} /></DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
].join('\n');

function seed() {
  const { root, designRoot } = makeSandbox();
  mkdirSync(join(designRoot, 'assets'), { recursive: true });
  writeFileSync(join(designRoot, 'ui', 'Reel.tsx'), SOURCE);
  writeFileSync(join(designRoot, 'assets', 'aaaaaaaa.mp4'), 'v');
  writeFileSync(join(designRoot, 'assets', 'dddddddd.mp3'), 'm');
  return { root, designRoot };
}

type Runner = (job: AnalysisJob) => Promise<AnalysisResult>;

function harness(designRoot: string, run: Runner) {
  const calls: AnalysisJob[] = [];
  const spec = createVideoRoutes({
    designRoot,
    designRel: '.design',
    analyse: async (job) => {
      calls.push(job);
      return run(job);
    },
  }).find((s) => s.path === ROUTE);
  if (!spec) throw new Error('no media-analysis spec');
  const post = (body: unknown, access?: Parameters<typeof resolveAccess>[0], raw?: string) => {
    const req = new Request(`http://127.0.0.1:4399${ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw ?? JSON.stringify(body),
    });
    const go = () => Promise.resolve(spec.handle(req, {}));
    return access ? runWithAccess(resolveAccess(access), go) : go();
  };
  return { post, calls, spec };
}

const ok: Runner = async () => ({ code: 0, stdout: '{}', stderr: '' });
const exits =
  (code: number, stderr = ''): Runner =>
  async () => ({ code, stdout: '', stderr });

describe('the route is a main-origin write, refused to a read-only session', () => {
  test('in the table as POST main / refused; absent from both canvas allowlists', () => {
    const specs = allSpecs(stubDeps());
    expect(specs.find((s) => s.path === ROUTE)).toMatchObject({
      method: 'POST',
      origin: 'main',
      readOnly: 'refused',
    });
    expect(CANVAS_SAFE_API.has(ROUTE)).toBe(false);
    const table = mountRoutes(specs);
    expect(table.canvasPaths).not.toContain(ROUTE);
    const http = {
      routes: {},
      canvasRoutes: {},
      tableCanvasPaths: table.canvasPaths,
    } as unknown as Pick<Http, 'routes' | 'canvasRoutes' | 'tableCanvasPaths'>;
    expect(Object.keys(canvasOriginRoutes(http))).not.toContain(ROUTE);
  });
});

describe('the request', () => {
  test('transcript: a clean run answers {ok:true} and hands the runner the project and the asset', async () => {
    const { root, designRoot } = seed();
    const h = harness(designRoot, ok);
    const res = await h.post({ asset: A, kind: 'transcript' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.calls).toEqual([
      { kind: 'transcript', asset: A, repoRoot: root, designRel: '.design' },
    ]);
  });

  test('speech: the same engine in its energy-only mode', async () => {
    const { designRoot } = seed();
    const h = harness(designRoot, ok);
    expect((await h.post({ asset: A, kind: 'speech' })).status).toBe(200);
    expect(h.calls[0]?.kind).toBe('speech');
  });

  test('beats: bpm travels to the runner (Half · Double)', async () => {
    const { designRoot } = seed();
    const h = harness(designRoot, ok);
    expect((await h.post({ asset: M, kind: 'beats', bpm: 60 })).status).toBe(200);
    expect(h.calls[0]).toMatchObject({ kind: 'beats', asset: M, bpm: 60 });
    await h.post({ asset: M, kind: 'beats' });
    expect(h.calls[1]?.bpm).toBeUndefined();
  });

  test('the asset is assets/<8 hex>.<ext>: anything else is a 400 and no job starts', async () => {
    const { designRoot } = seed();
    const h = harness(designRoot, ok);
    for (const asset of [
      '../etc/passwd',
      'assets/../x.mp3',
      'assets/sub/aaaaaaaa.mp4',
      'assets/AAAAAAAA.mp4',
      'assets/aaaaaaa.mp4',
      'assets/aaaaaaaa',
      '.design/ui/Reel.tsx',
      '/etc/passwd',
      'assets/aaaaaaaa.mp4\0',
      42,
      null,
    ]) {
      const res = await h.post({ asset, kind: 'transcript' });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('bad-asset');
    }
    expect(h.calls).toHaveLength(0);
  });

  test('a leading ./ or .design/ is read the way the comp spells it', async () => {
    const { designRoot } = seed();
    const h = harness(designRoot, ok);
    expect((await h.post({ asset: `.design/${A}`, kind: 'transcript' })).status).toBe(200);
    expect(h.calls[0]?.asset).toBe(A);
  });

  test('an asset that is not in the project is a 404 and no job starts', async () => {
    const { designRoot } = seed();
    const h = harness(designRoot, ok);
    const res = await h.post({ asset: 'assets/bbbbbbbb.mp4', kind: 'transcript' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('no-such-asset');
    expect(h.calls).toHaveLength(0);
  });

  test('a bad kind, a bad bpm, a bpm on a transcript, bad JSON and a huge body are refused', async () => {
    const { designRoot } = seed();
    const h = harness(designRoot, ok);
    const err = async (res: Response) => ((await res.json()) as { error: string }).error;
    expect(await err(await h.post({ asset: A, kind: 'karaoke' }))).toBe('bad-kind');
    expect(await err(await h.post({ asset: A }))).toBe('bad-kind');
    for (const bpm of [19, 401, 'fast', Number.NaN, 0, -120])
      expect(await err(await h.post({ asset: M, kind: 'beats', bpm }))).toBe('bad-bpm');
    expect(await err(await h.post({ asset: A, kind: 'transcript', bpm: 120 }))).toBe('bad-bpm');
    expect(await err(await h.post(null, undefined, '{ nope'))).toBe('bad-json');
    const big = await h.post(
      null,
      undefined,
      JSON.stringify({ asset: A, kind: 'transcript', x: 'y'.repeat(70_000) })
    );
    expect(big.status).toBe(413);
    expect(h.calls).toHaveLength(0);
  });
});

describe('the exit code of the verb', () => {
  test('transcript 3 = no speech engine: 409 {error:"no-engine"}', async () => {
    const { designRoot } = seed();
    const h = harness(designRoot, exits(3, 'transcribe-local: No speech engine on this Mac.'));
    const res = await h.post({ asset: A, kind: 'transcript' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'no-engine' });
  });

  test('transcript 4 with "no words recognized" = {error:"no-words"}', async () => {
    const { designRoot } = seed();
    const h = harness(
      designRoot,
      exits(4, 'transcribe-local: no words recognized (silent or unsupported audio?)')
    );
    const res = await h.post({ asset: A, kind: 'transcript' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'no-words' });
  });

  test('transcript 4 for any other reason (a decode failure) is a failure that says why', async () => {
    const { designRoot } = seed();
    const h = harness(designRoot, exits(4, 'transcribe-local: ffmpeg could not decode the file\n'));
    const res = await h.post({ asset: A, kind: 'transcript' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'failed',
      message: 'transcribe-local: ffmpeg could not decode the file',
    });
  });

  test('any other code is {error:"failed", message}; the message is the last line, short', async () => {
    const { designRoot } = seed();
    const h = harness(designRoot, exits(1, `noise\n${'x'.repeat(900)}\n`));
    const res = await h.post({ asset: A, kind: 'transcript' });
    expect(res.status).toBe(500);
    const j = (await res.json()) as { error: string; message: string };
    expect(j.error).toBe('failed');
    expect(j.message.length).toBeLessThanOrEqual(300);
  });

  test('beats: 3 = no decoder (409), 4 = undecodable (500 failed), 0 = ok', async () => {
    const { designRoot } = seed();
    expect(
      await (
        await harness(designRoot, exits(3, 'beats: no ffmpeg')).post({ asset: M, kind: 'beats' })
      ).json()
    ).toEqual({ error: 'no-decoder' });
    const bad = await harness(designRoot, exits(4, 'beats: undecodable')).post({
      asset: M,
      kind: 'beats',
    });
    expect(bad.status).toBe(500);
    expect(((await bad.json()) as { error: string }).error).toBe('failed');
    expect(await (await harness(designRoot, ok).post({ asset: M, kind: 'beats' })).json()).toEqual({
      ok: true,
    });
  });

  test('a runner that throws is a failure, not a crashed route', async () => {
    const { designRoot } = seed();
    const h = harness(designRoot, async () => {
      throw new Error('spawn ENOENT');
    });
    const res = await h.post({ asset: A, kind: 'transcript' });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe('failed');
  });

  test('the same job asked twice at once runs once; a different bpm is a different job', async () => {
    const { designRoot } = seed();
    let release: (r: AnalysisResult) => void = () => {};
    const gate = new Promise<AnalysisResult>((r) => {
      release = r;
    });
    const h = harness(designRoot, () => gate);
    const one = h.post({ asset: M, kind: 'beats' });
    const two = h.post({ asset: M, kind: 'beats' });
    const half = h.post({ asset: M, kind: 'beats', bpm: 60 });
    await Bun.sleep(20);
    release({ code: 0, stdout: '', stderr: '' });
    expect((await one).status).toBe(200);
    expect((await two).status).toBe(200);
    expect((await half).status).toBe(200);
    expect(h.calls.map((c) => c.bpm)).toEqual([undefined, 60]);
    // finished: asking again starts a new job
    await h.post({ asset: M, kind: 'beats' });
    expect(h.calls).toHaveLength(3);
  });
});

describe('roles (minimum role: Can edit)', () => {
  test('Can view and Can comment are refused before any job starts; Can edit and the owner run it', async () => {
    const { designRoot } = seed();
    const h = harness(designRoot, ok);
    for (const role of ['observer', 'viewer'] as const) {
      const res = await h.post({ asset: A, kind: 'transcript' }, { v: 1, role });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe('read-only');
    }
    expect(h.calls).toHaveLength(0);
    for (const role of ['member', 'owner'] as const)
      expect((await h.post({ asset: A, kind: 'transcript' }, { v: 1, role })).status).toBe(200);
  });

  test('a canvas-only session is refused whatever the grant says (the asset is the project’s)', async () => {
    const { designRoot } = seed();
    const h = harness(designRoot, ok);
    const claim = {
      v: 1 as const,
      role: null,
      grants: [{ c: 'ui/Reel.tsx', r: 'member' as const }],
    };
    expect((await h.post({ asset: A, kind: 'transcript' }, claim)).status).toBe(403);
    expect(h.calls).toHaveLength(0);
  });
});

describe('the default runner’s command', () => {
  test('the packaged app re-enters its own runtime on the helper .mjs (never the .sh shim)', () => {
    const c = analysisCommand(
      { kind: 'transcript', asset: A, repoRoot: '/p', designRel: '.design' },
      { MAUDE_BUN_PATH: process.execPath, PATH: '/usr/bin' }
    );
    expect(c.cmd[0]).toBe(process.execPath);
    expect(c.cmd[1]).toMatch(/bin\/_transcribe-local\.mjs$/);
    expect(c.cmd.slice(2)).toEqual([A, '--root', '/p', '--json']);
    expect(c.env.BUN_BE_BUN).toBe('1');
    expect(c.cmd.join(' ')).not.toContain('.sh');
  });

  test('a dev checkout runs the plain bun on PATH, with no BUN_BE_BUN', () => {
    const c = analysisCommand(
      { kind: 'beats', asset: M, bpm: 60, repoRoot: '/p', designRel: '.design' },
      { PATH: '/usr/bin' }
    );
    expect(c.cmd[0]).toBe('bun');
    expect(c.cmd[1]).toMatch(/bin\/beats\.mjs$/);
    expect(c.cmd.slice(2)).toEqual([
      M,
      '--root',
      '/p',
      '--design-root',
      '.design',
      '--bpm',
      '60',
      '--json',
    ]);
    expect(c.env.BUN_BE_BUN).toBeUndefined();
  });

  test('speech adds --speech-only; the child gets a small environment, not the studio’s', () => {
    const c = analysisCommand(
      { kind: 'speech', asset: A, repoRoot: '/p', designRel: '.design' },
      { PATH: '/usr/bin', HOME: '/h', ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k' }
    );
    expect(c.cmd).toContain('--speech-only');
    expect(c.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(c.env.OPENAI_API_KEY).toBeUndefined();
    expect(c.env.HOME).toBe('/h');
  });
});

describe('both UIs against the route (a stubbed spawn)', () => {
  /** A fetch that lands on the route handler, and a runner that writes the sidecar a real verb would. */
  function wire(designRoot: string, run: Runner) {
    const h = harness(designRoot, run);
    const comp = createVideoRoutes({ designRoot, designRel: '.design' }).find(
      (s) => s.path === '/_api/comp-media'
    );
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (String(url) === ROUTE) return h.post(null, undefined, String(init?.body ?? ''));
      if (String(url).startsWith('/_api/comp-media'))
        return Promise.resolve(comp?.handle(new Request(`http://127.0.0.1:4399${url}`), {}));
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
    return { h, fetchImpl };
  }

  test('"Captions from speech": no engine says so; an engine answers ok; silent audio says no-words', async () => {
    const { designRoot } = seed();
    expect(await analyseAsset(A, wire(designRoot, exits(3)).fetchImpl)).toEqual({
      ok: false,
      reason: 'no-engine',
    });
    expect(
      await analyseAsset(A, wire(designRoot, exits(4, 'no words recognized')).fetchImpl)
    ).toEqual({
      ok: false,
      reason: 'no-words',
    });
    expect(await analyseAsset(A, wire(designRoot, ok).fetchImpl)).toEqual({ ok: true });
  });

  test('"Find the beat" and Half · Double: the sidecar the job wrote is in the next comp-media read', async () => {
    const { designRoot } = seed();
    const grid = (bpm: number) =>
      JSON.stringify({
        format: 'maude.beats',
        v: 1,
        asset: M,
        durationSec: 10,
        analyzer: { id: 'maude-beats', version: 1, decode: 'ffmpeg' },
        bpm,
        bpmSource: bpm === 120 ? 'detected' : 'set',
        tempoStrength: 0.8,
        beats: [0.5, 1, 1.5],
        bar: { phase: 0, confidence: 0.9 },
        createdAt: '2026-10-20T09:00:00.000Z',
      });
    const { h, fetchImpl } = wire(designRoot, async (job) => {
      writeFileSync(join(designRoot, 'assets', 'dddddddd.beats.json'), grid(job.bpm ?? 120));
      return { code: 0, stdout: '', stderr: '' };
    });
    const wait = async () => {};
    const found = await findBeats({
      canvas: '.design/ui/Reel.tsx',
      artboardId: 'reel',
      src: M,
      fetchImpl,
      wait,
    });
    expect(found).toEqual({ ok: true, message: '' });
    expect(h.calls[0]).toMatchObject({ kind: 'beats', asset: M });
    const half = await findBeats({
      canvas: '.design/ui/Reel.tsx',
      artboardId: 'reel',
      src: M,
      bpm: 60,
      fetchImpl,
      wait,
    });
    expect(half).toEqual({ ok: true, message: '' });
    expect(h.calls[1]).toMatchObject({ kind: 'beats', asset: M, bpm: 60 });
    const media = (await (
      await fetchImpl('/_api/comp-media?canvas=.design/ui/Reel.tsx&artboard=reel')
    ).json()) as {
      music: Array<{ src: string; grid?: { bpm: number } }>;
    };
    expect(media.music.find((m) => m.src === M)?.grid?.bpm).toBe(60);
  });

  test('a refused session sees the role words, not a spinner (403 reaches findBeats)', async () => {
    const { designRoot } = seed();
    const h = harness(designRoot, ok);
    const fetchImpl = (async (_u: string, init?: RequestInit) =>
      h.post(null, { v: 1, role: 'viewer' }, String(init?.body ?? ''))) as unknown as typeof fetch;
    const r = await findBeats({
      canvas: '.design/ui/Reel.tsx',
      artboardId: 'reel',
      src: M,
      fetchImpl,
      wait: async () => {},
    });
    expect(r.ok).toBe(false);
    expect(r.message).toBe('Your role can’t find the beat.');
  });
});
