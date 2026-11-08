import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { type Answer, type Cell, cellOrNull, eventually, read } from '../helpers/cell-peers';
import { dismissNotices } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { TINY_MP4 } from '../helpers/fixture-media';
import { artboardLabelPoint, pointerClick } from '../helpers/pointer';
import { selectUntilIsland } from '../helpers/select-artboard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';
import { pinCurrentWindow } from '../helpers/windows';

/**
 * 07 Video Editing · ve-footage — footage another person's Mac holds says so, quietly (T2.6c, issue #172).
 *
 * The hub-presence half, which needs no second Mac: the cell is asked "who has this file?" and the answer is alice's
 * device, reported the way her studio's own sweep reports it (`POST <cell>/_asset-probe`, held), while her studio is
 * stopped (SIGSTOP) so nothing takes the report back. Bob's copy is the app under test and has no bytes for the clip.
 *
 *   waiting   the clip's block in the Timeline is named "… · waiting for Alice's device"; the clip Inspector's footage
 *             block (`insp-footage`, `data-state="waiting"`) says File · Status "Waiting for Alice's device" and "Your edit
 *             is safe. It plays once the file arrives."; it offers no Relink… (waiting is not missing)
 *   missing   a clip NO device holds says "Missing — no device has it" (or "Not here yet" when the cell is not sure), in
 *             the same block, and never in the waiting words
 *   arrives   the file lands on this Mac (written to the project's assets) → the block goes by itself: no reload, no click
 *
 * Why not the origin-split lane: selecting the video artboard needs a click INSIDE the canvas frame, which is
 * unreachable by DOM when the canvas is on another origin. The conf (wdio.ve-footage.conf.ts) therefore turns the split
 * OFF for the app under test — which also turns TSX sync off for bob, so he writes the canvas on his own disk and does
 * not rely on alice's canvases reaching him. The file plane (what asset-state asks the cell) is unaffected.
 *
 * Preconditions: the cell lane (Node 24 for the hub, a built test app, a stub `claude`). The clip's bytes for the
 * "arrives" step are `apps/studio/test/fixtures/tiny.mp4` (in the repo). WRITTEN, NOT RUN in the T2.6c hand-back — the
 * lead runs it once, alone; if step 1 never sees `waiting` with the split off, the cell must be asked to sync first and
 * the conf's override needs revisiting (see the hand-back).
 */
const tid = (s: string) => `[data-testid="${s}"]`;

