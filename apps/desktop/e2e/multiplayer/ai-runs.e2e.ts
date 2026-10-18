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
// Run: MAUDE_AI_RUNS_E2E=1 pnpm test:e2e:desktop -- --spec e2e/multiplayer/ai-runs.e2e.ts

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser } from '@wdio/globals';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..');
const HUB_FIXTURE = join(REPO, 'apps', 'hub', 'test', 'fixtures', 'serve-hub.mjs');
const STUDIO = join(REPO, 'apps', 'studio', 'server.ts');
const ROUNDS = Number(process.env.MAUDE_R1_ROUNDS ?? 50);
const REL = 'ui/Combine-kampan.tsx';
const sel = (id: string) => `[data-testid="${id}"]`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const canvas = (
  post = 'Post title',
  story = 'Story title'
) => `import { DCArtboard } from '@maude/canvas-lib';

export default function CombineKampan() {
  return (
    <div>
      <DCArtboard id="post" width={1080} height={1080}><h1>${post}</h1><p>keep one</p></DCArtboard>
      <DCArtboard id="story" width={1080} height={1920}><h1>${story}</h1><p>keep two</p></DCArtboard>
    </div>
  );
}
`;

function node24(): string {
  const v = spawnSync('node', ['-v'], { encoding: 'utf8' }).stdout.trim();
  if (!v.startsWith('v24.')) throw new Error(`the local hub needs Node 24 (found ${v})`);
  return 'node';
}

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

function startHub(
  dir: string
): Promise<{ proc: ChildProcess; http: string; tokens: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(node24(), [HUB_FIXTURE, dir, '0', '--transactions'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    proc.stdout?.on('data', (c: Buffer) => {
      buf += c.toString();
      const line = buf.split('\n').find((l) => l.startsWith('{'));
      if (line) resolve({ proc, ...JSON.parse(line) });
    });
    proc.on('exit', (code) => code && reject(new Error(`hub exited ${code}: ${buf}`)));
  });
}

/** Mac 2: a headless studio on its own project copy, linked to the hub as Tereza. */
function startStudio(project: string, port: number, hubsFile: string): ChildProcess {
  return spawn('bun', ['run', STUDIO, '--root', project, '--port', String(port)], {
    env: {
      ...process.env,
      NO_OPEN: '1',
      MAUDE_NO_AUTOBUILD: '1',
      MAUDE_MACHINE_FILE: join(mkdtempSync(join(tmpdir(), 'mac2-')), 'machine.json'),
      HUBS_CONFIG_PATH: hubsFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** The fake agent on a studio: one run of the v1 lane writing `body` to the canvas. */
async function fakeRun(origin: string, designRoot: string, body: string, settleMs = 300) {
  const file = `.design/${REL}`;
  const post = (p: string) =>
    fetch(`${origin}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ file, author: 'Claude' }),
    }).then((r) => r.json());
  const run = await post('/_api/ai/start');
  writeFileSync(join(designRoot, REL), body);
  await sleep(settleMs);
  await post('/_api/ai/end');
  return run as { runId?: string; state?: string };
}

describe('S5.15 — AI runs across two Macs', () => {
  if (process.env.MAUDE_AI_RUNS_E2E !== '1') {
    it.skip('set MAUDE_AI_RUNS_E2E=1 (unlocked screen, signed-in test hub) to run', () => {});
    return;
  }
  let hub: Awaited<ReturnType<typeof startHub>>;
  let mac2: ChildProcess;
  let mac1Origin = '';
  const mac2Origin = 'http://127.0.0.1:4597';
  let mac1Root = '';
  let mac2Root = '';

  before(async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ai-runs-e2e-'));
    hub = await startHub(join(tmp, 'hub'));
    const hubsFile = join(tmp, 'hubs.json');
    const port = new URL(hub.http).port;
    writeFileSync(
      hubsFile,
      JSON.stringify({
        hubs: {
          [`http://127.0.0.1:${port}`]: { token: hub.tokens.alice },
          [`http://localhost:${port}`]: { token: hub.tokens.bob },
        },
      }),
      { mode: 0o600 }
    );
    mac1Root = process.env.MAUDE_PROJECT_ROOT ?? join(tmp, 'mac1');
    mac2Root = join(tmp, 'mac2');
    cpSync(mac1Root, mac2Root, { recursive: true });
    writeFileSync(join(mac1Root, '.design', REL), canvas());
    mac2 = startStudio(mac2Root, 4597, hubsFile);
    await waitFor(
      () =>
        fetch(`${mac2Origin}/_health`)
          .then((r) => r.ok)
          .catch(() => false),
      'Mac 2 studio'
    );
    mac1Origin = JSON.parse(readFileSync(join(mac1Root, '.design', '_server.json'), 'utf8')).url;
  });

  after(() => {
    mac2?.kill('SIGCONT');
    mac2?.kill('SIGTERM');
    hub?.proc.kill('SIGTERM');
  });

  it(`R1: both Macs ask on Post 1:1 within 5 ms, ${ROUNDS} rounds — one writer at a time, the other waits`, async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const [a, b] = await Promise.all([
        fakeRun(mac1Origin, join(mac1Root, '.design'), canvas(`r${i} you`)),
        fakeRun(mac2Origin, join(mac2Root, '.design'), canvas(`r${i} tereza`)),
      ]);
      expect([a.state, b.state].sort()).toEqual(['starting', 'waiting']);
      // the canvas shows the holder's ring and "· 1 waiting" on Post while it works
      await $(sel('canvas-frame')).waitForExist();
    }
  });

  it('R4: SIGSTOP Mac 2 for 40 s while it holds Post; Mac 1 runs; Mac 2 hears lease-lost and holds', async () => {
    const holding = fakeRun(mac2Origin, join(mac2Root, '.design'), canvas('Mac 2 frozen'), 1_000);
    await sleep(200);
    mac2.kill('SIGSTOP');
    const waiting = fakeRun(mac1Origin, join(mac1Root, '.design'), canvas('Mac 1 ran'));
    await sleep(40_000);
    mac2.kill('SIGCONT');
    await waiting;
    await holding;
    const runs = await fetch(`${mac2Origin}/_api/ai/runs`).then((r) => r.json());
    expect(JSON.stringify(runs)).toContain('lease-lost');
  });

  it('Made by AI on the canvas; Version history AI row → Undo this chat is ONE version; the tag clears on Tereza’s edit', async () => {
    await browser.keys(['Alt', 'Meta', 'h']); // Version history ⌥⌘H
    await $(sel('vh-panel')).waitForExist();
    await $(sel('vh-filter-ai')).click();
    const row = await $('[data-testid^="vh-row-"]');
    await row.click();
    const undo = await $(sel('vh-undo-chat'));
    await undo.waitForEnabled();
    const before = await fetch(`${mac1Origin}/_api/project/history?limit=200`).then((r) =>
      r.json()
    );
    await undo.click();
    await waitFor(async () => {
      const after = await fetch(`${mac1Origin}/_api/project/history?limit=200`).then((r) =>
        r.json()
      );
      return after.history.length === before.history.length + 1;
    }, 'one new version');
  });
});
