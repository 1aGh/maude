import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { waitForArtboard } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { pointerClick } from '../helpers/pointer';
import { selectUntilIsland } from '../helpers/select-artboard';
import { readServerInfo, waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 07 Video Editing — the AI cut, shot by shot, and Stop (S7.14: ve-ai-scrub, ve-ai-proposal; V2-1.10 §7 "AI cut").
 *
 *   run      a Claude Code run scoped to the video (the hook route `POST /_api/agent/run/begin`, what a terminal
 *            Claude Code's plugin hook sends) — NO model is called: the test plays the agent and runs the verb
 *   place    `maude design reel-place video-ai-cut --next` × 7 (the verb's own bin, against this project),
 *            each call inside the window the plugin hook opens for it (`POST /_api/agent/bash/window`,
 *            PreToolUse open / PostToolUse close): a terminal verb names no chat, so it cannot claim its
 *            bytes, and since p8-a1-claims every run is claim-only — an unclaimed write outside such a
 *            window is the person's (decision `maude/v2-p8-a1-claims-bytes-not-time`)
 *            → each shot lands live: the ring reads "AI is cutting · N of 14", the timeline chip "AI is cutting",
 *            the AI edge moves while YOUR playhead stays where you scrubbed it
 *   stop     Stop → ONE published action holding 7 shots; the chip reads "Placed 7 of 14 shots." + Keep going
 *   undo     ⌘Z → all 7 go in one step: the canvas bytes are the empty video again
 *
 * The canvas + cut are written by this spec (and removed after) so the shared fixture project keeps its canvas
 * count. The artboard is inside the canvas iframe, so it is clicked BY COORDINATES (video-music's helpers).
 *
 * WRITTEN, NOT RUN in the S7.14 hand-back (the lead runs the desktop lane: an unlocked screen and the e2e lock).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.MAUDE_PROJECT_ROOT ?? join(HERE, '../fixtures/project');
const DESIGN = join(ROOT, '.design');
const CANVAS = join(DESIGN, 'ui', 'VideoAiCut.tsx');
const EDL = join(DESIGN, 'video-ai-cut.edl.json');
const REEL_PLACE = join(HERE, '../../../studio/bin/_reel-place.mjs');

const EMPTY = [
  "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
  "import { AbsoluteFill } from 'remotion';",
  '',
  'const Recap = () => (',
  "  <AbsoluteFill style={{ background: '#000' }}>",
  '  </AbsoluteFill>',
  ');',
  '',
  'export default function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="recap" kind="video" label="Recap · Reels" width={1080} height={1920}>',
  '        <VideoComp component={Recap} durationInFrames={900} fps={30} width={1080} height={1920} />',
  '      </DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
  '',
].join('\n');

const onDisk = () => readFileSync(CANVAS, 'utf8');
const base = () => readServerInfo(ROOT).url.replace(/\/$/, '');
const post = async (route: string, body: unknown) => {
  const r = await fetch(`${base()}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
/**
 * What the design hook sends around a terminal-lane verb call (cli/lib/design-hook.mjs `bashWindow`):
 * the canvases its command names (`namedDesignFiles`: `--canvas ui/VideoAiCut.tsx#recap`).
 */
const bashWindow = async (call: number, open: boolean) => {
  const r = await post('/_api/agent/bash/window', {
    session: 'e2e-ai-cut',
    toolUseId: `toolu_e2e_cut_${call}`,
    open,
    files: ['ui/VideoAiCut.tsx'],
  });
  expect(r.status).toBe(200);
  expect(r.body?.window).toBe(true);
};
const placeNextRaw = () =>
  spawnSync(
    'bun',
    [
      'run',
      REEL_PLACE,
      'video-ai-cut',
      '--next',
      '--canvas',
      'ui/VideoAiCut.tsx#recap',
      '--root',
      ROOT,
    ],
    { encoding: 'utf8', env: { ...process.env, NO_OPEN: '1' } }
  );
/** One agent Bash call: the hook's PreToolUse window, the verb, the hook's PostToolUse close. */
const placeNext = async (call: number) => {
  await bashWindow(call, true);
  try {
    return placeNextRaw();
  } finally {
    await bashWindow(call, false);
  }
};

type Box = { x: number; y: number; w: number; h: number };
async function artboardBox(id: string): Promise<Box | null> {
  return browser.execute((artboard) => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="canvas-frame"]');
    const win = frame?.contentWindow as Window | null | undefined;
    if (!frame || !win) return null;
    const f = frame.getBoundingClientRect();
    try {
      const el = win.document.querySelector(`[data-dc-screen="${artboard}"]`);
      const r = el?.getBoundingClientRect();
      return r ? { x: f.left + r.left, y: f.top + r.top, w: r.width, h: r.height } : null;
    } catch {
      return null;
    }
  }, id) as Promise<Box | null>;
}
async function clickAt(x: number, y: number): Promise<void> {
  await pointerClick(x, y);
}
const key = (init: Record<string, unknown>) =>
  browser.execute((k) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...k }));
  }, init);
