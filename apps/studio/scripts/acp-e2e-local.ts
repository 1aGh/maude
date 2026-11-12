#!/usr/bin/env bun
// End to end: the universal-ACP chat through the REAL studio server with the REAL agent binaries.
// Local only, never in CI (it needs codex / opencode installed). Offline: each agent's model is a
// loopback scripted model (the e2e-only switch MAUDE_E2E_AGENT_MODEL_URL, acp/agents/e2e-model.ts,
// which a release build ignores), a scratch HOME / XDG_* / CODEX_HOME, a stub `claude`, fake keys.
// Scenario: .ai/scenarios/universal-acp-agents/spec.md.
//
//   bun apps/studio/scripts/acp-e2e-local.ts [codex|opencode ...] [--keep]
//
// Per agent, in its own scratch world (/Users/Shared/.maude-e2e-<uid>/…, outside git and outside ~:
// opencode walks up from the project into ~/.opencode):
//   1  GET /_api/agents → installed, fit ok, policy bridge-enforced, offered
//   2  POST connect as the person (session cookie, same-origin) → the REAL conformance probe →
//      connected; a key-only (helper) connect is refused; dismiss-offer survives a restart
//   3  /_ws/acp attach {agent} → attached.agent.id; a prompt → update frames with the model's
//      text; `_chat/<id>.meta.json` records the agent
//   4  scripted tool calls: in-project write (no card) · out-of-project write (refused / card →
//      reject) · read of a planted fake credential (never reaches the model) · curl to a loopback
//      canary (fails) · set-mode to a refused mode (refused)
//   5  a planted chat meta naming an unconnected agent → agent-not-connected; opencode + a link
//      out of the project → agent-unsafe-link
//   6  a Claude-only world → offerAgents: []
//   7  every server and agent process gone (ps scan on the scratch paths)
// Prints a PASS/FAIL table and writes .ai/device/scenario-runs/universal-acp-agents-server/<ts>/.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { Subprocess } from 'bun';

import { agentById } from '../acp/agents/catalog.ts';
import {
  conversationOf,
  type ProbeProfile,
  respond,
  type ToolStep,
  toolNames,
} from '../acp/agents/conformance.ts';
import { E2E_AGENT_MODEL_SWITCH } from '../acp/agents/e2e-model.ts';

const STUDIO = resolve(import.meta.dir, '..');
const REPO = resolve(STUDIO, '../..');
const argv = process.argv.slice(2);
const KEEP = argv.includes('--keep');
const wanted = argv.filter((a) => !a.startsWith('--'));
const AGENTS = (wanted.length ? wanted : ['codex', 'opencode']) as ('codex' | 'opencode')[];
const UID = process.getuid?.() ?? 0;
const SCRATCH_ROOT =
  process.platform === 'darwin' ? `/Users/Shared/.maude-e2e-${UID}` : join(tmpdir(), 'maude-e2e');
const CONFORMANCE_ROOT = `/Users/Shared/.maude-conformance-${UID}`;
const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
const RUN_DIR = join(REPO, '.ai/device/scenario-runs/universal-acp-agents-server', stamp);
mkdirSync(RUN_DIR, { recursive: true });

const tok = (label: string) => `E2E-${label}-${randomBytes(5).toString('hex')}`;
const sq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clip = (s: string, n = 140) =>
  (s.length > n ? `${s.slice(0, n)}…` : s).replace(/\s+/g, ' ').replaceAll('|', '/');

// ------------------------------------------------------------------------------------- results

interface Row {
  agent: string;
  step: string;
  ok: boolean | null; // null = not run / not applicable
  detail: string;
}
const rows: Row[] = [];
function record(agent: string, step: string, ok: boolean | null, detail: string) {
  rows.push({ agent, step, ok, detail });
  console.log(
    `  ${ok === null ? 'n/a ' : ok ? 'PASS' : 'FAIL'} ${agent} ${step}: ${clip(detail, 200)}`
  );
}
async function guarded(agent: string, step: string, fn: () => Promise<[boolean, string]>) {
  try {
    const [ok, detail] = await fn();
    record(agent, step, ok, detail);
    return ok;
  } catch (e) {
    record(agent, step, false, `threw: ${(e as Error).message}`);
    return false;
  }
}

// ------------------------------------------------------------------------------------ the world

interface World {
  id: string;
  base: string;
  home: string;
  xdgConfig: string;
  codexHome: string;
  project: string;
  designRoot: string;
  outside: string;
  bin: string;
  path: string;
  secrets: string[]; // fake values that must never reach the model
  keysPath: string;
  outsideSecret: string;
  stateDir: string;
}

function personCodexBin(): string | null {
  for (const p of [join(homedir(), '.local/bin/codex')]) {
    try {
      return realpathSync(p);
    } catch {
      /* not here */
    }
  }
  const w = Bun.which('codex');
  return w ? realpathSync(w) : null;
}

