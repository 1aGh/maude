// export-parity-video — #150 §4 / #128 §8 (T3.3), the node half.
//
// The capture shim prints one summary line; when the one-pass renderer drew the file it carries the
// pre-render parity scan. The video adapter turns that into a warning on the existing
// `ExportDegradation` channel and keeps it BESIDE whatever else is wrong with the file (a muted
// mp4), without ever hiding the audio backstop. Also: the render worker's note crosses the HTTP
// boundary through `safeDegradation` (pinned in export-lane.test.ts), and the job row has words for it.

import { afterAll, describe, expect, mock, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// index.ts first: it registers every adapter, and video.ts <-> index.ts is a circular import
await import('../exporters/index.ts');
const real = await import('../exporters/_runtime.ts');
const realBundles = await import('../exporters/_browser-bundles.ts');
let summary: Record<string, unknown> = {};
let wroteArgs: string[] = [];

mock.module('../exporters/_browser-bundles.ts', () => ({
  ...realBundles,
  getEncodeLibBundle: async () => '/dev/null',
  getWebRendererBundle: async () => '/dev/null',
}));
mock.module('../exporters/_runtime.ts', () => ({
  ...real,
  runShim: async (args: string[]) => {
    wroteArgs = args;
    // the shim writes the file where `--out` says, then prints its summary line
    writeFileSync(args[args.indexOf('--out') + 1], new Uint8Array([0, 0, 0, 24, 0x66, 0x74]));
    return [JSON.stringify({ container: 'mp4', fps: 12, frameCount: 12, ...summary })];
  },
}));

afterAll(() => {
  mock.restore();
});

const CTX = {
  designRoot: '/abs/proj/.design',
  repoRoot: '/abs/proj',
  serverOrigin: 'http://localhost:4399',
};
const TARGETS = [
  {
    kind: 'element',
    file: '.design/ui/reel.tsx',
    cssPath: '[data-dc-screen="clip"]',
    canvasSlug: 'reel',
  },
] as never;

const PARITY = {
  artboard: 'clip',
  findings: [{ feature: 'bg-url', elements: ['div.camo'], count: 1 }],
};

async function runMp4(options: Record<string, unknown> = { audio: false }) {
  const { mp4 } = await import('../exporters/video.ts');
  return mp4.run(TARGETS, options as never, CTX as never);
}

describe('the video adapter reads the shim summary', () => {
  test('a parity scan in the summary becomes a warning that names artboard and element', async () => {
    summary = { parity: PARITY };
    const res = await runMp4();
    expect(res.body.length).toBeGreaterThan(0); // the file is still the file
    expect(res.degraded?.audioDropped).toBeUndefined();
    expect(res.degraded?.unsupportedFeatures).toEqual([
      'a background-image url() is not drawn — div.camo',
    ]);
    expect(res.degraded?.reason).toContain('Artboard "clip"');
    expect(res.degraded?.reason).toContain('div.camo');
    expect(wroteArgs.length).toBeGreaterThan(0);
  });

  test('no parity in the summary → a clean export stays clean', async () => {
    summary = {};
    expect((await runMp4()).degraded).toBeUndefined();
  });

  test('a garbage parity field is ignored, not trusted', async () => {
    summary = { parity: { artboard: 7, findings: [{ feature: '__proto__' }, 'x'] } };
    expect((await runMp4()).degraded).toBeUndefined();
  });

  test('beside a frame-step fallback: both the muted file and the warning survive', async () => {
    summary = {
      degraded: true,
      audioDropped: true,
      fallbackReason: 'Failed to convert SVG to image',
      parity: PARITY,
    };
    const d = (await runMp4({ audio: true })).degraded;
    expect(d?.audioDropped).toBe(true);
    expect(d?.unsupportedFeatures).toHaveLength(1);
    expect(d?.reason).toContain('Failed to convert SVG to image');
    expect(d?.remedy).toMatch(/svg/i); // the audio cause keeps its own remedy
  });

  test('the audio backstop still speaks when only a parity note is present', async () => {
    // the bytes have no audio track though audio was asked for — the parity note must not
    // make `degraded` truthy before that check runs
    summary = { parity: PARITY };
    const d = (await runMp4({ audio: true })).degraded;
    expect(d?.audioDropped).toBe(true);
    expect(d?.reason).toContain('no audio track');
    expect(d?.unsupportedFeatures).toHaveLength(1);
  });
});

describe('the Exports panel says it', () => {
  test('the pill is "check preview" and the row headline names the features', async () => {
    const { stateWord } = await import('../client/v2/export/exports-model.js');
    const parity = { unsupportedFeatures: ['mix-blend-mode is ignored — div.x'], reason: 'r' };
    expect(stateWord({ status: 'done', degraded: parity })).toBe('Ready · check preview');
    // every real loss still outranks it
    expect(stateWord({ status: 'done', degraded: { ...parity, audioDropped: true } })).toBe(
      'Ready · no audio'
    );
    const row = readFileSync(
      join(import.meta.dir, '..', 'client', 'v2', 'export', 'job-row.jsx'),
      'utf8'
    );
    expect(row).toContain('May not match the preview');
  });
});
