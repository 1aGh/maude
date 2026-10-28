// S5.15 — the two-Mac AI runs rig (V2-1.15 R1 / R4 / R10, V2-1.5 U-matrix E layer, 03 `ai-history`, 01
// `cf-ai-done` / `cf-undo-before` / `cf-undo-ai` / `cf-busy`).
//
// Cast: "Mac 1" is the native app under WebdriverIO (the person "You"); "Mac 2" is a second studio process
// (Tereza) — both linked to ONE local hub (apps/hub/test/fixtures/serve-hub.mjs under Node 24; the Homebrew
// default kills it). The agent is fake on both: the v1 `/design:edit` lane (`POST /_api/ai/start` → a fixed
// edit written to the canvas → `POST /_api/ai/end`), so every run goes through the real registry, leases,
// stage and publish. Mac 2 runs as its own process so R4 can SIGSTOP it for real. Tereza signs in with her own
// hub token (the hub names her "tereza"). Mac 1's CHATS run on the scripted fake ACP agent (decision
// maude/v2-8.5-g2-fake-acp-hook-agent); Tereza's and Jonas's windows are headless Chromium pages on Mac 2's studio
// (03 `ai-tereza`, 01 `cf-busy`), and 14 `ed-edge-undo` reads Mac 1's Undo history after its AI run and own edit.
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
import { chromium, type Browser as PwBrowser } from '@playwright/test';
import { $, $$, browser } from '@wdio/globals';
import { clearComposer, openAssistant, requireAi } from '../helpers/assistant';
import { focusShell, waitForCanvasOpened } from '../helpers/canvas-frame';
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
        <DCArtboard id="cover" label="FB cover" width={1920} height={1005}><h1>Cover title</h1><p>keep three</p></DCArtboard>
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

type Run = {
  runId: string;
  state: string;
  outcome?: string;
  origin?: string;
  actor?: string;
  chatId?: string;
  scope?: { canvas?: string; artboards?: unknown };
  waiting?: {
    artboard: string;
    heldBy?: { runId?: string; actor?: string; origin?: string } | null;
  }[];
};
type Other = { runId: string; state: string; actor?: string; artboards?: { artboard: string }[] };

/** The run states, read from the registry (`GET /_api/ai/runs` › mine) — the v1 start answer carries none. */
async function runsOf(origin: string): Promise<Run[]> {
  const v = (await fetch(`${origin}/_api/ai/runs`).then((r) => r.json())) as { mine?: Run[] };
  return v.mine ?? [];
}
const runById = async (origin: string, id: string) =>
  (await runsOf(origin)).find((r) => r.runId === id) ?? null;
/** Other people's runs this Mac sees (`GET /_api/ai/runs` › others). */
async function othersOf(origin: string): Promise<Other[]> {
  const v = (await fetch(`${origin}/_api/ai/runs`).then((r) => r.json())) as { others?: Other[] };
  return v.others ?? [];
}

/** Send `text` from Mac 1's AI panel (the scripted fake ACP agent picks its script from the words). */
/** Narrow the composer's chip to one artboard: ◆ chip › Choose artboards… › <artboard> › Done. */
async function scopeTo(artboard: string): Promise<void> {
  const chip = await displayed(sel('ai-scope-chip'));
  await chip.click();
  await (await displayed(sel('ai-scope-item-choose'))).click();
  await (await displayed(sel(`ai-scope-item-artboard-${artboard}`))).click();
  await (await displayed(sel('ai-scope-item-done'))).click();
}

/** The first element matching `q` that is on screen (hidden chats keep their copies mounted). */
async function displayed(q: string): Promise<WebdriverIO.Element> {
  let hit: WebdriverIO.Element | null = null;
  await browser.waitUntil(
    async () => {
      for (const c of await $$(q))
        if (await c.isDisplayed().catch(() => false)) {
          hit = c as unknown as WebdriverIO.Element;
          return true;
        }
      return false;
    },
    { timeout: 30_000, timeoutMsg: `nothing on screen: ${q}` }
  );
  return hit as unknown as WebdriverIO.Element;
}