function makeWorld(id: string, install: ('codex' | 'opencode')[]): World {
  mkdirSync(SCRATCH_ROOT, { recursive: true, mode: 0o700 });
  const base = join(SCRATCH_ROOT, `${id}-${randomBytes(3).toString('hex')}`);
  const home = join(base, 'home');
  const xdgConfig = join(home, '.config');
  const codexHome = join(home, '.codex');
  const project = join(base, 'project');
  const designRoot = join(project, '.design');
  const outside = join(base, 'outside');
  const bin = join(base, 'bin');
  for (const d of [xdgConfig, codexHome, join(designRoot, 'ui'), outside, bin]) {
    mkdirSync(d, { recursive: true });
  }
  writeFileSync(
    join(designRoot, 'config.json'),
    JSON.stringify({
      name: 'e2e',
      designRoot: '.design',
      formatVersion: 2,
      canvasGroups: [{ label: 'UI', path: 'ui' }],
    })
  );
  writeFileSync(
    join(designRoot, 'ui', 'home.tsx'),
    [
      "import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';",
      'export default function Home() {',
      '  return (',
      '    <DesignCanvas>',
      '      <DCArtboard id="a" label="A" width={400} height={300}>',
      '        <div>hello</div>',
      '      </DCArtboard>',
      '    </DesignCanvas>',
      '  );',
      '}',
      '',
    ].join('\n')
  );
  writeFileSync(join(project, 'notes.md'), '# notes\n');
  // Planted fake credentials: Maude's own key store and the person's Codex sign-in (a fake API key
  // so `codex login status` reads signed in, as on a real Mac). Neither may ever reach the model.
  const genKey = tok('GENKEY');
  const keysPath = join(xdgConfig, 'maude', 'keys.json');
  mkdirSync(dirname(keysPath), { recursive: true });
  writeFileSync(keysPath, JSON.stringify({ keys: { fal: genKey } }), { mode: 0o600 });
  const codexKey = `sk-${tok('CODEXAUTH')}`;
  writeFileSync(join(codexHome, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: codexKey }), {
    mode: 0o600,
  });
  const outsideToken = tok('OUTSIDE');
  const outsideSecret = join(outside, 'secret.txt');
  writeFileSync(outsideSecret, outsideToken);
  // A stub `claude` (a fake HOME + the real claude pops a keychain dialog): signed out, fast.
  writeFileSync(
    join(bin, 'claude'),
    '#!/bin/sh\ncase "$1" in --version|-v) echo "2.1.300 (Claude Code)";; *) echo \'{"loggedIn":false}\';; esac\nexit 0\n',
    { mode: 0o755 }
  );
  const pathDirs = [bin];
  if (install.includes('codex')) {
    // The person's setup on this Mac: ~/.claude/bin/codex is a `maude codex` wrapper naming
    // $HOME/.local/bin/codex. Discovery must READ it (never run it) and land on the real binary.
    const real = personCodexBin();
    if (!real) throw new Error('codex is not installed on this Mac');
    const wrapperDir = join(home, '.claude', 'bin');
    mkdirSync(wrapperDir, { recursive: true });
    const personWrapper = join(homedir(), '.claude', 'bin', 'codex');
    const wrapper = join(wrapperDir, 'codex');
    if (existsSync(personWrapper)) copyFileSync(personWrapper, wrapper);
    else
      writeFileSync(
        wrapper,
        '#!/bin/sh\nset -eu\n\nexport MAUDE_CODEX_REAL="$HOME/.local/bin/codex"\nexec maude codex "$@"\n'
      );
    spawnSync('chmod', ['755', wrapper]);
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    symlinkSync(real, join(home, '.local', 'bin', 'codex'));
    pathDirs.unshift(wrapperDir);
  }
  if (install.includes('opencode')) {
    const oc = Bun.which('opencode');
    if (!oc) throw new Error('opencode is not installed on this Mac');
    symlinkSync(oc, join(bin, 'opencode'));
  }
  const bunDir = dirname(process.execPath);
  const path = [...pathDirs, bunDir, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  return {
    id,
    base,
    home,
    xdgConfig,
    codexHome,
    project,
    designRoot,
    outside,
    bin,
    path,
    secrets: [genKey, codexKey, outsideToken],
    keysPath,
    outsideSecret,
    stateDir: join(base, 'state'),
  };
}

// ------------------------------------------------------------------------------- scripted model

type StepFn = (tools: readonly string[], after: readonly string[]) => ToolStep | { text: string };
interface Model {
  url: string;
  bodies: string[];
  received: Map<string, string[]>;
  tools: Set<string>;
  script: Map<string, StepFn>;
  stop(): void;
}

