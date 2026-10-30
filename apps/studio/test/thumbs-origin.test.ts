// V2-2.17 — R1: thumbnails render only on the read-only capture origin (contract V2-1.17 §5.8,
// decision v2-2.8-read-only-capture-origin).
//
// The planted canvas probes at module evaluation, so the render cannot finish before every probe
// was answered, and reports the result through the one channel a picture has that a test can read
// without a JPEG decoder: its SIZE. Every probe refused → a 200 × 100 artboard; any probe let
// through → 300 × 100.
//
//   1. split on: the shim lands on the capture origin; a privileged read gets 403, a write is
//      refused, a cross-origin call to the main origin is blocked — the picture is 200 wide.
//   2. the second leg: if a render ever lands anywhere but the capture origin, the context has
//      aborted every request off that origin, so no canvas code runs at all (its write to the main
//      origin's ui-prefs never lands) and nothing is stored.
//   3. no capture origin (split off) → nothing renders: `no-engine`, no shim spawned.

import { afterAll, describe, expect, test } from 'bun:test';
import { killProc } from './_helpers.ts';
import { rig, settle, type ThumbRig } from './_thumbs-helpers.ts';

const probeCanvas = (
  main: string
) => `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

async function status(path: string, init?: RequestInit): Promise<number> {
  try {
    return (await fetch(path, init)).status;
  } catch {
    return 0;
  }
}
const read = await status("/_api/ui-prefs");
const write = await status("/_api/ui-prefs", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ theme: "light", minimap: true }),
});
const cross = await status(${JSON.stringify(`${main}/_api/ui-prefs`)});
const index = await status("/_api/index");
const denied = [read, write, cross, index].every((s) => s !== 200);

export default function Probe() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="Probe">
        <DCArtboard id="probe" label="Probe" width={denied ? 200 : 300} height={100}>
          <div style={{ background: "#204060", height: "100%" }} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

const rigs: ThumbRig[] = [];
afterAll(async () => {
  for (const r of rigs) {
    r.svc.stop();
    await killProc(r.proc);
  }
});

const COVER = {
  canvas: 'ui/Probe.tsx',
  artboard: null,
  size: 'card',
  priority: 'visible',
} as const;

describe('R1 — renders land only on the capture origin (V2-2.17)', () => {
  test('split on: the render lands on the capture origin and every privileged probe is refused', async () => {
    const r = await rig((main) => ({ 'ui/Probe.tsx': probeCanvas(main) }));
    rigs.push(r);
    expect(r.capture).not.toBeNull();
    expect(r.capture).not.toBe(r.main);
    const res = await settle(r.svc, COVER);
    expect(res.status).toBe('ready');
    if (res.status !== 'ready') return;
    // ≈ 200 wide (+ the artboard's border) = read 403, write refused, cross-origin blocked,
    // index 403; ≈ 300 had any probe been answered 200
    expect(res.w).toBeGreaterThan(190);
    expect(res.w).toBeLessThan(250);
    const prefs = await (await fetch(`${r.main}/_api/ui-prefs`)).json();
    expect(prefs.minimap === true && prefs.theme === 'light').toBe(false);
  }, 60_000);

  test('a render that does not land on the capture origin runs no canvas code and stores nothing', async () => {
    // split off: the main origin serves the shell itself. Hand the service a "capture origin" the
    // render will never reach — exactly what a broken redirect would look like to the shim.
    const r = await rig((main) => ({ 'ui/Probe.tsx': probeCanvas(main) }), {
      env: { MAUDE_CANVAS_ORIGIN_SPLIT: '0' },
      service: { captureOrigin: () => 'http://127.0.0.1:9' },
    });
    rigs.push(r);
    expect(r.capture).toBeNull();
    const before = await (await fetch(`${r.main}/_api/ui-prefs`)).json();
    const res = await settle(r.svc, COVER);
    expect(res).toEqual({ status: 'unavailable', reason: 'failed' });
    const after = await (await fetch(`${r.main}/_api/ui-prefs`)).json();
    // the canvas's same-origin write would land on the main origin if any of its code had run
    expect(after).toEqual(before);
  }, 60_000);

  test('no capture origin: nothing renders and no renderer is started', async () => {
    let spawned = 0;
    const r = await rig((main) => ({ 'ui/Probe.tsx': probeCanvas(main) }), {
      env: { MAUDE_CANVAS_ORIGIN_SPLIT: '0' },
      service: {
        spawnShim: () => {
          spawned++;
          throw new Error('no renderer may start without a capture origin');
        },
      },
    });
    rigs.push(r);
    expect(await r.svc.thumb(COVER)).toEqual({ status: 'unavailable', reason: 'no-engine' });
    await r.svc.idle();
    expect(spawned).toBe(0);
  }, 30_000);
});