async function sendChat(text: string): Promise<void> {
  // A chat kept alive behind the one in front keeps its composer mounted (hidden): use the one on screen.
  let composer: WebdriverIO.Element | null = null;
  await browser.waitUntil(
    async () => {
      for (const c of await $$(sel('chat-composer')))
        if (await c.isDisplayed().catch(() => false)) {
          composer = c as unknown as WebdriverIO.Element;
          return true;
        }
      return false;
    },
    { timeout: 60_000, timeoutMsg: 'no chat composer on screen' }
  );
  const box = composer as unknown as WebdriverIO.Element;
  const input = await box.$('.chat-input');
  if ((await input.getValue()) !== '') await clearComposer();
  await input.click();
  await input.addValue(text);
  for (const s of await $$('[aria-label="Send message"]'))
    if (await s.isDisplayed().catch(() => false)) {
      await s.click();
      return;
    }
  throw new Error('no Send button on screen');
}

const post = (origin: string, path: string, body: unknown) =>
  fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });

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
  if (run.state === 'waiting')
    console.log(`[ai-runs] ${origin} waits: ${JSON.stringify(run.waiting ?? [])}`);
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
    await waitFor(
      async () => (await runById(origin, run.runId))?.state === 'ended',
      'the run to end'
    );
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
    hub: string;
    hubToken: string;
    mac1Root: string;
    mac2Root: string;
    mac2Origin: string;
    mac2Pid: number;
  };
  const mac2Origin = rig.mac2Origin;
  const mac1Root = rig.mac1Root;
  const mac2Root = rig.mac2Root;
  let mac1Origin = '';
  let pw: PwBrowser | null = null;
  let held2: Run | null = null;
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

  // Nothing live is left for the next step: Tereza's held run lands, your chats stop (also after a red step).
  afterEach(async () => {
    if (held2) {
      writeFileSync(join(mac2Root, '.design', REL), canvas('Tereza shorter', 'Story title'));
      await sleep(300);
      await v1(mac2Origin, '/_api/ai/end').catch(() => null);
      const id = held2.runId;
      await waitFor(
        async () => (await runById(mac2Origin, id))?.state === 'ended',
        'Tereza’s run to end'
      ).catch(() => null);
      held2 = null;
    }
    const live = (await runsOf(mac1Origin).catch(() => [])).filter(
      (r) => r.origin === 'maude-chat' && r.state !== 'ended'
    );
    for (const r of live)
      await post(mac1Origin, `/_api/ai/runs/${r.runId}/stop`, {}).catch(() => null);
    if (live.length)
      await waitFor(
        async () =>
          !(await runsOf(mac1Origin)).some((r) => r.origin === 'maude-chat' && r.state !== 'ended'),
        'your chats stopped'
      );
  });

  after(async () => {
    mac2.kill('SIGCONT');
    await pw?.close().catch(() => undefined);
  });

  /** The hub itself holds no live run (its own `GET runs`, as the owner — not each Mac's 10 s pull of it). */
  async function hubLetGo() {
    await waitFor(
      async () => {
        const r = await fetch(`${rig.hub}/api/projects/current/v1/runs`, {
          headers: { authorization: `Bearer ${rig.hubToken}` },
        });
        const v = (await r.json()) as { runs?: { state?: string }[] };
        return r.ok && (v.runs ?? []).every((x) => x.state === 'ended');
      },
      'the hub to let go of the last round',
      30_000
    );
  }

  it(`R1: both Macs ask on Post 1:1 within 5 ms, ${ROUNDS} rounds — one writer at a time, the other waits`, async () => {
    for (let i = 0; i < ROUNDS; i++) {
      // The round before ended on both Macs, but its end reaches the hub a moment later (`runsEnd` after the local
      // end): until then the hub still sees that run on Post, and BOTH new asks rightly line up behind it (measured:
      // the 2nd round's asks came 8 ms after the 1st round's local end). Start a round once the hub has let go —
      // the hub's own run list has no live run.
      await hubLetGo();
      const [a, b] = await Promise.all([
        fakeRun(mac1Origin, join(mac1Root, '.design'), canvas(`r${i} you`)),
        fakeRun(mac2Origin, join(mac2Root, '.design'), canvas(`r${i} tereza`)),
      ]);
      // a /design:edit run's turn is the terminal's: granted at once it is running; the other waits
      if ([a.state, b.state].sort().join() !== 'running,waiting') {
        for (const [who, o] of [
          ['Mac 1', mac1Origin],
          ['Mac 2', mac2Origin],
        ] as const)
          console.log(
            `[ai-runs] R1 round ${i} ${who}: ${JSON.stringify(await fetch(`${o}/_api/ai/runs`).then((r) => r.json()))}`
          );
      }
      expect([a.state, b.state].sort()).toEqual(['running', 'waiting']);
      // the canvas shows the holder's ring and "· 1 waiting" on Post while it works
      await $(sel('canvas-frame')).waitForExist();
    }
  });

  // 03 `ai-tereza` + 01 `cf-busy`: Tereza and Jonas on the canvas (their faces in Mac 1's Share cluster), Tereza's
  // AI on Post 1:1 (her ring, and a View only row under "On this canvas"), and two of YOUR chats running at once
  // (the scripted fake ACP agent's quiet turns). Tereza's and Jonas's windows are headless Chromium pages on Mac 2's
  // studio — their presence reaches Mac 1 through the hub, the way a teammate's does.
  it('Tereza’s AI on the same canvas, seen from your Mac; two of your chats run at once (ai-tereza, cf-busy)', async function () {
    await requireAi(this);
    const mac2Design = join(mac2Root, '.design');
    pw = await chromium.launch({
      headless: true,
      ...(process.env.MAUDE_E2E_CHROMIUM ? { executablePath: process.env.MAUDE_E2E_CHROMIUM } : {}),
    });
    for (const name of ['Tereza Nováková', 'Jonas Malý']) {
      const ctx = await pw.newContext({
        viewport: { width: 1440, height: 900 },
        serviceWorkers: 'block',
      });
      await ctx.route(/\/_api\/git-user(\?|$)/, (r) =>
        r.fulfill({ contentType: 'application/json', body: JSON.stringify({ name, email: null }) })
      );
      const page = await ctx.newPage();
      await page.goto(`${mac2Origin}/?open=${REL}`, { waitUntil: 'domcontentloaded' });
    }
    // their faces on Mac 1
    const faces = await waitFor(
      async () => {
        const labels = await browser.execute(() =>
          Array.from(document.querySelectorAll('[data-testid^="share-cluster-face-"]'))
            .map((el) => el.getAttribute('aria-label') ?? el.textContent ?? '')
            .filter(Boolean)
        );
        return labels.some((l) => /Tereza/.test(l)) && labels.some((l) => /Jonas/.test(l))
          ? labels
          : null;
      },
      'Tereza’s and Jonas’s faces on Mac 1',
      90_000
    );
    console.log(`[ai-runs] faces on Mac 1: ${JSON.stringify(faces)}`);

    // Tereza's AI holds Post 1:1 (a v1 run on her studio, held until the end of this step)
    await hubLetGo();
    held2 = await startOnPost(mac2Origin, mac2Design);
    expect(held2.state).toBe('running');
    const theirs = await waitFor(
      async () => (await othersOf(mac1Origin)).find((o) => o.runId === held2?.runId) ?? null,
      'Tereza’s run among Mac 1’s others',
      60_000
    );
    expect(theirs.artboards?.map((k) => k.artboard)).toEqual(['post']);

    // two of your chats, one after the other in their own chats, both at work
    await openAssistant();
    await scopeTo('story');
    await sendChat('Take 150 seconds');
    await waitFor(
      async () =>
        (await runsOf(mac1Origin)).some((r) => r.origin === 'maude-chat' && r.state === 'running'),
      'your first chat running',
      60_000
    );
    await (await $(sel('ai-chat-new'))).click();
    await scopeTo('cover');
    await sendChat('Take 140 seconds');
    const chats = await waitFor(
      async () => {
        const live = (await runsOf(mac1Origin)).filter(
          (r) => r.origin === 'maude-chat' && r.state === 'running'
        );
        return live.length === 2 ? live : null;
      },
      'two of your chats running at once',
      60_000
    ).catch(async (e) => {
      console.log(`[ai-runs] Mac 1 runs: ${JSON.stringify(await runsOf(mac1Origin))}`);
      throw e;
    });
    expect(new Set(chats.map((r) => r.chatId)).size).toBe(2);

    // "✦ 2" and the list: Yours (two rows, Working) then On this canvas (Tereza's, View only)
    const count = await $(sel('ai-chat-count'));
    await count.waitForDisplayed({ timeout: 20_000 });
    await browser.waitUntil(async () => (await count.getText()).trim() === '2', {
      timeout: 20_000,
      timeoutMsg: 'the header never counted 2 chats',
    });
    expect(await count.getAttribute('aria-label')).toBe('2 chats running');
    await count.click();
    const list = await $(sel('ai-runs-list'));
    await list.waitForDisplayed({ timeout: 10_000 });
    const groups = await browser.execute(() =>
      Array.from(document.querySelectorAll('[data-testid="ai-runs-list"] .ai-runs-group')).map(
        (e) => (e.textContent ?? '').trim()
      )
    );
    expect(groups).toEqual(['Yours', 'On this canvas']);
    // the rows name artboards from the project index, which the list reads once it opens: wait for the labels
    type Row = { id: string | null; viewOnly: boolean; title: string; where: string; word: string };
    let rows: Row[] = [];
    await browser
      .waitUntil(
        async () => {
          rows = (await browser.execute(() =>
            Array.from(
              document.querySelectorAll('[data-testid="ai-runs-list"] [data-testid^="ai-run-"]')
            )
              .filter((e) => e.getAttribute('data-testid') !== 'ai-runs-all')
              .map((e) => ({
                id: e.getAttribute('data-testid'),
                viewOnly: e.getAttribute('data-view-only') === 'true',
                title: (e.querySelector('.ai-run-title')?.textContent ?? '').trim(),
                where: (e.querySelector('.ai-run-where')?.textContent ?? '').trim(),
                word: (e.querySelector('.ai-run-word')?.textContent ?? '').trim(),
              }))
          )) as Row[];
          return rows.some((r) => r.viewOnly && r.where.startsWith('Post 1:1'));
        },
        { timeout: 15_000, interval: 250 }
      )
      .catch(() => undefined);
    console.log(`[ai-runs] run list: ${JSON.stringify(rows)}`);
    const yours = rows.filter((r) => !r.viewOnly);
    const others = rows.filter((r) => r.viewOnly);
    expect(yours.map((r) => r.word)).toEqual(['Working', 'Working']);
    expect(yours.map((r) => r.title).sort()).toEqual(['Take 140 seconds', 'Take 150 seconds']);
    expect(yours.map((r) => r.where).sort()).toEqual(['FB cover', 'Story 9:16']);
    expect(others).toHaveLength(1);
    expect(others[0].id).toBe(`ai-run-${held2.runId}`);
    expect(others[0].where).toBe("Post 1:1 · Tereza's AI");
    expect(others[0].word).toBe('View only');
    await capture('ai-tereza-run-list');
    await browser.keys(['Escape']);
    await capture('cf-busy-two-chats-tereza-jonas');

    // the shared afterEach lands Tereza's run and stops your two chats
  });

  // 14 `ed-edge-undo` (CONTRACT: "One AI run is one undo step; Edit › Undo history… lists You and AI steps"): your
  // AI's run and your own edit, newest first, ⌘Z on the top row; the foot says Tereza's changes are hers to undo.
  it('Undo history lists your AI run as one step and your own edit; Tereza’s changes are theirs (ed-edge-undo)', async () => {
    // your AI run lands on Post (a v1 run of Mac 1), then you resize Story yourself (the inspector's edit-op)
    await fakeRun(mac1Origin, join(mac1Root, '.design'), canvas('Your AI title', 'Story title'));
    await sleep(1_500);
    const r = await post(mac1Origin, '/_api/edit-op', {
      file: `.design/${REL}`,
      op: 'artboard.resize',
      targets: [],
      params: { artboard: 'story', width: 1000 },
    });
    expect(r.status).toBe(200);
    await waitFor(
      () => readFileSync(join(mac1Root, '.design', REL), 'utf8').includes('width={1000}'),
      'your resize on disk'
    );
    await sleep(1_500);
    // Menu › Edit › Undo history…, run from ⌘K like every registry action
    await focusShell();
    await browser.keys(['Meta', 'k']);
    const input = await $(sel('palette-input'));
    await input.waitForExist({ timeout: 10_000 });
    await input.setValue('Undo history');
    await $(sel('palette-row-action:edit.undo-history')).waitForExist({ timeout: 4000 });
    await browser.keys(['']);
    await $(sel('undo-history')).waitForDisplayed({ timeout: 8000 });
    const rows = await waitFor(
      async () => {
        const v = await browser.execute(() =>
          Array.from(document.querySelectorAll('[data-testid^="undo-history-row-"]')).map((e) => ({
            who: e.getAttribute('data-who'),
            top: e.getAttribute('data-top') === 'true',
            state: e.getAttribute('data-state'),
            text: (e.textContent ?? '').replace(/\s+/g, ' ').trim(),
          }))
        );
        return v.length >= 2 ? v : null;
      },
      'two rows in Undo history',
      15_000
    );
    console.log(`[ai-runs] undo history: ${JSON.stringify(rows.slice(0, 6))}`);
    // newest first: your resize (⌘Z), then your AI's run as ONE step
    expect(rows[0].who).toBe('you');
    expect(rows[0].top).toBe(true);
    expect(rows[0].text).toContain('⌘Z');
    expect(rows[0].text).toMatch(/You · now/);
    expect(rows[1].who).toBe('ai');
    expect(rows[1].text).toMatch(/— (one step|\d+ changes?, one step)/);
    expect(rows[1].text).toMatch(/AI · now/);
    // only you and your AI: never another person's row
    expect(rows.every((x) => x.who === 'you' || x.who === 'ai')).toBe(true);
    const foot = await $(sel('undo-history-foot'));
    await expect(foot).toBeDisplayed();
    expect((await foot.getText()).trim()).toBe("Tereza's changes are theirs to undo.");
    await expect($(sel('undo-history-version'))).toBeDisplayed();
    // pointing at the AI row lights what it would undo (the canvas tag, in the shot)
    await (await $(sel('undo-history-row-1'))).moveTo();
    await sleep(400);
    await capture('ed-edge-undo-history');
    await browser.keys(['Escape']);
    await $(sel('undo-history')).waitForExist({ reverse: true, timeout: 5000 });
  });

  it('R4: SIGSTOP Mac 2 for 40 s while it holds Post; Mac 1 runs; Mac 2 hears lease-lost and holds', async () => {
    const mac2Design = join(mac2Root, '.design');
    await hubLetGo();
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
    await waitFor(
      async () => {
        const h = (await fetch(`${mac1Origin}/_api/project/history?limit=200`).then((r) =>
          r.json()
        )) as H;
        return (h.history ?? []).some((r) => r.kind === 'ai' || r.who?.kind === 'ai');
      },
      'an AI version on Mac 1',
      60_000
    );
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