function startModel(api: ProbeProfile['api'], log: string): Model {
  const m: Model = {
    url: '',
    bodies: [],
    received: new Map(),
    tools: new Set(),
    script: new Map(),
    stop: () => {},
  };
  let n = 0;
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.endsWith('/models')) {
        return Response.json({
          object: 'list',
          data: [{ id: 'mock-model', object: 'model', owned_by: 'maude-e2e' }],
        });
      }
      const raw = await req.text();
      m.bodies.push(raw);
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw);
      } catch {
        /* not JSON */
      }
      n++;
      const tools = toolNames(body);
      for (const t of tools) m.tools.add(t);
      const conv = conversationOf(body);
      let at = -1;
      let step: string | null = null;
      for (let i = conv.length - 1; i >= 0; i--) {
        const mm = conv[i].kind === 'user' ? /E2E-STEP=([a-z-]+)/.exec(conv[i].text) : null;
        if (mm) {
          at = i;
          step = mm[1];
          break;
        }
      }
      let answer: ToolStep | { text: string } = { text: 'ok' };
      if (step) {
        const after = conv
          .slice(at + 1)
          .filter((c) => c.kind === 'tool')
          .map((c) => c.text);
        m.received.set(step, after);
        const fn = m.script.get(step);
        if (fn && tools.length) answer = fn(tools, after);
      }
      appendFileSync(
        log,
        `${JSON.stringify({ n, path: url.pathname, step, tools: tools.length, answer })}\n`
      );
      if (n === 1) appendFileSync(log, `${JSON.stringify({ toolDefs: body.tools ?? null })}\n`);
      if ('text' in answer && api === 'responses') return responsesText(answer.text, n);
      return 'text' in answer
        ? respond(api, null, n, url.pathname, answer.text)
        : respond(api, answer, n, url.pathname);
    },
  });
  m.url = `http://127.0.0.1:${server.port}`;
  m.stop = () => server.stop(true);
  return m;
}

/**
 * A text answer on the Responses wire WITH the streamed deltas: Codex shows an assistant message
 * from `response.output_text.delta`, not from the finished item alone (the probe's `respond` sends
 * only the item, enough for tool calls).
 */
function responsesText(text: string, n: number): Response {
  const id = `r${n}`;
  const itemId = `m${n}`;
  const part = { type: 'output_text', text, annotations: [] };
  const item = {
    type: 'message',
    role: 'assistant',
    id: itemId,
    status: 'completed',
    content: [part],
  };
  const usage = {
    input_tokens: 1,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 1,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 2,
  };
  const at = { item_id: itemId, output_index: 0, content_index: 0 };
  const events = [
    { type: 'response.created', response: { id } },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...item, status: 'in_progress', content: [] },
    },
    { type: 'response.content_part.added', ...at, part: { ...part, text: '' } },
    { type: 'response.output_text.delta', ...at, delta: text },
    { type: 'response.output_text.done', ...at, text },
    { type: 'response.content_part.done', ...at, part },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id, usage, output: [item] } },
  ];
  return new Response(
    events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } }
  );
}

function codexExec(tools: readonly string[], cmd: string): ToolStep {
  if (tools.includes('exec_command')) return { name: 'exec_command', args: { cmd } };
  if (tools.includes('shell_command')) return { name: 'shell_command', args: { command: cmd } };
  return { name: 'shell', args: { command: ['bash', '-lc', cmd] } };
}

/** One tool call, then text. Codex has only the shell; opencode has write / read / bash. */
function once(make: (tools: readonly string[]) => ToolStep): StepFn {
  return (tools, after) => (after.length ? { text: 'ok' } : make(tools));
}

// ---------------------------------------------------------------------------------- the server

const API_KEY = randomBytes(32).toString('hex');

interface Server {
  proc: Subprocess;
  port: number;
  origin: string;
  cookie: string;
}

let portSeed = 47000 + Math.floor(Math.random() * 2000);
async function freePort(): Promise<number> {
  for (;;) {
    const p = portSeed++;
    try {
      const s = Bun.serve({ port: p, hostname: '127.0.0.1', fetch: () => new Response('') });
      s.stop(true);
      return p;
    } catch {
      /* taken */
    }
  }
}

