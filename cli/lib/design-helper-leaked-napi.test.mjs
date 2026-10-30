// p8-t-video-2 — a design helper must not inherit the compiled server's private oxc binding path.
//
// The compiled `maude-server` sets NAPI_RS_NATIVE_LIBRARY_PATH to `/$bunfs/root/parser.<slug>-<hash>.node`
// (DDR-042) — a path that exists only inside that binary. A sidecar from before p8-t-video-2 handed it to
// every child: the ACP agent, its `claude`, the AI's Bash, `maude design reel-place` and the `bun` it runs.
// oxc-parser's loader then tries ONLY that path, so every parse-reaching verb the AI ran in the packaged app
// died with "Cannot find native binding". The server no longer leaks it (build.ts writeCompileEntry,
// test/compile-entry.test.ts); the dispatcher also drops a virtual one, so a helper never depends on what
// its parent leaked. The same check runs against the built .app in check-bundle-completeness --smoke.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MAUDE = join(REPO, 'cli/bin/maude.mjs');
const ROOT = mkdtempSync(join(tmpdir(), 'leaked-napi-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));

const DESIGN = join(ROOT, '.design');
mkdirSync(join(DESIGN, 'ui'), { recursive: true });
writeFileSync(join(DESIGN, 'config.json'), '{}');
const CANVAS = join(DESIGN, 'ui', 'recap.tsx');
writeFileSync(
  CANVAS,
  [
    "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
    "import { AbsoluteFill } from 'remotion';",
    "const Recap = () => <AbsoluteFill style={{ background: '#000' }}></AbsoluteFill>;",
    'export default function Canvas() {',
    '  return (',
    '    <DesignCanvas>',
    '      <DCArtboard id="recap" kind="video" width={1080} height={1920}>',
    '        <VideoComp component={Recap} durationInFrames={900} fps={30} width={1080} height={1920} />',
    '      </DCArtboard>',
    '    </DesignCanvas>',
    '  );',
    '}',
    '',
  ].join('\n')
);
writeFileSync(
  join(DESIGN, 'recap.edl.json'),
  JSON.stringify({
    version: 1,
    fps: 30,
    beats: [
      {
        clip: 'assets/caaf0000.mp4',
        startSec: 3,
        durationFrames: 45,
        name: 'Shot 1',
        transition: null,
      },
    ],
  })
);

test('reel-place places a shot when the parent leaked the compiled server’s /$bunfs oxc binding path', () => {
  const r = spawnSync(
    process.execPath,
    [MAUDE, 'design', 'reel-place', 'recap', '--next', '--root', ROOT],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        NO_OPEN: '1',
        MAUDE_NO_AUTOBUILD: '1',
        NAPI_RS_NATIVE_LIBRARY_PATH: '/$bunfs/root/parser.darwin-arm64-3x28d8cw.node',
      },
      timeout: 60_000,
    }
  );
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /Cannot find native binding/);
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /^Placed shot 1 of 1 · Shot 1/);
  assert.match(readFileSync(CANVAS, 'utf8'), /TransitionSeries\.Sequence/);
});