const text = async (testid: string) =>
  (await (await $(`[data-testid="${testid}"]`)).getText()).trim();

describe('video-ai-cut-stop — reel-place × 7, Stop, one action, one ⌘Z', () => {
  let runId = '';
  before(() => {
    startReport('video-ai-cut-stop');
    writeFileSync(CANVAS, EMPTY);
    writeFileSync(
      EDL,
      JSON.stringify({
        version: 1,
        fps: 30,
        beats: Array.from({ length: 14 }, (_, i) => ({
          clip: `assets/caaf${String(i).padStart(4, '0')}.mp4`,
          startSec: 3 + i * 0.5,
          durationFrames: 45,
          name: i === 6 ? 'Tackle 2' : `Shot ${i + 1}`,
          transition: null,
        })),
      })
    );
  });
  after(() => {
    rmSync(CANVAS, { force: true });
    rmSync(EDL, { force: true });
  });

  // the readout is "at / length" and the length grows with every shot placed: the playhead is the left half
  const atTime = async () => (await text('timeline-readout')).split('/')[0];

  it('a run on the video, seven shots land one by one; your playhead stays put', async () => {
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-videoaicut');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await waitForArtboard('recap'); // a blank comp has no element boxes, so not the rects hook
    const box = (await artboardBox('recap')) as Box;
    expect(box).not.toBeNull();
    await selectUntilIsland(() => artboardBox('recap'), clickAt);
    await $('[data-testid="timeline-island"]').waitForExist({ timeout: 15_000 });

    const begun = await post('/_api/agent/run/begin', {
      session: 'e2e-ai-cut',
      actor: 'claude-code',
      label: 'Make a 30 s recap',
      scope: { canvas: 'ui/VideoAiCut.tsx', artboards: ['recap'] },
    });
    expect(begun.status).toBe(200);
    runId = String(begun.body?.run ?? '');
    expect(runId).toMatch(/^r_/);

    let playhead = '';
    for (let i = 1; i <= 7; i++) {
      const before = onDisk();
      const r = await placeNext(i);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`Placed shot ${i} of 14`);
      await browser.waitUntil(async () => onDisk() !== before, { timeout: 10_000 });
      await $('[data-testid="timeline-ai-status"][data-state="cutting"]').waitForExist({
        timeout: 15_000,
      });
      if (i === 3) {
        // scrub into the placed part: your playhead is yours, the AI edge is the run's
        await (await $('[data-testid="timeline-seq-0"]')).click();
        playhead = await atTime();
      }
      if (i > 3) expect(await atTime()).toBe(playhead);
    }
    await $('[data-testid="timeline-ai-edge"]').waitForExist({ timeout: 10_000 });
    expect(await text('timeline-ai-status')).toContain('AI is cutting');
    await $('[data-testid="timeline-ai-landing"]').waitForExist({ timeout: 10_000 });
    // the landing line follows the run's last placement — a beat after the file (r5: it still read shot 1)
    await browser
      .waitUntil(async () => (await text('timeline-ai-landing')).includes('Placing shot 7'), {
        timeout: 15_000,
      })
      .catch(() => {});
    expect(await text('timeline-ai-landing')).toContain('Placing shot 7 · Tackle 2');
    await capture('video-ai-cut-landing');
  });

  it('Stop → one published action with 7 shots; "Placed 7 of 14 shots." + Keep going', async () => {
    const stopped = await post(`/_api/ai/runs/${encodeURIComponent(runId)}/stop`, {});
    expect(stopped.status).toBeLessThan(300);
    await browser.waitUntil(
      async () => (await text('timeline-ai-status')).includes('Placed 7 of 14 shots.'),
      {
        timeout: 15_000,
        timeoutMsg: 'the stopped cut never said how far it got',
      }
    );
    await $('[data-testid="timeline-ai-keep-going"]').waitForExist({ timeout: 5000 });
    expect((onDisk().match(/<TransitionSeries\.Sequence\b/g) ?? []).length).toBe(7);
    await capture('video-ai-cut-stopped');
  });

  it('⌘Z takes all seven back in one step', async () => {
    await key({ key: 'z', metaKey: true });
    await browser.waitUntil(async () => onDisk() === EMPTY, {
      timeout: 15_000,
      timeoutMsg: '⌘Z did not take the whole cut back in one step',
    });
  });
});