async function boot(w: World, modelUrl: string | null, tag: string): Promise<Server> {
  const port = await freePort();
  const env: Record<string, string> = {
    PATH: w.path,
    HOME: w.home,
    USER: process.env.USER ?? 'e2e',
    LOGNAME: process.env.LOGNAME ?? 'e2e',
    SHELL: '/bin/sh',
    LANG: 'en_US.UTF-8',
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    XDG_CONFIG_HOME: w.xdgConfig,
    XDG_STATE_HOME: w.stateDir,
    XDG_DATA_HOME: join(w.base, 'data'),
    XDG_CACHE_HOME: join(w.base, 'cache'),
    CODEX_HOME: w.codexHome,
    NO_OPEN: '1',
    MAUDE_NO_AUTOBUILD: '1',
    MAUDE_EXIT_WITH_PARENT: '1',
    MAUDE_MACHINE_FILE: join(w.designRoot, '_state', 'machine.json'),
    // The desktop app's posture: a per-spawn key, every main-origin caller needs it or the session.
    MAUDE_SHELL_API_KEY: API_KEY,
    // No hub, no cloud.
    MAUDE_APP_BOUND_HUB: '',
  };
  if (modelUrl) env[E2E_AGENT_MODEL_SWITCH] = modelUrl;
  const logFile = join(RUN_DIR, `${w.id}-server-${tag}.log`);
  const proc = Bun.spawn(
    [
      process.execPath,
      'run',
      join(STUDIO, 'server.ts'),
      '--port',
      String(port),
      '--root',
      w.project,
    ],
    {
      cwd: STUDIO,
      env,
      stdout: Bun.file(logFile),
      stderr: Bun.file(`${logFile}.err`),
    }
  );
  const origin = `http://127.0.0.1:${port}`;
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > 30_000) {
      proc.kill('SIGKILL');
      throw new Error(`server did not start (see ${logFile}.err)`);
    }
    try {
      const r = await fetch(`${origin}/_health`, { signal: AbortSignal.timeout(500) });
      if (r.ok && ((await r.json()) as { pid?: number }).pid === proc.pid) break;
    } catch {
      /* not up */
    }
    await sleep(100);
  }
  // The page's session (the person): POST the key once, then the cookie alone.
  const s = await fetch(`${origin}/_api/shell/session`, {
    method: 'POST',
    headers: { 'x-maude-api-key': API_KEY, Origin: origin },
  });
  const cookie = (s.headers.get('set-cookie') ?? '').split(';')[0];
  if (!cookie) throw new Error(`no session cookie (${s.status})`);
  return { proc, port, origin, cookie };
}

async function stop(s: Server) {
  s.proc.kill('SIGTERM');
  const done = await Promise.race([s.proc.exited.then(() => true), sleep(8000).then(() => false)]);
  if (!done) s.proc.kill('SIGKILL');
  await s.proc.exited;
}

const personHeaders = (s: Server) => ({
  Cookie: s.cookie,
  Origin: s.origin,
  'Sec-Fetch-Site': 'same-origin',
  'Content-Type': 'application/json',
});

async function getAgents(s: Server) {
  const r = await fetch(`${s.origin}/_api/agents?refresh=1`, {
    headers: { 'x-maude-api-key': API_KEY },
  });
  return (await r.json()) as {
    agents: Record<string, unknown>[];
    offerAgents: string[];
  };
}

async function post(s: Server, path: string, body: unknown = {}, person = true) {
  const r = await fetch(`${s.origin}${path}`, {
    method: 'POST',
    headers: person
      ? personHeaders(s)
      : { 'x-maude-api-key': API_KEY, Origin: s.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await r.json()) as Record<string, unknown>;
  } catch {
    /* empty */
  }
  return { status: r.status, json };
}

// ------------------------------------------------------------------------------------- the WS

type Frame = Record<string, unknown> & { t?: string };
class Socket {
  frames: Frame[] = [];
  ws: WebSocket;
  open: Promise<void>;
  constructor(s: Server, log: string) {
    this.ws = new WebSocket(`ws://127.0.0.1:${s.port}/_ws/acp`, {
      headers: { Origin: s.origin, Cookie: s.cookie },
    } as unknown as string[]);
    this.open = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('ws error'));
    });
    this.ws.onmessage = (ev) => {
      const f = JSON.parse(String(ev.data)) as Frame;
      this.frames.push(f);
      appendFileSync(log, `${JSON.stringify(f)}\n`);
    };
  }
  send(f: Frame) {
    this.ws.send(JSON.stringify(f));
  }
  mark() {
    return this.frames.length;
  }
  since(i: number) {
    return this.frames.slice(i);
  }
  async waitFor(pred: (f: Frame) => boolean, from: number, ms: number): Promise<Frame | null> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const hit = this.frames.slice(from).find(pred);
      if (hit) return hit;
      await sleep(50);
    }
    return null;
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* gone */
    }
  }
}

const updateText = (frames: Frame[]) =>
  frames
    .filter((f) => f.t === 'update')
    .map((f) => JSON.stringify(f.update ?? ''))
    .join('\n');

