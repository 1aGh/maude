// S7.4 — GET /_api/comp-media (routes/video.ts; contract V2-1.10 §5.4, test #15 of §7).
//   - the table: a main-origin GET, in neither canvas allowlist;
//   - the handler on a sandbox project: the answer's shape and numbers, the cache (a changed
//     canvas or sidecar is seen at once), the refusals (400 / 404 / 422);
//   - the roles: Can view is refused, Can comment is served, a canvas-only session is served for a
//     granted canvas only and gets ONE answer for "not granted" and "does not exist";
//   - a real server: the main origin serves it, the canvas origin answers 403.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { runWithAccess } from '../access/request.ts';
import { resolveAccess } from '../access/scope.ts';
import { CANVAS_SAFE_API, type Http } from '../http.ts';
import { canvasOriginRoutes } from '../routes/canvas-origin.ts';
import { allSpecs } from '../routes/index.ts';
import { mountRoutes } from '../routes/table.ts';
import { createVideoRoutes } from '../routes/video.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';
import { stubDeps } from './_route-stubs.ts';

const ROUTE = '/_api/comp-media';
const A = 'assets/aaaaaaaa.mp4';
const B = 'assets/bbbbbbbb.mp4';
const M = 'assets/dddddddd.mp3';

const SOURCE = [
  'const TOTAL = 140;',
  'const Reel = () => (',
  '  <>',
  '    <TransitionSeries>',
  `      <TransitionSeries.Sequence name="a" durationInFrames={90}><OffthreadVideo src="${A}" trimBefore={30} /></TransitionSeries.Sequence>`,
  '      <TransitionSeries.Transition timing={linearTiming({ durationInFrames: 10 })} />',
  `      <TransitionSeries.Sequence name="b" durationInFrames={60}><OffthreadVideo src="${B}" playbackRate={2} /></TransitionSeries.Sequence>`,
  '    </TransitionSeries>',
  `    <Duck db={-12}><Audio src="${M}" trimBefore={15} /></Duck>`,
  `    <Captions words="line" fixes={${JSON.stringify([{ src: A, at: 1.7, text: 'jsem tu' }])}} />`,
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

const transcript = (asset: string, words: unknown[], regions: unknown[]) =>
  JSON.stringify({
    format: 'maude.transcript',
    v: 1,
    asset,
    engine: { id: 'whisper.cpp', timing: 'dtw+energy' },
    words,
    speech: { source: 'words', regions },
    createdAt: '2026-10-18T09:00:00.000Z',
  });

const GRID = JSON.stringify({
  format: 'maude.beats',
  v: 1,
  asset: M,
  durationSec: 10,
  analyzer: { id: 'maude-beats', version: 1, decode: 'ffmpeg' },
  bpm: 120,
  bpmSource: 'detected',
  tempoStrength: 0.8,
  beats: [0.5, 1, 1.5],
  bar: { phase: 0, confidence: 0.9 },
  createdAt: '2026-10-18T09:00:00.000Z',
});

function seed() {
  const { root, designRoot } = makeSandbox();
  mkdirSync(join(designRoot, 'assets'), { recursive: true });
  writeFileSync(join(designRoot, 'ui', 'Reel.tsx'), SOURCE);
  writeFileSync(
    join(designRoot, 'assets', 'aaaaaaaa.transcript.json'),
    transcript(
      A,
      [
        { id: 'w0', t0: 1.5, t1: 1.9, text: 'jsem' },
        { id: 'w1', t0: 2.5, t1: 2.8, text: 'tu' },
      ],
      [[1.5, 2.8]]
    )
  );
  writeFileSync(
    join(designRoot, 'assets', 'bbbbbbbb.transcript.json'),
    transcript(B, [{ id: 'w0', t0: 1.0, t1: 1.4, text: 'dva' }], [[1.0, 1.4]])
  );
  writeFileSync(join(designRoot, 'assets', 'dddddddd.beats.json'), GRID);
  return { root, designRoot };
}

function handler(designRoot: string) {
  const spec = createVideoRoutes({ designRoot, designRel: '.design' }).find(
    (s) => s.path === ROUTE
  );
  if (!spec) throw new Error('no comp-media spec');
  return (qs: string, access?: Parameters<typeof resolveAccess>[0]) => {
    const req = new Request(`http://127.0.0.1:4399${ROUTE}?${qs}`);
    const run = () => Promise.resolve(spec.handle(req, {}));
    return access ? runWithAccess(resolveAccess(access), run) : run();
  };
}

const QS = 'canvas=.design/ui/Reel.tsx&artboard=reel';

describe('the route is a main-origin read, in neither canvas allowlist', () => {
  test('registered in the table; absent from CANVAS_SAFE_API and the canvas server map', () => {
    const specs = allSpecs(stubDeps());
    const spec = specs.find((s) => s.path === ROUTE);
    expect(spec).toMatchObject({ method: 'GET', origin: 'main', readOnly: 'allowed' });
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

describe('GET /_api/comp-media — the answer', () => {
  test('{fps, clips, words, speech, beats, unresolved}, derived from the cut', async () => {
    const { designRoot } = seed();
    const res = await handler(designRoot)(QS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ['beats', 'clips', 'fps', 'music', 'speech', 'unresolved', 'words'].sort()
    );
    expect(body.fps).toBe(30);
    expect(body.unresolved).toEqual([]);
    const clips = body.clips as Array<{ stableId: string; track: string; from: number }>;
    expect(clips.map((c) => [c.track, c.from])).toEqual([
      ['video', 0],
      ['video', 80],
      ['music', 0],
    ]);
    expect(clips.map((c) => c.stableId).slice(0, 2)).toEqual(['name:a', 'name:b']);
    expect(clips[2]?.stableId.startsWith('loose:')).toBe(true);
    // a: trim 1 s → "jsem" 1.5..1.9 = comp 15..27, replaced by the <Captions fixes> literal;
    //    "tu" 2.5..2.8 = comp 45..54. b (rate 2): "dva" 1.0..1.4 = comp 95..101.
    expect((body.words as Array<Record<string, unknown>>).map((w) => [w.text, w.f0, w.f1])).toEqual(
      [
        ['jsem tu', 15, 27],
        ['tu', 45, 54],
        ['dva', 95, 101],
      ]
    );
    // speech: a's [1.5, 2.8] = 15..54, b's [1, 1.4] = 95..101; the ducked bed (M) adds none
    expect(body.speech).toEqual([
      [15, 54],
      [95, 101],
    ]);
    // the bed: trim 15 frames (0.5 s): 0.5 s → frame 0, 1 s → 15, 1.5 s → 30
    expect(body.beats).toEqual([0, 15, 30]);
  });

  test('a changed sidecar or canvas is seen on the next read; a repeat read is cheap', async () => {
    const { designRoot } = seed();
    const get = handler(designRoot);
    const first = await (await get(QS)).text();
    const t = performance.now();
    const again = await (await get(QS)).text();
    const warm = performance.now() - t;
    expect(again).toBe(first);
    expect(warm).toBeLessThan(100);

    // the transcript is re-run: new words
    writeFileSync(
      join(designRoot, 'assets', 'bbbbbbbb.transcript.json'),
      transcript(B, [{ id: 'w0', t0: 1.0, t1: 1.4, text: 'tri' }], [[1.0, 1.4]])
    );
    const afterSidecar = (await (await get(QS)).json()) as { words: Array<{ text: string }> };
    expect(afterSidecar.words.map((w) => w.text)).toContain('tri');

    // the cut changes (trim 0): the same words move with no other write
    writeFileSync(
      join(designRoot, 'ui', 'Reel.tsx'),
      SOURCE.replace('trimBefore={30}', 'trimBefore={0}')
    );
    const afterCanvas = (await (await get(QS)).json()) as {
      words: Array<{ text: string; f0: number }>;
    };
    expect(afterCanvas.words.find((w) => w.text === 'jsem tu')?.f0).toBe(45);
  });

  test('a sidecar that is absent or unreadable is no transcript, not an error', async () => {
    const { designRoot } = seed();
    writeFileSync(join(designRoot, 'assets', 'aaaaaaaa.transcript.json'), '{ not json');
    const res = await handler(designRoot)(QS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { words: Array<{ text: string }> };
    expect(body.words.map((w) => w.text)).toEqual(['dva']);
  });
});

describe('GET /_api/comp-media — refusals', () => {
  test('400 without a canvas, for a bad artboard, outside the design root, or a runtime dir', async () => {
    const { designRoot } = seed();
    mkdirSync(join(designRoot, '_history'), { recursive: true });
    writeFileSync(join(designRoot, '_history', 'x.tsx'), 'export default 1');
    const get = handler(designRoot);
    expect((await get('artboard=reel')).status).toBe(400);
    expect((await get('canvas=.design/ui/Reel.tsx&artboard=a%2Fb')).status).toBe(400);
    expect((await get('canvas=../../etc/passwd.tsx')).status).toBe(400);
    expect((await get('canvas=.design/ui/Reel.html')).status).toBe(400);
    expect((await get('canvas=.design/_history/x.tsx')).status).toBe(400);
  });

  test('404 for a canvas that is not there; 422 for one that does not parse', async () => {
    const { designRoot } = seed();
    writeFileSync(join(designRoot, 'ui', 'Broken.tsx'), 'const = <<<');
    const get = handler(designRoot);
    expect((await get('canvas=.design/ui/Nope.tsx')).status).toBe(404);
    const broken = await get('canvas=.design/ui/Broken.tsx');
    expect(broken.status).toBe(422);
    expect(await broken.json()).toEqual({ error: 'canvas-unparseable' });
  });
});

describe('GET /_api/comp-media — roles (minimum role: Can comment)', () => {
  test('Can view is refused; Can comment, Can edit and the owner are served', async () => {
    const { designRoot } = seed();
    const get = handler(designRoot);
    const view = await get(QS, { v: 1, role: 'observer' });
    expect(view.status).toBe(403);
    expect(((await view.json()) as { error: string }).error).toBe('read-only');
    for (const role of ['viewer', 'member', 'owner'] as const)
      expect((await get(QS, { v: 1, role })).status).toBe(200);
  });

  test('a canvas-only session: served for a granted canvas, and ONE answer for ungranted and missing', async () => {
    const { designRoot } = seed();
    writeFileSync(join(designRoot, 'ui', 'Other.tsx'), SOURCE);
    const get = handler(designRoot);
    const claim = {
      v: 1 as const,
      role: null,
      grants: [{ c: 'ui/Reel.tsx', r: 'viewer' as const }],
    };
    expect((await get(QS, claim)).status).toBe(200);
    const ungranted = await get('canvas=.design/ui/Other.tsx', claim);
    const missing = await get('canvas=.design/ui/Nope.tsx', claim);
    expect(ungranted.status).toBe(403);
    expect(missing.status).toBe(ungranted.status);
    expect(await missing.text()).toBe(await ungranted.text());
    // a grant at Can view reads nothing (the transcript is Can comment and up)
    const obs = {
      v: 1 as const,
      role: null,
      grants: [{ c: 'ui/Reel.tsx', r: 'observer' as const }],
    };
    expect((await get(QS, obs)).status).toBe(403);
  });
});

const procs: Subprocess[] = [];
afterAll(async () => {
  for (const p of procs) await killProc(p);
});

async function canvasOriginOf(designRoot: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    try {
      const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8'));
      if (info.canvasOrigin) return info.canvasOrigin as string;
    } catch {
      /* not yet */
    }
    await Bun.sleep(50);
  }
  throw new Error('canvasOrigin never appeared in _server.json');
}

describe('a real studio', () => {
  test('the main origin serves it; the canvas origin answers 403 (V2-1.10 #15)', async () => {
    const { root, designRoot } = seed();
    const port = nextPort();
    const proc = await bootServer(root, port, { MAUDE_CANVAS_ORIGIN_SPLIT: '1' });
    procs.push(proc);
    const canvas = await canvasOriginOf(designRoot);
    const main = await fetch(`http://127.0.0.1:${port}${ROUTE}?${QS}`);
    expect(main.status).toBe(200);
    const body = (await main.json()) as { words: unknown[]; fps: number };
    expect(body.fps).toBe(30);
    expect(body.words).toHaveLength(3);
    const fromCanvas = await fetch(`${canvas}${ROUTE}?${QS}`, {
      signal: AbortSignal.timeout(3000),
    });
    expect(fromCanvas.status).toBe(403);
    // a rebound Host never reaches the handler either
    const rebound = await fetch(`http://127.0.0.1:${port}${ROUTE}?${QS}`, {
      headers: { host: 'evil.example' },
    });
    expect(rebound.status).toBe(403);
  }, 60_000);
});
