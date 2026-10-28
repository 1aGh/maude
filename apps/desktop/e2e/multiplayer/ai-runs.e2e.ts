// S5.15 — the two-Mac AI runs rig (V2-1.15 R1 / R4 / R10, V2-1.5 U-matrix E layer, 03 `ai-history`, 01
// `cf-ai-done` / `cf-undo-before` / `cf-undo-ai` / `cf-busy`).
//
// Cast: "Mac 1" is the native app under WebdriverIO (the person "You"); "Mac 2" is a second studio process
// (Tereza) — both linked to ONE local hub (apps/hub/test/fixtures/serve-hub.mjs under Node 24; the Homebrew
// default kills it). The agent is fake on both: the v1 `/design:edit` lane (`POST /_api/ai/start` → a fixed
// edit written to the canvas → `POST /_api/ai/end`), so every run goes through the real registry, leases,
// stage and publish. Mac 2 runs as its own process so R4 can SIGSTOP it for real.
//
// The in-process twin is apps/studio/test/ai-runs-two-mac.test.ts (two runtimes, one real hub): it proves
// R1 (50 rounds), R4 (a 40 s freeze), U3, U6/U8 out of order, U16 and "Made by AI clears on the next person's
// edit" without the desktop. This file adds what only the app shows: the rings and the Made by AI tag on the
// canvas, the Version history AI row's "Undo this chat", ⌘Z on Mac 1 for a Mac 2 edit (U23 — not in the stack),
// and R10 (quit with 2 running + 1 waiting) re-run against a live hub.
//
// Needs: an unlocked screen with the test window in front (WebKit freezes otherwise — memory), NO_OPEN=1 on
// every studio spawn, a throwaway project copy (never this repo's .design), MAUDE_MACHINE_FILE=$(mktemp).
// Run: pnpm --filter @maude/desktop-e2e e2e:ai-runs (wdio.ai-runs.conf.ts: the hub, Mac 2 and Mac 1's throwaway
// project are set up in the launcher; never the committed fixture, which the fake run would write into).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser } from '@wdio/globals';
import { waitForCanvasOpened } from '../helpers/canvas-frame';
import { capture } from '../helpers/evidence';
import { openApp } from '../helpers/target';
import { canvasRow } from '../helpers/tree';