const HELD = 'assets/dd02ee03.mp4'; // alice's device holds it, the cell has no bytes
const NOBODY = 'assets/dd02ee04.mp4'; // no device holds it
const SOURCE = `import { DesignCanvas, DCSection, DCArtboard, VideoComp } from "@maude/canvas-lib";
import { AbsoluteFill, OffthreadVideo } from "remotion";
import { TransitionSeries } from "@remotion/transitions";

const Comp = () => (
  <AbsoluteFill style={{ background: "#101014" }}>
    <TransitionSeries>
      <TransitionSeries.Sequence name="dron" durationInFrames={60}>
        <OffthreadVideo src="${HELD}" muted />
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence name="noc" durationInFrames={60}>
        <OffthreadVideo src="${NOBODY}" muted />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);

export default function Footage() {
  return (
    <DesignCanvas>
      <DCSection id="clip" title="Footage">
        <DCArtboard id="reel" kind="video" label="Reel · 320×180" width={320} height={180}>
          <VideoComp component={Comp} durationInFrames={120} fps={30} width={320} height={180} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

const CELL = cellOrNull();
let aliceHeld = false;

async function bobAssetState(rel: string): Promise<Answer> {
  return (await browser.execute(
    (r: string) =>
      fetch(`/_api/asset-state?rel=${encodeURIComponent(r)}`, { cache: 'no-store' }).then(
        async (res) => ({ status: res.status, body: await res.json().catch(() => null) })
      ),
    rel
  )) as Answer;
}

async function box(artboard: string) {
  return browser.execute((id) => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="canvas-frame"]');
    const win = frame?.contentWindow as Window | null | undefined;
    if (!frame || !win) return null;
    const f = frame.getBoundingClientRect();
    try {
      const el = win.document.querySelector(`[data-dc-screen="${id}"]`);
      const r = el?.getBoundingClientRect();
      return r ? { x: f.left + r.left, y: f.top + r.top, w: r.width, h: r.height } : null;
    } catch {
      return null;
    }
  }, artboard) as Promise<{ x: number; y: number; w: number; h: number } | null>;
}

describe('ve-footage (native-desktop) — footage on another device waits quietly; it is not missing', () => {
  before(async function () {
    if (!CELL) this.skip();
    startReport(
      've-footage (native-desktop) — a clip alice’s device holds, in bob’s Timeline and Inspector'
    );
    await browser.setTimeout({ script: 60_000 });
    await pinCurrentWindow().catch((error: unknown) =>
      console.warn(`[ve-footage] window pin failed: ${String(error)}`)
    );
  });

  after(() => {
    const c = CELL;
    if (c) {
      try {
        process.kill(c.teammatePid, 'SIGCONT');
      } catch {
        /* gone */
      }
      rmSync(join(c.designer, '.design', HELD), { force: true });
    }
  });

  it('1 · alice’s device holds the clip: the cell says waiting, with her name, never missing', async () => {
    const c = CELL as Cell;
    await waitForSidecar();
    mkdirSync(join(c.designer, '.design', 'ui'), { recursive: true });
    writeFileSync(join(c.designer, '.design', 'ui', 'footage.tsx'), SOURCE);

    // alice's device is away from now on: held, so her own sweep cannot take the report back
    try {
      process.kill(c.teammatePid, 'SIGSTOP');
      aliceHeld = true;
    } catch {
      /* already held */
    }
    const hubs = JSON.parse(
      read(join(dirname(c.teammate), 'teammate-cfg', 'hubs.json')) ?? '{}'
    ) as { hubs?: Record<string, { token?: string }> };
    const token = hubs.hubs?.[c.hub]?.token;
    expect(typeof token).toBe('string');
    const report = await fetch(`${c.hub}/_asset-probe`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        paths: [HELD],
        held: true,
        sweep: { id: 'e2e-alice-footage', final: true },
      }),
    });
    expect(report.status).toBe(200);
    expect(((await report.json()) as { present: string[] }).present).toEqual([]); // the cell has no bytes

    let answer: Answer = { status: 0, body: null };
    await eventually(
      'the studio’s asset-state says waiting',
      async () => {
        answer = await bobAssetState(HELD);
        const item = (answer.body?.items ?? [])[0];
        return item?.state === 'waiting' && !!item?.who;
      },
      120_000
    );
    const item = answer.body.items[0];
    expect(String(item.who.name).toLowerCase()).toBe('alice');
    expect(String(item.who.name)).not.toContain('@'); // a name, never an address
    expect(aliceHeld).toBe(true);
  });

  it('2 · the Timeline names the waiting clip; the clip Inspector’s footage block is quiet — no Relink…', async () => {
    await (await canvasRow('canvas-row-ui-footage')).click();
    await waitForCanvasRects();
    await dismissNotices();
    // the artboard's name strip selects the whole artboard; found by its rectangle, pressed by coordinates
    const at = await artboardLabelPoint('reel');
    if (at) await pointerClick(at.x, at.y);
    await selectUntilIsland(
      async () => {
        const b = await box('reel');
        return b ? { x: b.x, y: b.y } : null;
      },
      (x, y) => pointerClick(x, y)
    );
    await $(tid('timeline-island')).waitForExist({ timeout: 20_000 });
    await dismissNotices();
    const first = await $(tid('timeline-seq-0'));
    await first.waitForExist({ timeout: 20_000 });
    // the clip's drawn name carries the state: "dron · waiting for Alice's device"
    await browser.waitUntil(
      async () =>
        // the state is in the drawn name (the block's text) and its description; the aria-label is the name + times only
        /waiting for alice.s device/i.test(
          `${await first.getText()} ${(await first.getAttribute('aria-description')) ?? ''}`
        ),
      {
        timeout: 60_000,
        interval: 500,
        timeoutMsg: 'the clip block never named the device it waits for',
      }
    );
    await first.click();
    await $('[data-testid="inspector-frame"][data-kind="clip"]').waitForExist({ timeout: 10_000 });
    const block = await $(tid('insp-footage'));
    await block.waitForExist({
      timeout: 20_000,
      timeoutMsg: 'no footage block for a clip another device holds',
    });
    expect(await block.getAttribute('data-state')).toBe('waiting');
    expect((await (await $(tid('insp-footage-file'))).getText()).trim()).toBe('dd02ee03.mp4');
    expect((await (await $(tid('insp-footage-status'))).getText()).trim()).toMatch(
      /^Waiting for alice.s device$/i
    );
    expect((await (await $(tid('insp-footage-note'))).getText()).trim()).toBe(
      'Your edit is safe. It plays once the file arrives.'
    );
    // waiting is not missing: no verb is offered, the file arrives by itself
    expect(await $(tid('asset-absent-relink')).isExisting()).toBe(false);
    await capture('01-footage-waiting');
  });

  it('3 · a clip no device holds is Missing — in its own words, never the waiting ones', async () => {
    await (await $(tid('timeline-seq-1'))).click();
    const block = await $(tid('insp-footage'));
    await browser.waitUntil(
      async () =>
        /dd02ee04/.test(await (await $(tid('insp-footage-file'))).getText().catch(() => '')),
      {
        timeout: 20_000,
        interval: 300,
        timeoutMsg: 'the second clip never filled the footage block',
      }
    );
    // The hub turns a path Missing only once every device SWEPT AFTER the first ask for it (hub asset-presence.mjs): alice's
    // sweep in step 1 predates bob's first ask for this clip and her studio is held, so until she sweeps again the honest
    // answer is the quiet "Not here yet". Let her finish one more sweep (no bytes for it), then wait for the studio to ask again.
    const c = CELL as Cell;
    const hubs = JSON.parse(
      read(join(dirname(c.teammate), 'teammate-cfg', 'hubs.json')) ?? '{}'
    ) as { hubs?: Record<string, { token?: string }> };
    const sweep = await fetch(`${c.hub}/_asset-probe`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${hubs.hubs?.[c.hub]?.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        paths: [HELD],
        held: true,
        sweep: { id: 'e2e-alice-footage-2', final: true },
      }),
    });
    expect(sweep.status).toBe(200);
    const statusEl = await $(tid('insp-footage-status'));
    await browser.waitUntil(
      async () =>
        /^Missing — no device has it$/.test((await statusEl.getText().catch(() => '')).trim()),
      {
        timeout: 180_000,
        interval: 2_000,
        timeoutMsg: 'the clip no device holds never turned Missing after alice’s second sweep',
      }
    );
    const status = (await statusEl.getText()).trim();
    expect(status).not.toMatch(/waiting for/i);
    expect(await block.getAttribute('data-state')).not.toBe('waiting');
    await capture('02-footage-missing');
  });

  it('4 · the file arrives on this Mac: the waiting goes by itself', async () => {
    const c = CELL as Cell;
    await (await $(tid('timeline-seq-0'))).click();
    await $(tid('insp-footage')).waitForExist({ timeout: 20_000 });
    mkdirSync(join(c.designer, '.design', 'assets'), { recursive: true });
    copyFileSync(TINY_MP4, join(c.designer, '.design', HELD));
    await $(tid('insp-footage')).waitForExist({
      reverse: true,
      timeout: 120_000,
      timeoutMsg: 'the footage block stayed after the file arrived',
    });
    await capture('03-footage-arrived');
  });
});
