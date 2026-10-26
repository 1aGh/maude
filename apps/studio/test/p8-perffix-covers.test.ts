// P8 perf fix (V2-8.14): a canvas whose module the frame gate refuses — the Alligators `kind="web"`
// canvases import a `_frames.tsx` that renders DesignCanvas, so the closure (c4j) refuses them for
// every opener — used to wait the full 20 s for `#canvas-root` and was retried to the failure cap:
// ~170 s of a 206 s cold cover sweep for 8 canvases. The shell already writes the refusal into
// `#canvas-mount-error`; the renderer now reads it and fails at once, and the service does not
// retry a canvas that cannot mount (its key changes when the source does, and that is the retry).

import { afterAll, describe, expect, test } from 'bun:test';

import { pidOf } from '../index/snapshot.ts';
import { createThumbService, type ThumbService } from '../thumbs/service.ts';
import { makeSandbox } from './_helpers.ts';
import { fakeShim } from './_thumbs-fake.ts';
import { indexFor, rig, settle, writeFiles } from './_thumbs-helpers.ts';

const COVER = { canvas: 'ui/web.tsx', artboard: null, size: 'card', priority: 'visible' } as const;

const FRAMES = `import React from 'react';
import { DesignCanvas } from '@maude/canvas-lib';
export function Frames({ children }: { children: React.ReactNode }) {
  return <DesignCanvas>{children}</DesignCanvas>;
}
`;
const WEB = `import React from 'react';
import { DCSection, DCArtboard } from '@maude/canvas-lib';
import { Frames } from './_frames';
export default function Web() {
  return (<Frames><DCSection id="s" title="S">
    <DCArtboard id="one" label="One" width={960} height={600} kind="web"><div>web</div></DCArtboard>
  </DCSection></Frames>);
}
`;

const stoppers: Array<() => void> = [];
afterAll(() => {
  for (const s of stoppers) s();
});

describe('a canvas that cannot mount (P8 perf fix, V2-8.14 covers)', () => {
  test('a refused mount is not retried: one render, then unavailable until the source changes', async () => {
    const { root, designRoot } = makeSandbox();
    writeFiles(designRoot, { 'ui/web.tsx': WEB, 'ui/_frames.tsx': FRAMES });
    const shim = fakeShim(() => ({
      ok: false,
      error: 'canvas-failed',
      detail: 'HTTP 403 — not-in-scope',
    }));
    const svc: ThumbService = createThumbService({
      pid: pidOf(root),
      designRoot,
      index: indexFor(root, designRoot),
      config: () => ({ theme: 'dark' }),
      serverOrigin: () => 'http://localhost:1',
      captureOrigin: () => 'http://localhost:2',
      spawnShim: shim.handle,
    });
    stoppers.push(() => svc.stop());
    for (let i = 0; i < 6; i++) {
      await svc.thumb(COVER);
      await svc.idle();
    }
    expect(shim.sent.length).toBe(1);
    expect(await svc.thumb(COVER)).toEqual({ status: 'unavailable', reason: 'failed' });
  });

  test('the real renderer reports the refusal in seconds, not after the 20 s mount wait', async () => {
    const r = await rig(() => ({ 'ui/web.tsx': WEB, 'ui/_frames.tsx': FRAMES }));
    stoppers.push(() => {
      r.svc.stop();
      r.proc.kill();
    });
    const t0 = performance.now();
    const res = await settle(r.svc, COVER);
    const took = performance.now() - t0;
    expect(res).toEqual({ status: 'unavailable', reason: 'failed' });
    expect(took).toBeLessThan(10_000);
  }, 120_000);
});
