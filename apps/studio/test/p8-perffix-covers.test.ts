// P8 perf fix (V2-8.14): a canvas whose module the frame gate refuses — the Alligators `kind="web"`
// canvases import a `_frames.tsx` that renders DesignCanvas, so the closure (c4j) refuses them for
// every opener — used to wait the full 20 s for `#canvas-root` and was retried to the failure cap:
// ~170 s of a 206 s cold cover sweep for 8 canvases. The shell already writes the refusal into
// `#canvas-mount-error`; the renderer now reads it and fails at once, and the service does not
// retry a canvas that cannot mount (its key changes when the source does, and that is the retry).

import { afterAll, describe, expect, test } from 'bun:test';

import { pidOf } from '../index/snapshot.ts';
import { createThumbService, spawnRendererShim, type ThumbService } from '../thumbs/service.ts';
import { makeSandbox } from './_helpers.ts';
import { fakeJpeg, fakeShim } from './_thumbs-fake.ts';
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

const TWO = (n: number) => `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
export default function C${n}() {
  return (<DesignCanvas><DCSection id="s" title="S">
    <DCArtboard id="a" label="A" width={960} height={600}><div>${n}a</div></DCArtboard>
    <DCArtboard id="b" label="B" width={960} height={600}><div>${n}b</div></DCArtboard>
  </DCSection></DesignCanvas>);
}
`;

function slowService(files: Record<string, string>, delayMs: number) {
  const { root, designRoot } = makeSandbox();
  writeFiles(designRoot, files);
  const sent: Array<Record<string, unknown>> = [];
  let inflight = 0;
  let peak = 0;
  const starts: number[] = [];
  const spawnShim = () => {
    const listeners: Array<(m: Record<string, unknown>) => void> = [];
    return {
      send(msg: Record<string, unknown>) {
        sent.push(msg);
        inflight++;
        starts.push(inflight);
        peak = Math.max(peak, inflight);
        setTimeout(() => {
          inflight--;
          const reply = {
            id: msg.id,
            ok: true,
            runtime: { artboards: [] },
            shots: [
              {
                target: 0,
                artboard: 'a',
                jpeg: Buffer.from(fakeJpeg(480, 300)).toString('base64'),
              },
            ],
          };
          for (const cb of listeners) cb(reply);
        }, delayMs);
      },
      onMessage: (cb: (m: Record<string, unknown>) => void) => listeners.push(cb),
      exited: new Promise<number>(() => {}),
      kill() {},
    };
  };
  const svc = createThumbService({
    pid: pidOf(root),
    designRoot,
    index: indexFor(root, designRoot),
    config: () => ({ theme: 'dark' }),
    serverOrigin: () => 'http://localhost:1',
    captureOrigin: () => 'http://localhost:2',
    spawnShim,
  });
  stoppers.push(() => svc.stop());
  return { svc, sent, peak: () => peak, starts: () => starts };
}

describe('the cover sweep (P8 perf fix, V2-8.14 covers)', () => {
  test('a render is told how many artboards the index knows, so it can stop waiting at that count', async () => {
    const { svc, sent } = slowService({ 'ui/two.tsx': TWO(1) }, 5);
    await svc.thumb({ canvas: 'ui/two.tsx', artboard: null, size: 'card', priority: 'visible' });
    await svc.idle();
    expect(sent[0]?.knownArtboards).toBe(2);
  });

  test('background covers render two at a time, not one', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 8; i++) files[`ui/c${i}.tsx`] = TWO(i);
    const { svc, peak } = slowService(files, 40);
    await Promise.all(
      Object.keys(files).map((canvas) =>
        svc.thumb({ canvas, artboard: null, size: 'card', priority: 'background' })
      )
    );
    await svc.idle();
    expect(peak()).toBe(2);
  });

  test('the sweep renders the first screen of covers on every page', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 20; i++) files[`ui/c${String(i).padStart(2, '0')}.tsx`] = TWO(i);
    const { svc, peak, starts } = slowService(files, 40);
    await svc.startBackground();
    await svc.idle();
    expect(peak()).toBe(4);
    expect(starts().length).toBe(20);
  });

  test('the real renderer does not sleep out the artboard-count settle when the count is known', async () => {
    const replies: Array<Record<string, unknown>> = [];
    const r = await rig(() => ({ 'ui/two.tsx': TWO(2) }), {
      service: {
        spawnShim: () => {
          const h = spawnRendererShim();
          h.onMessage((m) => replies.push(m));
          return h;
        },
      },
    });
    stoppers.push(() => {
      r.svc.stop();
      r.proc.kill();
    });
    const res = await settle(r.svc, {
      canvas: 'ui/two.tsx',
      artboard: null,
      size: 'card',
      priority: 'visible',
    });
    expect(res.status).toBe('ready');
    const phases = replies.find((m) => m.phases)?.phases as Record<string, number> | undefined;
    expect(phases).toBeDefined();
    expect(phases?.settle ?? 9999).toBeLessThan(200);
  }, 60_000);
});