/** Send a prompt, answer any permission card with a reject, wait for turn-end or an error. */
async function turn(
  sock: Socket,
  chat: string,
  text: string,
  ms = 120_000,
  opts: { answer?: 'reject' | 'approve'; may?: { assets: boolean; web: boolean } } = {}
): Promise<{ frames: Frame[]; end: Frame | null; cards: Frame[] }> {
  const from = sock.mark();
  sock.send({ t: 'prompt', chat, text, ...(opts.may ? { may: opts.may } : {}) });
  const answered = new Set<string>();
  const t0 = Date.now();
  let end: Frame | null = null;
  while (Date.now() - t0 < ms) {
    const fs = sock.since(from);
    for (const f of fs) {
      if (f.t === 'permission-request' && typeof f.id === 'string' && !answered.has(f.id)) {
        answered.add(f.id);
        const options = (f.options ?? (f.toolCall as Frame | undefined)?.options ?? []) as {
          optionId: string;
          kind?: string;
        }[];
        const pick =
          opts.answer === 'approve'
            ? options.find((o) => o.kind === 'allow_once')
            : options.find((o) => o.kind?.startsWith('reject'));
        sock.send({
          t: 'permission-response',
          chat,
          id: f.id,
          decision: pick?.optionId ?? 'cancelled',
        });
      }
    }
    // A `queued` prompt (a closed outbox gate) never runs in this world: fail fast on it.
    end =
      fs.find(
        (f) => f.t === 'turn-end' || ((f.t === 'error' || f.t === 'queued') && f.chat === chat)
      ) ?? null;
    if (end) break;
    await sleep(50);
  }
  const frames = sock.since(from);
  return { frames, end, cards: frames.filter((f) => f.t === 'permission-request') };
}

// ------------------------------------------------------------------------------- process scan

function strays(): string[] {
  const out = spawnSync('ps', ['-axeww', '-o', 'pid=,command='], { encoding: 'utf8' }).stdout;
  return out
    .split('\n')
    .filter((l) => l.includes(SCRATCH_ROOT) || l.includes(CONFORMANCE_ROOT))
    .filter((l) => /codex|opencode|server\.ts|acp/i.test(l))
    .filter((l) => !l.trim().startsWith(`${process.pid} `))
    .filter((l) => !/\bps -axeww\b|acp-e2e-local/.test(l))
    .map((l) => clip(l, 160));
}

// ----------------------------------------------------------------------------------- per agent