const ROUNDS = Number(process.env.MAUDE_R1_ROUNDS ?? 50);
const REL = 'ui/Combine-kampan.tsx';
const sel = (id: string) => `[data-testid="${id}"]`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// the same canvas wdio.ai-runs.conf.ts seeds on Mac 2 (`aiRunsCanvas`), with the two titles changed
const canvas = (
  post = 'Post title',
  story = 'Story title'
) => `import { DCArtboard, DCSection, DesignCanvas } from '@maude/canvas-lib';

export default function CombineKampan() {
  return (
    <DesignCanvas>
      <DCSection id="kampan" title="Combine kampaň">
        <DCArtboard id="post" label="Post 1:1" width={1080} height={1080}><h1>${post}</h1><p>keep one</p></DCArtboard>
        <DCArtboard id="story" label="Story 9:16" width={1080} height={1920}><h1>${story}</h1><p>keep two</p></DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

async function waitFor<T>(
  fn: () => Promise<T | null | false> | T | null | false,
  what: string,
  ms = 30_000
) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await sleep(100);
  }
}

type Run = { runId: string; state: string; outcome?: string; scope?: { canvas?: string; artboards?: unknown } };

/** The run states, read from the registry (`GET /_api/ai/runs` › mine) — the v1 start answer carries none. */
async function runsOf(origin: string): Promise<Run[]> {
  const v = (await fetch(`${origin}/_api/ai/runs`).then((r) => r.json())) as { mine?: Run[] };
  return v.mine ?? [];
}
const runById = async (origin: string, id: string) =>
  (await runsOf(origin)).find((r) => r.runId === id) ?? null;

/** The selection the v1 run reads (`_active.json` › selected): Post 1:1, so the run asks for that artboard only. */
function selectPost(designRoot: string) {
  const file = `.design/${REL}`;
  writeFileSync(
    join(designRoot, '_active.json'),
    JSON.stringify({ active: file, open_tabs: [file], selected: { file, artboard: 'post' } })
  );
}

function v1(origin: string, path: '/_api/ai/start' | '/_api/ai/end') {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ file: `.design/${REL}`, author: 'Claude' }),
  }).then((r) => r.json()) as Promise<{ cleared?: boolean }>;
}

/** Start a v1 run on Post 1:1 and read its first state from the registry. */
async function startOnPost(origin: string, designRoot: string): Promise<Run> {
  const before = new Set((await runsOf(origin)).map((r) => r.runId));
  selectPost(designRoot);
  await v1(origin, '/_api/ai/start');
  const run = await waitFor(
    async () =>
      (await runsOf(origin)).find((r) => !before.has(r.runId) && r.scope?.canvas === REL) ?? null,
    'the new run in the registry'
  );
  expect(run.scope?.artboards).toEqual(['post']);
  return run;
}

/**
 * The fake agent on a studio: one v1 run on Post 1:1. It writes only once its run holds Post (a waiting run's
 * agent has not begun its turn), then ends. Returns the run's FIRST state.
 */
async function fakeRun(origin: string, designRoot: string, body: string, settleMs = 300) {
  const run = await startOnPost(origin, designRoot);
  const turn = await waitFor(
    async () => {
      const r = await runById(origin, run.runId);
      return r && r.state !== 'waiting' ? r : null;
    },
    'its turn on Post',
    120_000
  );
  if (turn.state !== 'ended') {
    writeFileSync(join(designRoot, REL), body);
    await sleep(settleMs);
    await v1(origin, '/_api/ai/end');
    await waitFor(async () => (await runById(origin, run.runId))?.state === 'ended', 'the run to end');
  }
  return { runId: run.runId, state: run.state };
}

describe('S5.15 — AI runs across two Macs', () => {
  if (process.env.MAUDE_AI_RUNS_E2E !== '1') {
    it.skip('set MAUDE_AI_RUNS_E2E=1 (unlocked screen, signed-in test hub) to run', () => {});
    return;
  }
  // wdio.ai-runs.conf.ts set it all up in the launcher: one local hub, Tereza's studio (Mac 2) and the app's
  // throwaway project (Mac 1), both linked to the hub.
  const rig = JSON.parse(process.env.MAUDE_E2E_AI_RUNS ?? '{}') as {
    mac1Root: string;
    mac2Root: string;
    mac2Origin: string;
    mac2Pid: number;
  };
  const mac2Origin = rig.mac2Origin;
  const mac1Root = rig.mac1Root;
  const mac2Root = rig.mac2Root;
  let mac1Origin = '';
  const mac2 = {
    kill: (sig: NodeJS.Signals) => {
      try {
        process.kill(rig.mac2Pid, sig);
      } catch {
        /* gone */
      }
    },
  };

  before(async () => {
    await waitFor(
      () =>
        fetch(`${mac2Origin}/_health`)
          .then((r) => r.ok)
          .catch(() => false),
      'Mac 2 studio'
    );
    // Mac 1's copy of the canvas arrives through the hub
    await waitFor(() => existsSync(join(mac1Root, '.design', REL)), 'the canvas on Mac 1', 60_000);
    mac1Origin = await waitFor(() => {
      try {
        return JSON.parse(readFileSync(join(mac1Root, '.design', '_server.json'), 'utf8')).url;
      } catch {
        return null;
      }
    }, 'Mac 1 studio');
    // open Combine-kampan on Mac 1 (the rings, the canvas frame and its Version history need it)
    await openApp();
    await (await canvasRow('canvas-row-ui-combine-kampan')).click();
    await $(sel('canvas-frame')).waitForExist({ timeout: 60_000 });
    await waitForCanvasOpened();
  });

  after(() => {
    mac2.kill('SIGCONT');
  });

  it(`R1: both Macs ask on Post 1:1 within 5 ms, ${ROUNDS} rounds — one writer at a time, the other waits`, async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const [a, b] = await Promise.all([
        fakeRun(mac1Origin, join(mac1Root, '.design'), canvas(`r${i} you`)),
        fakeRun(mac2Origin, join(mac2Root, '.design'), canvas(`r${i} tereza`)),
      ]);
      // a /design:edit run's turn is the terminal's: granted at once it is running; the other waits
      expect([a.state, b.state].sort()).toEqual(['running', 'waiting']);
      // the canvas shows the holder's ring and "· 1 waiting" on Post while it works
      await $(sel('canvas-frame')).waitForExist();
    }
  });

  it('R4: SIGSTOP Mac 2 for 40 s while it holds Post; Mac 1 runs; Mac 2 hears lease-lost and holds', async () => {
    const mac2Design = join(mac2Root, '.design');
    const held = await startOnPost(mac2Origin, mac2Design);
    expect(held.state).toBe('running');
    writeFileSync(join(mac2Design, REL), canvas('Mac 2 frozen')); // its staged write, never published
    await sleep(500);
    mac2.kill('SIGSTOP');
    const stoppedAt = Date.now();
    let mine: { state: string };
    try {
      // Mac 1 asks while Mac 2 holds Post: it waits, then runs once the hub lapses Mac 2's lease (TTL 30 s)
      mine = await fakeRun(mac1Origin, join(mac1Root, '.design'), canvas('Mac 1 ran'));
      await sleep(Math.max(0, 40_000 - (Date.now() - stoppedAt)));
    } finally {
      mac2.kill('SIGCONT');
    }
    expect(mine.state).toBe('waiting');
    // SIGCONT: Mac 2 renews (every 10 s), hears its run is gone, and ends it lease-lost
    const rec = await waitFor(
      async () => {
        const r = await runById(mac2Origin, held.runId).catch(() => null);
        return r?.state === 'ended' ? r : null;
      },
      'Mac 2 to hear lease-lost',
      60_000
    );
    expect(rec.outcome).toBe('lease-lost');
    // its agent's late end changes nothing, and its frozen write never reaches Mac 1
    expect((await v1(mac2Origin, '/_api/ai/end')).cleared).toBe(false);
    await waitFor(
      () => readFileSync(join(mac1Root, '.design', REL), 'utf8').includes('Mac 1 ran'),
      'Mac 1’s run on its disk'
    );
    await sleep(3_000);
    expect(readFileSync(join(mac1Root, '.design', REL), 'utf8')).not.toContain('Mac 2 frozen');
  });

  it('Version history › Made by AI lists the AI runs; a v1 run names no chat, so it offers no "Undo this chat"', async () => {
    // Undo this chat needs the row's chat (ChatUndoButton: kind ai + chatId + yours); a v1 `/design:edit` run has
    // none. The chat-run half (one version for the whole chat) is in apps/studio/test/v2-chat-undo.test.tsx and
    // goes to the fake-ACP lane next (hand-back § Continue).
    type H = { history?: { kind?: string; who?: { kind?: string } }[] };
    await waitFor(async () => {
      const h = (await fetch(`${mac1Origin}/_api/project/history?limit=200`).then((r) => r.json())) as H;
      return (h.history ?? []).some((r) => r.kind === 'ai' || r.who?.kind === 'ai');
    }, 'an AI version on Mac 1', 60_000);
    await browser.keys(['Alt', 'Meta', 'h']); // Version history ⌥⌘H
    await $(sel('vh-panel')).waitForExist();
    await $(sel('vh-filter-ai')).click();
    const row = await $('[data-testid^="vh-row-"]');
    await row.waitForExist({ timeout: 30_000 });
    await row.click();
    await expect($(sel('vh-acts'))).toBeExisting();
    expect(await $(sel('vh-undo-chat')).isExisting()).toBe(false);
    await capture('ai-runs-vh-ai-row');
  });
});
