import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, $$, browser, expect } from '@wdio/globals';
import { openAssistant, requireAi } from '../helpers/assistant';
import { waitForArtboard } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { selectUntilIsland } from '../helpers/select-artboard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';
import {
  artboardBox,
  b64,
  clickAt,
  haveFfmpeg,
  keyDown,
  makeClip,
  scratch,
  text,
  tid,
} from '../helpers/video-lab';

/**
 * 07 Video Editing — the AI cut in the chat, start to finish (ve-ai-watch, ve-ai-cut, ve-ai-proposal, ve-ai-adjust).
 *
 * A real chat turn on the scripted cutting agent (fixtures/fake-acp/video-cut-agent.mjs — no model): twelve real
 * clips are dropped on the composer, the ask is the board's own words, and the agent does what the footage-director
 * skill teaches under the plugin's real hooks.
 *
 *   watch     "Watching 12 clips… N done" with the clips' tiles and the found lines (ve-ai-watch)
 *   cut       the shots land one by one; the landing line says "on the beat at 0:…"; the chip "AI is cutting" (ve-ai-cut)
 *   done      "Done — Recap · Reels is a 0:30 cut…", Left out with the reasons and Use them anyway, the chip
 *             "Made by AI · 14 shots" — and every shot starts on a beat of the 120 BPM song (ve-ai-cut, ve-ai-proposal)
 *   adjust    a hand edit: Other takes… on a shot offers the clip's other takes, AI's pick marked; swapping keeps the
 *             length, and ⌘Z takes back only the swap (ve-ai-adjust)
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.MAUDE_PROJECT_ROOT ?? join(HERE, '../fixtures/project');
const DESIGN = join(ROOT, '.design');
const CANVAS = join(DESIGN, 'ui', 'VideoAiCut.tsx');
const EDL = join(DESIGN, 'recap.edl.json');
const BEATS = join(DESIGN, 'assets', 'hype0001.beats.json');

const EMPTY = [
  "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
  "import { AbsoluteFill, Audio } from 'remotion';",
  '',
  'const Recap = () => (',
  "  <AbsoluteFill style={{ background: '#000' }}>",
  '    <Audio src="assets/hype0001.mp3" />',
  '  </AbsoluteFill>',
  ');',
  '',
  'export default function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="recap" kind="video" label="Recap · Reels · 0:30" width={1080} height={1920}>',
  '        <VideoComp component={Recap} durationInFrames={900} fps={30} width={1080} height={1920} />',
  '      </DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
  '',
].join('\n');

const beats = {
  format: 'maude.beats',
  v: 1,
  asset: 'assets/hype0001.mp3',
  durationSec: 30,
  analyzer: { id: 'maude-beats', version: 1, decode: 'ffmpeg' },
  bpm: 120,
  bpmSource: 'detected',
  tempoStrength: 0.9,
  beats: Array.from({ length: 60 }, (_, i) => i * 0.5),
  bar: { phase: 0, confidence: 0.9 },
  createdAt: '2026-10-28T09:00:00.000Z',
};

const onDisk = () => readFileSync(CANVAS, 'utf8');
const seqCount = () => (onDisk().match(/<TransitionSeries\.Sequence\b/g) ?? []).length;

/** Twelve real clips on the composer, as a Finder drop hands them over. */
async function dropClipsOnComposer(files: string[]): Promise<void> {
  await browser.execute((datas: string[]) => {
    const dt = new DataTransfer();
    datas.forEach((d, i) => {
      const bin = atob(d);
      const bytes = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
      dt.items.add(
        new File([bytes], `akce-${String(i + 1).padStart(2, '0')}.mp4`, { type: 'video/mp4' })
      );
    });
    const host = document.querySelector('[data-testid="chat-composer"]') as HTMLElement;
    const at = { bubbles: true, cancelable: true, dataTransfer: dt };
    host.dispatchEvent(new DragEvent('dragenter', at));
    host.dispatchEvent(new DragEvent('dragover', at));
    host.dispatchEvent(new DragEvent('drop', at));
  }, files.map(b64));
}

/** What the runs list and the accepted history say about the cut, for a failure message. */
async function runsDiag(): Promise<string> {
  return browser.execute(async () => {
    try {
      const get = async (url: string) => (await fetch(url, { cache: 'no-store' })).json();
      const runs = ((await get('/_api/ai/runs')).mine ?? []).map((x: Record<string, unknown>) => ({
        runId: x.runId,
        state: x.state,
        outcome: x.outcome,
        scope: x.scope,
      }));
      const history = ((await get('/_api/project/history?limit=12')).history ?? []).map(
        (h: Record<string, unknown>) => ({ kind: h.kind, actor: h.actor, label: h.label })
      );
      return `runs ${JSON.stringify(runs)} · history ${JSON.stringify(history)}`.slice(0, 1800);
    } catch (e) {
      return `runs: ${e}`;
    }
  });
}