async function runAgent(id: 'codex' | 'opencode') {
  console.log(`\n== ${id}`);
  const d = agentById(id);
  if (!d) throw new Error(`no catalog entry for ${id}`);
  let w: World;
  try {
    w = makeWorld(id, [id]);
  } catch (e) {
    record(id, '0 setup', null, (e as Error).message);
    return;
  }
  const other = id === 'codex' ? 'opencode' : 'codex';
  const model = startModel(
    id === 'codex' ? 'responses' : 'chat',
    join(RUN_DIR, `${id}-model.ndjson`)
  );
  let canaryHits = 0;
  const canaryToken = tok('CANARY');
  const canary = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch() {
      canaryHits++;
      return new Response(canaryToken);
    },
  });
  const canaryUrl = `http://127.0.0.1:${canary.port}/`;
  let s: Server | null = null;
  try {
    s = await boot(w, model.url, 'a');

    // 1 — discovery and the offer
    await guarded(id, '1 discover + offer', async () => {
      const { agents, offerAgents } = await getAgents(s as Server);
      const row = agents.find((a) => a.id === id) ?? {};
      const ok =
        row.installed === true &&
        row.fit === 'ok' &&
        row.policy === 'bridge-enforced' &&
        offerAgents.includes(id);
      return [
        ok,
        `installed=${row.installed} version=${row.version} fit=${row.fit} policy=${row.policy} realBin=${row.realBin} auth=${row.auth} state=${row.state} offerAgents=${JSON.stringify(offerAgents)}`,
      ];
    });

    // 2 — connect (the real conformance probe), as the person only
    await guarded(id, '2a helper connect refused', async () => {
      const r = await post(s as Server, `/_api/agents/${id}/connect`, {}, false);
      return [r.status === 403, `key-only connect → ${r.status} ${JSON.stringify(r.json)}`];
    });
    await guarded(id, '2b connect (real probe)', async () => {
      const t0 = Date.now();
      const r = await post(s as Server, `/_api/agents/${id}/connect`);
      const { agents, offerAgents } = await getAgents(s as Server);
      const row = agents.find((a) => a.id === id) ?? {};
      const ok =
        r.json.connected === true && row.state === 'connected' && !offerAgents.includes(id);
      return [
        ok,
        `${r.status} ${JSON.stringify(r.json)} in ${Math.round((Date.now() - t0) / 1000)} s; re-GET state=${row.state} offerAgents=${JSON.stringify(offerAgents)}`,
      ];
    });
    await guarded(id, '2c dismiss-offer persists', async () => {
      const r = await post(s as Server, '/_api/agents/gemini/dismiss-offer');
      await stop(s as Server);
      s = await boot(w, model.url, 'b');
      const { agents } = await getAgents(s);
      const gem = agents.find((a) => a.id === 'gemini') ?? {};
      const me = agents.find((a) => a.id === id) ?? {};
      return [
        r.json.ok === true && gem.offerDismissed === true && me.state === 'connected',
        `dismiss → ${r.status}; after restart gemini.offerDismissed=${gem.offerDismissed}, ${id}.state=${me.state}`,
      ];
    });

    // 3 — a chat on the agent
    const sock = new Socket(s, join(RUN_DIR, `${id}-frames.ndjson`));
    await sock.open;
    const chat = `e2e-${id}-1`;
    const hello = tok('HELLO');
    model.script.set('hello', () => ({ text: hello }));
    await guarded(id, '3a attach', async () => {
      const from = sock.mark();
      sock.send({ t: 'attach', chat, seq: 0, agent: id });
      const f = await sock.waitFor((x) => x.t === 'attached' || x.t === 'error', from, 30_000);
      const agent = (f?.agent ?? {}) as { id?: string };
      return [f?.t === 'attached' && agent.id === id, JSON.stringify(f)];
    });
    await guarded(id, '3b prompt → text', async () => {
      const r = await turn(sock, chat, 'E2E-STEP=hello say hello');
      const text = updateText(r.frames);
      const meta = join(w.designRoot, '_chat', `${chat}.meta.json`);
      const metaAgent = existsSync(meta) ? JSON.parse(readFileSync(meta, 'utf8')).agent : null;
      const updates = r.frames.filter((f) => f.t === 'update').length;
      return [
        r.end?.t === 'turn-end' && text.includes(hello) && metaAgent === id,
        `end=${JSON.stringify(r.end)} updates=${updates} modelText=${text.includes(hello)} meta.agent=${metaAgent}`,
      ];
    });

    // 4 — scripted tool calls
    const inPath = join(w.project, 'e2e-in.txt');
    const inTok = tok('IN');
    model.script.set(
      'write-in',
      once((tools) =>
        id === 'codex'
          ? codexExec(tools, `printf %s ${sq(inTok)} > ${sq(inPath)} && echo wrote`)
          : { name: 'write', args: { filePath: inPath, content: inTok } }
      )
    );
    await guarded(id, '4a in-project write', async () => {
      const r = await turn(sock, chat, 'E2E-STEP=write-in write the file');
      const content = existsSync(inPath) ? readFileSync(inPath, 'utf8') : null;
      return [
        content === inTok && r.cards.length === 0 && r.end?.t === 'turn-end',
        `written=${content === inTok} cards=${r.cards.length} end=${JSON.stringify(r.end)} model got=${clip(JSON.stringify(model.received.get('write-in') ?? []))}`,
      ];
    });

    const outPath = join(w.outside, 'e2e-out.txt');
    model.script.set(
      'write-out',
      once((tools) =>
        id === 'codex'
          ? codexExec(tools, `printf x > ${sq(outPath)} && echo wrote`)
          : { name: 'write', args: { filePath: outPath, content: 'x' } }
      )
    );
    await guarded(id, '4b out-of-project write', async () => {
      const r = await turn(sock, chat, 'E2E-STEP=write-out write outside');
      const written = existsSync(outPath);
      const refusedEnd = r.end?.t === 'turn-end' && r.end.reason === 'refused';
      const got = model.received.get('write-out') ?? [];
      return [
        !written && (r.cards.length > 0 || refusedEnd || got.length > 0) && !!r.end,
        `written=${written} cards=${r.cards.length} end=${JSON.stringify(r.end)} model got=${clip(JSON.stringify(got))}`,
      ];
    });

    if (id === 'codex') {
      // The model asks Codex to run the same write OUTSIDE its sandbox (an escalation request):
      // Codex asks the client; the bridge's gate answers for an out-of-project path.
      model.script.set(
        'write-out-esc',
        once((tools) => {
          const step = codexExec(tools, `printf x > ${sq(outPath)} && echo wrote`);
          return {
            ...step,
            args: { ...step.args, sandbox_permissions: 'require_escalated', justification: 'e2e' },
          };
        })
      );
      await guarded(id, '4b2 escalated outside write', async () => {
        const r = await turn(sock, chat, 'E2E-STEP=write-out-esc write outside, escalated');
        const written = existsSync(outPath);
        const got = model.received.get('write-out-esc') ?? [];
        return [
          !written && !!r.end,
          `written=${written} cards=${r.cards.length} end=${JSON.stringify(r.end)} model got=${clip(JSON.stringify(got))}`,
        ];
      });
    }

    model.script.set(
      'cred-read',
      once((tools) =>
        id === 'codex'
          ? codexExec(tools, `cat ${sq(w.keysPath)}; cat ${sq(join(w.codexHome, 'auth.json'))}`)
          : { name: 'read', args: { filePath: w.keysPath } }
      )
    );
    await guarded(id, '4c credential read', async () => {
      const r = await turn(sock, chat, 'E2E-STEP=cred-read read the keys');
      const leaked = w.secrets.filter((x) => model.bodies.some((b) => b.includes(x)));
      const inFrames = w.secrets.filter((x) => JSON.stringify(r.frames).includes(x));
      return [
        leaked.length === 0 && inFrames.length === 0 && !!r.end,
        `leaked to model=${leaked.length} in frames=${inFrames.length} cards=${r.cards.length} end=${JSON.stringify(r.end)} model got=${clip(JSON.stringify(model.received.get('cred-read') ?? []))}`,
      ];
    });

    model.script.set(
      'curl',
      once((tools) =>
        id === 'codex'
          ? codexExec(tools, `/usr/bin/curl -sS -m 5 ${sq(canaryUrl)}`)
          : {
              name: 'bash',
              args: { command: `/usr/bin/curl -sS -m 5 ${sq(canaryUrl)}`, description: 'egress' },
            }
      )
    );
    await guarded(id, '4d curl egress', async () => {
      const r = await turn(sock, chat, 'E2E-STEP=curl fetch it');
      const got = model.received.get('curl') ?? [];
      const reached = got.some((g) => g.includes(canaryToken));
      return [
        canaryHits === 0 && !reached && !!r.end,
        `canaryHits=${canaryHits} model got token=${reached} cards=${r.cards.length} end=${JSON.stringify(r.end)} model got=${clip(JSON.stringify(got))}`,
      ];
    });

    // 4d2 — "AI may search the web: off", and the person APPROVES every card: still no egress.
    model.script.set(
      'curl-off',
      once((tools) => {
        const cmd = `/usr/bin/curl -sS -m 5 ${sq(canaryUrl)}`;
        if (id !== 'codex') return { name: 'bash', args: { command: cmd, description: 'egress' } };
        const step = codexExec(tools, cmd);
        return {
          ...step,
          args: { ...step.args, sandbox_permissions: 'require_escalated', justification: 'e2e' },
        };
      })
    );
    await guarded(id, '4d2 web off, card approved', async () => {
      const r = await turn(sock, chat, 'E2E-STEP=curl-off fetch it', 120_000, {
        answer: 'approve',
        may: { assets: true, web: false },
      });
      const got = model.received.get('curl-off') ?? [];
      const reached = got.some((g) => g.includes(canaryToken));
      return [
        canaryHits === 0 && !reached && !!r.end,
        `canaryHits=${canaryHits} model got token=${reached} cards=${r.cards.length} end=${JSON.stringify(r.end)} model got=${clip(JSON.stringify(got))}`,
      ];
    });

    await guarded(id, '4e set-mode refused', async () => {
      const caps = [...sock.frames].reverse().find((f) => f.t === 'caps') as Frame | undefined;
      const modes = (caps?.modes ?? {}) as {
        currentModeId?: string;
        availableModes?: { id: string }[];
      };
      const allow = d.enforcement?.pinMode?.allow ?? [];
      const tries = [
        'agent',
        ...(modes.availableModes ?? [])
          .map((m) => m.id)
          .filter((m) => allow.length && !allow.includes(m)),
      ];
      const results: string[] = [];
      let ok = true;
      for (const modeId of [...new Set(tries)]) {
        const from = sock.mark();
        sock.send({ t: 'set-mode', chat, modeId });
        const err = await sock.waitFor(
          (f) => f.t === 'error' && /can't use/.test(String(f.message)),
          from,
          3000
        );
        const after = [...sock.frames].reverse().find((f) => f.t === 'caps') as Frame | undefined;
        const cur = (after?.modes as { currentModeId?: string } | undefined)?.currentModeId;
        const switched = cur === modeId;
        if (switched) ok = false;
        results.push(
          `${modeId}: ${err ? 'refused (error frame)' : 'no error frame'}, current=${cur}`
        );
      }
      return [
        ok,
        `advertised=${JSON.stringify((modes.availableModes ?? []).map((m) => m.id))} pin.allow=${JSON.stringify(allow)}; ${results.join('; ')}`,
      ];
    });
    if (model.tools.size) {
      const web = [...model.tools].filter((t) => /web[_-]?(search|fetch)|^fetch$/i.test(t));
      record(id, '4f no web tool offered', web.length === 0, `tools=${[...model.tools].join(',')}`);
    }

    // 5a — a planted chat naming an unconnected agent
    await guarded(id, '5a unconnected agent refused', async () => {
      const planted = 'e2e-planted';
      mkdirSync(join(w.designRoot, '_chat'), { recursive: true });
      writeFileSync(
        join(w.designRoot, '_chat', `${planted}.meta.json`),
        JSON.stringify({ agent: other })
      );
      const from = sock.mark();
      sock.send({ t: 'attach', chat: planted, seq: 0 });
      const f = await sock.waitFor(
        (x) => (x.t === 'attached' && x.chat === planted) || x.t === 'error',
        from,
        20_000
      );
      return [f?.t === 'error' && f.code === 'agent-not-connected', JSON.stringify(f)];
    });

    // 5b — opencode refuses to start with a link out of the project
    if (id === 'opencode') {
      await guarded(id, '5b unsafe link refused', async () => {
        const link = join(w.project, 'ref-link');
        symlinkSync(w.outsideSecret, link);
        try {
          const c2 = 'e2e-opencode-link';
          const from = sock.mark();
          sock.send({ t: 'attach', chat: c2, seq: 0, agent: id });
          const a = await sock.waitFor(
            (x) => (x.t === 'attached' && x.chat === c2) || x.t === 'error',
            from,
            20_000
          );
          let f: Frame | null = a?.t === 'error' ? a : null;
          if (!f) {
            const r = await turn(sock, c2, 'E2E-STEP=hello hi', 60_000);
            f = r.end;
          }
          const leaked = model.bodies.some((b) => b.includes(w.secrets[2]));
          return [
            f?.t === 'error' && f.code === 'agent-unsafe-link' && !leaked,
            `attach=${JSON.stringify(a)}; refusal=${JSON.stringify(f)}`,
          ];
        } finally {
          rmSync(link, { force: true });
        }
      });
    } else {
      record(
        id,
        '5b unsafe link refused',
        null,
        'Codex is os-sandboxed: not link-scanned by design (S3)'
      );
    }
    sock.close();
  } catch (e) {
    record(id, 'run', false, `threw: ${(e as Error).stack ?? e}`);
  } finally {
    if (s) await stop(s);
    model.stop();
    canary.stop(true);
  }

  // 7 — nothing left running
  await guarded(id, '7 no stray processes', async () => {
    await sleep(1500);
    const left = strays();
    return [left.length === 0, left.length ? left.join(' || ') : 'none'];
  });
  if (!KEEP) rmSync(w.base, { recursive: true, force: true });
}

