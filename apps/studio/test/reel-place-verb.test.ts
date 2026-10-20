// S7.14 — `maude design reel-place <edl-slug> --next` (V2-1.10 §5.7): one shot per call onto the canvas
// file (the AI's own write — the run stages it), exit 4 "All shots are placed" once the cut is on the video,
// usage errors for a call that is not one shot.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { clock, EXIT_ALL_PLACED, reelPlace } from '../bin/_reel-place.mjs';
import { UsageError } from '../bin/_studio-verb.mjs';
import { compClips } from '../video/derive.ts';
import { storylineByName } from '../video/reel-place.ts';

const ROOT = mkdtempSync(path.join(tmpdir(), 'reel-place-verb-'));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
const DESIGN = path.join(ROOT, '.design');
mkdirSync(path.join(DESIGN, 'ui'), { recursive: true });
writeFileSync(path.join(DESIGN, 'config.json'), '{}');
const CANVAS = path.join(DESIGN, 'ui', 'Recap.tsx');
writeFileSync(
  CANVAS,
  [
    "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
    "import { AbsoluteFill } from 'remotion';",
    'const Recap = () => (',
    "  <AbsoluteFill style={{ background: '#000' }}>",
    '  </AbsoluteFill>',
    ');',
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
  path.join(DESIGN, 'recap.edl.json'),
  JSON.stringify({
    version: 1,
    fps: 30,
    beats: Array.from({ length: 14 }, (_, i) => ({
      clip: `assets/caaf${String(i).padStart(4, '0')}.mp4`,
      startSec: 3 + i * 0.5,
      durationFrames: 45,
      name: i === 6 ? 'Tackle 2' : `Shot ${i + 1}`,
      transition: i % 2 ? { presentation: 'fade', frames: 6 } : null,
    })),
  })
);

function io() {
  let out = '';
  let err = '';
  return {
    o: {
      out: {
        write: (s: string) => {
          out += s;
        },
      },
      err: {
        write: (s: string) => {
          err += s;
        },
      },
    },
    text: () => ({ out, err }),
  };
}
const ARGS = ['recap', '--next', '--canvas', 'ui/Recap.tsx#recap', '--root', ROOT];
const placedNames = () => [
  ...storylineByName(compClips(CANVAS, readFileSync(CANVAS, 'utf8'), 'recap')).keys(),
];

describe('reel-place --next', () => {
  test('× 7 places shots 1–7 one write each, saying which shot landed', async () => {
    let last = '';
    for (let i = 0; i < 7; i++) {
      const t = io();
      expect(await reelPlace(ARGS, t.o)).toBe(0);
      expect(placedNames().length).toBe(i + 1);
      last = t.text().out;
    }
    expect(last).toBe('Placed shot 7 of 14 · Tackle 2 — caaf0006, 0:06–0:07.5\n');
  });

  test('× 7 more, then exit 4 "All shots are placed"', async () => {
    for (let i = 0; i < 7; i++) expect(await reelPlace(ARGS, io().o)).toBe(0);
    expect(placedNames().length).toBe(14);
    const t = io();
    const before = readFileSync(CANVAS, 'utf8');
    expect(await reelPlace(ARGS, t.o)).toBe(EXIT_ALL_PLACED);
    expect(t.text().out).toBe('All shots are placed — 14 of 14.\n');
    expect(readFileSync(CANVAS, 'utf8')).toBe(before); // nothing written
    const j = io();
    expect(await reelPlace([...ARGS, '--json'], j.o)).toBe(EXIT_ALL_PLACED);
    expect(JSON.parse(j.text().out)).toEqual({ status: 'all-placed', placed: 14, total: 14 });
  });

  test('a call that is not one shot is a usage error; a missing cut is a refusal', async () => {
    await expect(reelPlace(['recap', '--root', ROOT], io().o)).rejects.toBeInstanceOf(UsageError);
    await expect(reelPlace(['../x', '--next', '--root', ROOT], io().o)).rejects.toBeInstanceOf(
      UsageError
    );
    await expect(reelPlace([...ARGS, '--provider', 'x'], io().o)).rejects.toBeInstanceOf(
      UsageError
    );
    const t = io();
    expect(
      await reelPlace(['nope', '--next', '--canvas', 'ui/Recap.tsx#recap', '--root', ROOT], t.o)
    ).toBe(1);
    expect(t.text().err).toContain('there is no cut nope');
  });

  test('clock words', () => {
    expect([clock(3), clock(4.5), clock(11.5), clock(71.25)]).toEqual([
      '0:03',
      '0:04.5',
      '0:11.5',
      '1:11.3',
    ]);
  });
});