describe('video-ai-chat — twelve clips in, a cut on the beat out, a take swapped by hand', () => {
  before(async function () {
    if (!haveFfmpeg()) this.skip();
    startReport('video-ai-chat');
    await browser.setTimeout({ script: 120_000 });
    writeFileSync(CANVAS, EMPTY);
    writeFileSync(BEATS, `${JSON.stringify(beats, null, 2)}\n`);
  });
  after(() => {
    for (const f of [CANVAS, EDL, BEATS]) rmSync(f, { force: true });
    rmSync(join(DESIGN, 'ui', 'VideoAiCut.meta.json'), { force: true });
  });

  it('twelve clips on the composer, the ask: the watch card counts them up', async function () {
    await waitForSidecar();
    const dir = scratch();
    const clips = Array.from({ length: 12 }, (_, i) =>
      makeClip(dir, `c${i}.mp4`, { size: '64x36', sec: 6, sound: true, hue: i * 25 })
    );
    const row = await canvasRow('canvas-row-ui-videoaicut');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await waitForArtboard('recap');
    await selectUntilIsland(() => artboardBox('recap'), clickAt);
    await $(tid('timeline-island')).waitForExist({ timeout: 15_000 });
    await openAssistant();
    await requireAi(this);

    await dropClipsOnComposer(clips);
    await $(tid('ai-attach-chip-11')).waitForExist({
      timeout: 60_000,
      timeoutMsg: 'the twelve clips never became chips on the composer',
    });
    // only READY chips ride with the ask (the rest are held back): wait for all twelve to be on the server
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () =>
            [...document.querySelectorAll('[data-testid^="ai-attach-chip-"][data-state]')].filter(
              (c) => c.getAttribute('data-state') === 'ready'
            ).length
        )) === 12,
      { timeout: 60_000, timeoutMsg: 'the twelve chips never all became ready' }
    );
    await capture('video-ai-clips-attached');
    const input = await (await $(tid('chat-composer'))).$('.chat-input');
    await input.click();
    await input.addValue('Make a 30 s recap from these 12 clips');
    await (await $('[aria-label="Send message"]')).click();

    // the footage line under the ask, then the watch card counting up
    await $(tid('ai-clips-attached')).waitForExist({ timeout: 30_000 });
    expect(await text('ai-clips-attached')).toContain('12 clips');
    expect(await text('ai-clips-attached')).toContain('from Assets');
    const card = await $(tid('ai-watch-card'));
    await card.waitForExist({ timeout: 60_000, timeoutMsg: 'no watch card' });
    await browser.waitUntil(
      async () => /Watching 12 clips… [1-9]\d* done/.test(await text('ai-watch-title')),
      {
        timeout: 30_000,
        timeoutMsg: `the watch card never counted: ${await text('ai-watch-title')}`,
      }
    );
    await $(tid('ai-watch-found')).waitForExist({ timeout: 15_000 });
    expect(await text('ai-watch-found')).toMatch(/\d:\d\d.*Touchdown run — akce-\d\d/s);
    await capture('video-ai-watching');
  });

  it('the shots land one by one, each on the beat', async () => {
    await $('[data-testid="timeline-ai-status"][data-state="cutting"]').waitForExist({
      timeout: 120_000,
      timeoutMsg: 'the timeline never said AI is cutting',
    });
    expect(await text('timeline-ai-status')).toContain('AI is cutting');
    await $(tid('timeline-ai-landing')).waitForExist({ timeout: 30_000 });
    await browser.waitUntil(
      async () => /on the beat at \d:\d\d/.test(await text('timeline-ai-landing')),
      {
        timeout: 30_000,
        timeoutMsg: `the landing line never said on the beat: ${await text('timeline-ai-landing')}`,
      }
    );
    expect(await text('timeline-ai-landing')).toMatch(/^Placing shot \d+ · Shot \d+/);
    await capture('video-ai-cut-landing-on-beat');
  });

  it('done: the cut is on the artboard, the left-out clips are named, and every shot starts on a beat', async () => {
    await browser.waitUntil(async () => seqCount() === 14, {
      timeout: 180_000,
      timeoutMsg: `the cut never reached 14 shots (${seqCount()})`,
    });
    await $(tid('ai-result')).waitForExist({ timeout: 60_000, timeoutMsg: 'no result line' });
    // The AI's own message says what it did; the card under it is Undo first, then Keep going (Result.jsx, 03 ai-done)
    const done =
      'Done — Recap · Reels is a 0:30 cut: 14 shots from 9 of your 12 clips, on the beat of Hype instrumental.';
    await browser.waitUntil(
      async () =>
        await browser.execute(
          (want) =>
            [...document.querySelectorAll('.chat-msg--assistant')].some((m) =>
              (m.textContent ?? '').includes(want)
            ),
          done
        ),
      { timeout: 20_000, timeoutMsg: `the AI never said: ${done}` }
    );
    expect(
      await browser.execute(() =>
        [...document.querySelectorAll('[data-testid="ai-result"] button')]
          .map((b) => (b.textContent ?? '').trim())
          .filter((t) => t === 'Undo' || t === 'Keep going')
      )
    ).toEqual(['Undo', 'Keep going']);
    const left = await $(tid('ai-left-out'));
    await left.waitForExist({ timeout: 20_000 });
    const said = await left.getText();
    expect(said).toMatch(/^Left out: /);
    expect(said).toContain('too dark');
    expect(said).toContain('shaky');
    expect((await text('ai-left-out-use')).trim()).toBe('Use them anyway');
    // the chip may be absent altogether (the timeoutMsg is built before the wait, so it must not throw on that)
    const chip = async () =>
      (await $(tid('timeline-ai-status')).isExisting()) ? text('timeline-ai-status') : '(no chip)';
    try {
      await browser.waitUntil(async () => (await chip()).includes('Made by AI · 14 shots'), {
        timeout: 30_000,
      });
    } catch {
      throw new Error(`the chip said ${await chip()} · ${await runsDiag()}`);
    }
    expect(await $(tid('timeline-ai-keep-going')).isExisting()).toBe(false);

    // every shot starts on a beat: 120 BPM at 30 fps = 15 frames a beat; the starts are read from the file
    const lens = [
      ...onDisk().matchAll(/<TransitionSeries\.Sequence\b[^>]*durationInFrames=\{(\d+)\}/g),
    ].map((m) => Number(m[1]));
    expect(lens.length).toBe(14);
    let at = 0;
    for (const d of lens) {
      expect(at % 15).toBe(0);
      at += d;
    }
    await capture('video-ai-done');
  });

  it('a hand edit: Other takes… offers the clip’s other takes, AI’s pick marked; the swap keeps the length', async () => {
    await (await $(tid('timeline-seq-2'))).click();
    const link = await $(tid('insp-clip-takes'));
    await link.waitForExist({
      timeout: 15_000,
      timeoutMsg: 'the clip inspector has no Other takes…',
    });
    await link.click();
    const pop = await $(tid('other-takes'));
    await pop.waitForExist({ timeout: 15_000 });
    expect(await text('other-takes-title')).toMatch(/^Other takes · /);
    expect(await text('other-takes-foot')).toBe(
      'Click a take to swap it in. Same length, same beat.'
    );
    const takes = await $$(tid('other-takes-take'));
    expect(takes.length).toBeGreaterThanOrEqual(2);
    const picks = await browser.execute(() =>
      [...document.querySelectorAll('[data-testid="other-takes-take"]')].map((t) => ({
        pick: t.getAttribute('data-pick') === 'true',
        on: t.getAttribute('data-on') === 'true',
        text: (t.textContent ?? '').trim(),
      }))
    );
    expect(picks.filter((p) => p.pick).length).toBe(1);
    expect(picks.filter((p) => p.on).length).toBe(1);
    // every take is a different window (no take offered twice — p8-t-video-2)
    const windows = picks.map((p) => p.text.match(/^\d+:\d\d(?:\.\d)?–\d+:\d\d(?:\.\d)?/)?.[0]);
    expect(new Set(windows).size).toBe(windows.length);
    expect(picks.find((p) => p.pick)?.text).toContain('AI’s pick');
    await capture('video-ai-other-takes');

    const before = onDisk();
    const lensBefore = [...before.matchAll(/durationInFrames=\{(\d+)\}/g)].map((m) => m[1]);
    const swap = await browser.execute(() => {
      const t = [...document.querySelectorAll('[data-testid="other-takes-take"]')].find(
        (x) => !(x as HTMLButtonElement).disabled && x.getAttribute('data-on') !== 'true'
      ) as HTMLButtonElement | undefined;
      t?.click();
      return !!t;
    });
    expect(swap).toBe(true);
    await browser.waitUntil(async () => onDisk() !== before, {
      timeout: 15_000,
      timeoutMsg: 'swapping a take did not change the file',
    });
    expect([...onDisk().matchAll(/durationInFrames=\{(\d+)\}/g)].map((m) => m[1])).toEqual(
      lensBefore
    );
    expect(seqCount()).toBe(14);
    // ⌘Z steps back through YOUR edit first: the cut is still 14 shots
    await keyDown({ key: 'z', metaKey: true });
    await browser.waitUntil(async () => onDisk() === before, {
      timeout: 15_000,
      timeoutMsg: '⌘Z did not take the swap back',
    });
    expect(seqCount()).toBe(14);
  });
});
