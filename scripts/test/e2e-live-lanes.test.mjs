// P8 e2e live lanes — the offline proof that the desktop e2e lanes which "need a real AI / hub / cell" run on stand-ins.
//
//   1. the LOCAL hub the cloud / team-project lanes sit on really boots (Node 24) and signs a person in with a
//      control-plane-minted project token — and refuses a token minted with another key;
//   2. the lane wiring: every AI lane's conf installs the fake agent, none of the six lanes can reach a production
//      host, the specs read hooks that exist (testids.json + the strip's own source), and a spec that reads a hook
//      living inside the AI panel's closed-by-default Advanced fold opens the fold first.
//
// Nothing here starts the desktop app or a browser: the lanes themselves run when the screen is free.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const E2E = join(REPO, 'apps/desktop/e2e');
const hub = await import(pathToFileURL(join(E2E, 'fixtures/local-hub.mjs')).href);

const post = (url, body, headers = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

test('findNode24 answers a Node whose ABI is 137 and ignores a pin that is not one', () => {
  const bin = hub.findNode24();
  assert.ok(bin);
  // a pin that does not exist (or is the wrong Node) is skipped, not trusted
  const viaBadPin = hub.findNode24({ ...process.env, MAUDE_E2E_NODE: '/nonexistent/node' });
  assert.equal(
    execFileSync(viaBadPin, ['-p', 'process.versions.modules'], { encoding: 'utf8' }).trim(),
    '137'
  );
});

test('a local cloud-mode hub signs in a control-plane project token, and refuses another key’s', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maude-e2e-live-hub-'));
  const key = 'e2e-project-token-key';
  const h = await hub.startLocalHub({ dir, cloudKey: key });
  try {
    assert.match(h.http, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal((await fetch(`${h.http}/health`)).status, 200);

    const good = await hub.mintProjectToken(key, { email: 'e2e@example.com', role: 'owner' });
    const ok = await post(`${h.http}/auth/login`, { token: good });
    assert.equal(ok.status, 200, await ok.clone().text());
    const session = await ok.json();
    assert.ok(session.token, 'a session token comes back');

    const forged = await hub.mintProjectToken('some-other-key', {
      email: 'e2e@example.com',
      role: 'owner',
    });
    assert.equal((await post(`${h.http}/auth/login`, { token: forged })).status, 401);
    const expired = await hub.mintProjectToken(key, {
      email: 'e2e@example.com',
      role: 'owner',
      ttlMs: -1000,
    });
    assert.equal((await post(`${h.http}/auth/login`, { token: expired })).status, 401);
  } finally {
    h.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── lane wiring ────────────────────────────────────────────────────────────────────────────────────────────────
const read = (rel) => readFileSync(join(E2E, rel), 'utf8');

test('every AI lane conf installs the fake agent; its specs fail (not skip) when the AI is missing', () => {
  for (const conf of ['wdio.acp-fake.conf.ts', 'wdio.ai-quit.conf.ts']) {
    assert.match(read(conf), /\buseFakeAi\(\)/, `${conf} must call useFakeAi()`);
  }
  for (const spec of ['acp-capability-picker', 'acp-write-scope', 'ai-quit']) {
    const src = read(`scenarios/${spec}.e2e.ts`);
    assert.match(
      src,
      /\brequireAi\(this\)/,
      `${spec} must gate on requireAi (a stub lane never skips quietly)`
    );
    assert.doesNotMatch(
      src,
      /\baiConnected\(\)/,
      `${spec} must not skip on aiConnected() directly`
    );
  }
});

test('the fake-AI helper refuses a config home that is not a throwaway', () => {
  const src = read('helpers/fake-ai.ts');
  assert.match(src, /maude-e2e-/);
  assert.match(src, /refusing to run/);
});

test('cloud and team-project lanes sit on the local hub, never a real one', () => {
  const cloud = read('wdio.cloud.conf.ts');
  assert.match(cloud, /startLocalHub/);
  assert.match(cloud, /mintProjectToken/);
  assert.match(
    cloud,
    /const cell = hubUrl\(\)/,
    'the stub control plane must hand out the local hub as the cell'
  );
  assert.doesNotMatch(cloud, /req\.url === '\/auth\/login'/, '/auth/login is the local hub’s own');
  const team = read('wdio.team-project.conf.ts');
  assert.match(team, /startLocalHub/);
  // a first run for real: Home's first-run flag cleared, a fresh index, the real `claude` held off
  assert.match(team, /join\('home', 'home\.json'\)/);
  assert.match(team, /MAUDE_INDEX_DIR/);
  assert.match(team, /useStubClaude\(\)|useFakeAi\(\)/, 'the stub `claude` first on PATH (useFakeAi includes it)');
  // V2-8.18: the Docker gate may point this lane at a container — only a loopback one, refused at runtime otherwise
  if (/MAUDE_E2E_HUB_TARGET/.test(team)) {
    assert.match(team, /assertLoopbackHubTarget\(target\.http\)/, 'the target is checked before it is believed');
    const guard = team.slice(team.indexOf('function assertLoopbackHubTarget'));
    assert.match(guard, /'127\.0\.0\.1', 'localhost', '\[::1\]', '::1'/);
    assert.match(guard, /throw new Error/);
    assert.doesNotMatch(guard.slice(0, guard.indexOf('\n}\n')), /\.cloud\.maude\.sh|studyfi|maude\.sh/);
  }
});

test('team-project refuses a hub target that is not loopback (behaviour of the guard itself)', () => {
  const team = read('wdio.team-project.conf.ts');
  const m = team.match(/export function assertLoopbackHubTarget[\s\S]*?\n}\n/);
  assert.ok(m, 'the guard is exported by name');
  const body = m[0].replace('export function', 'function').replace('(url: string): void', '(url)');
  const guard = new Function(`${body}; return assertLoopbackHubTarget;`)();
  for (const ok of ['http://127.0.0.1:8080', 'http://localhost:9', 'http://[::1]:7/']) {
    assert.doesNotThrow(() => guard(ok), ok);
  }
  for (const bad of ['https://hub.maude.sh', 'http://10.0.0.5:8080', 'http://127.0.0.1.evil.test', 'nonsense', '']) {
    assert.throws(() => guard(bad), /loopback hub only/, bad);
  }
});

test('the two-Mac AI runs lane sits on a local hub and throwaway projects, never the committed fixture', () => {
  const conf = read('wdio.ai-runs.conf.ts');
  assert.match(conf, /startLocalHub/);
  assert.match(conf, /process\.env\.MAUDE_PROJECT_ROOT = mac1Root/);
  assert.match(conf, /HUBS_CONFIG_PATH/);
  assert.match(conf, /MAUDE_APP_BOUND_HUB/);
  assert.match(conf, /useStubClaude\(\)/);
  const spec = read('multiplayer/ai-runs.e2e.ts');
  assert.doesNotMatch(spec, /process\.env\.MAUDE_PROJECT_ROOT/, 'the fake run would write into the repo fixture');
  assert.match(spec, /MAUDE_E2E_AI_RUNS/);
});

// The one place a lane may name a Maude Cloud host: the cell-tab lane's door URL. `*.cloud.maude.sh` has no wildcard
// record (NXDOMAIN) — the tab is created and pinned, the page itself never loads; the Rust door rule (windows.rs
// `cell_door`) accepts nothing else, so the lane cannot name a local cell.
const HOST_OK =
  /^(127\.0\.0\.1|localhost|\[::1\]|[\w-]+\.localhost|example\.com|[\w.-]*\.x\.test|x\.test|e2e-cell\.cloud\.maude\.sh|view-e2e-cell\.cloud\.maude\.sh|evil\.example)$/;
const LANE_FILES = [
  'wdio.acp-fake.conf.ts',
  'wdio.ai-quit.conf.ts',
  'wdio.ai-runs.conf.ts',
  'multiplayer/ai-runs.e2e.ts',
  'wdio.cell-tab.conf.ts',
  'wdio.cloud.conf.ts',
  'wdio.team-project.conf.ts',
  'scenarios/acp-capability-picker.e2e.ts',
  'scenarios/acp-write-scope.e2e.ts',
  'scenarios/ai-quit.e2e.ts',
  'scenarios/cell-tab-browser-door.e2e.ts',
  'scenarios/cloud-attach.e2e.ts',
  'scenarios/team-project.e2e.ts',
  'helpers/fake-ai.ts',
  'fixtures/local-hub.mjs',
  'fixtures/fake-acp/scripted-agent.mjs',
];

test('no lane file names a host outside loopback / test domains (no production hub, cell, Stripe, Cloudflare)', () => {
  for (const f of LANE_FILES) {
    for (const m of read(f).matchAll(/\bhttps?:\/\/([^\s/'"`$:?#)]+)/g)) {
      const host = m[1];
      if (host.startsWith('<') || host.includes('{')) continue;
      assert.match(host, HOST_OK, `${f} names ${host}`);
    }
  }
});

// ── the hooks the six lanes read exist ───────────────────────────────────────────────────────────────────────────
// `testids.json` is the hook contract (apps/studio/client/TESTIDS.md); the tab strip is its own page
// (apps/desktop/src/strip.{html,js}) and keeps its hooks there.
const ids = JSON.parse(readFileSync(join(REPO, 'apps/studio/client/testids.json'), 'utf8'));
const exact = new Map(ids.filter((e) => !e.pattern).map((e) => [e.hook, e]));
const patterns = ids
  .filter((e) => e.pattern)
  .map((e) => [
    new RegExp(`^${e.hook.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/<[^>]+>/g, '.+')}$`),
    e,
  ]);
const stripSrc = ['strip.html', 'strip.js']
  .map((f) => readFileSync(join(REPO, 'apps/desktop/src', f), 'utf8'))
  .join('\n');

/** Every `data-testid` a source names literally: `tid('x')` and `[data-testid="x"]`. */
function testidsUsed(src) {
  const out = new Set();
  for (const m of src.matchAll(/data-testid=["']?([\w.<>:-]+?)["']?\]/g)) out.add(m[1]);
  for (const m of src.matchAll(/\btid\((['"])([^'"]+)\1\)/g)) out.add(m[2]);
  return [...out].filter((h) => !h.includes('${'));
}

/** Why a hook does not resolve ('' = it does). */
function unresolvedHook(hook) {
  const e = exact.get(hook) ?? patterns.find(([re]) => re.test(hook))?.[1];
  if (e) return e.v2 === 'retired' ? 'retired in testids.json' : '';
  // the strip's own hooks: tab-dot (strip.js), tab-home (strip.html); tab-<label> is dynamic and never read here
  if (/^tab-(dot|home)$/.test(hook) && stripSrc.includes(hook)) return '';
  return 'not in testids.json and not drawn by the strip';
}

const SPECS = [
  'scenarios/acp-capability-picker.e2e.ts',
  'scenarios/acp-write-scope.e2e.ts',
  'scenarios/ai-quit.e2e.ts',
  'scenarios/cell-tab-browser-door.e2e.ts',
  'scenarios/cloud-attach.e2e.ts',
  'scenarios/team-project.e2e.ts',
  'helpers/assistant.ts',
];

test('every hook the six lanes read resolves (testids.json, or the strip’s own page)', () => {
  const bad = [];
  for (const f of SPECS) {
    for (const hook of testidsUsed(read(f))) {
      const why = unresolvedHook(hook);
      if (why) bad.push(`${f}: ${hook} — ${why}`);
    }
  }
  assert.deepEqual(bad, []);
});

// Hooks that exist only while a CLOSED-BY-DEFAULT container is open: reading them without opening it first finds
// nothing (the fold's body is not in the DOM at all while it is shut — fold/advanced-fold.jsx).
const BEHIND_A_FOLD = [
  {
    hook: 'chat-mode-picker',
    opener: /\bopenAdvanced\b|\bsetPermissionMode\b|\bpickMode\b/,
    fold: 'the AI panel’s Advanced fold',
  },
];

test('a spec that reads a hook inside a closed-by-default fold opens the fold (directly or via a helper that does)', () => {
  const helpers = read('helpers/assistant.ts');
  // the helpers themselves open it before they read the picker
  for (const fn of ['pickMode', 'setPermissionMode']) {
    const body = helpers.slice(helpers.indexOf(`export async function ${fn}`));
    assert.match(body.slice(0, 1200), /await openAdvanced\(\)/, `${fn} must open the fold first`);
  }
  for (const f of SPECS.filter((s) => s.startsWith('scenarios/'))) {
    const src = read(f);
    for (const { hook, opener, fold } of BEHIND_A_FOLD) {
      if (!src.includes(`'${hook}'`)) continue;
      assert.match(src, opener, `${f} reads ${hook} (inside ${fold}) without opening it`);
    }
  }
});

test('the picker spec uses the plain words and the live roster, not the v1 "Manual" label or a "/" warm-up', () => {
  const src = read('scenarios/acp-capability-picker.e2e.ts');
  assert.doesNotMatch(src, /\/manual\/i\.test/);
  assert.doesNotMatch(src, /addValue\('\/'\)/, 'the visible chat warms its own session');
  assert.match(src, /\['acceptEdits', 'default', 'plan'\]/);
});