async function runClaudeOnly() {
  console.log('\n== claude-only');
  const w = makeWorld('claude-only', []);
  let s: Server | null = null;
  try {
    s = await boot(w, null, 'a');
    await guarded('claude-only', '6 nothing offered', async () => {
      const { agents, offerAgents } = await getAgents(s as Server);
      const installed = agents.filter((a) => a.installed).map((a) => a.id);
      return [
        Array.isArray(offerAgents) && offerAgents.length === 0,
        `offerAgents=${JSON.stringify(offerAgents)} installed=${JSON.stringify(installed)}`,
      ];
    });
  } catch (e) {
    record('claude-only', '6 nothing offered', false, `threw: ${(e as Error).message}`);
  } finally {
    if (s) await stop(s);
  }
  await guarded('claude-only', '7 no stray processes', async () => {
    await sleep(500);
    const left = strays();
    return [left.length === 0, left.length ? left.join(' || ') : 'none'];
  });
  if (!KEEP) rmSync(w.base, { recursive: true, force: true });
}

// ------------------------------------------------------------------------------------------ main

const versions: string[] = [];
for (const id of AGENTS) await runAgent(id);
await runClaudeOnly();
for (const id of AGENTS) {
  const b = id === 'codex' ? personCodexBin() : Bun.which('opencode');
  if (b) {
    const v = spawnSync(b, ['--version'], { encoding: 'utf8', timeout: 5000 }).stdout.trim();
    versions.push(`${id}: ${v} (${b})`);
  }
}

const mark = (ok: boolean | null) => (ok === null ? 'n/a' : ok ? 'PASS' : 'FAIL');
const table = [
  '| Agent | Step | Result | Detail |',
  '| --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.agent} | ${r.step} | ${mark(r.ok)} | ${clip(r.detail, 400)} |`),
].join('\n');
const failed = rows.filter((r) => r.ok === false).length;
const report = [
  '# universal-ACP agents through the real server — run report',
  '',
  `- Date: ${new Date().toISOString()}`,
  `- Commit: ${spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).stdout.trim()}`,
  `- Agents: ${versions.join('; ')}`,
  `- Scratch: ${SCRATCH_ROOT} (HOME, XDG_*, CODEX_HOME; stub claude; fake keys)`,
  `- Model: loopback scripted model per agent (${E2E_AGENT_MODEL_SWITCH}); frames + model log + server logs beside this file`,
  `- Verdict: ${failed ? `FAIL (${failed})` : 'PASS'}`,
  '',
  table,
  '',
].join('\n');
writeFileSync(join(RUN_DIR, 'report.md'), report);
console.log(`\n${table}\n\nreport: ${join(RUN_DIR, 'report.md')}`);
process.exit(failed ? 1 : 0);
