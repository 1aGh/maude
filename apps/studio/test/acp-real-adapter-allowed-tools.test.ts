// p8-acp-allow-proof (decision maude/v2-michal-m2-read-boundary) — the M2 read boundary holds in the
// REAL adapter, not only in the bridge's own params.
//
// The concern (Michal's release-app log, 2026-10-29): the Claude Agent SDK warns
// `[CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] canUseTool will not be invoked for: Read, Glob, Grep, …` when
// a session's `allowedTools` carries a BARE tool name — a bare name auto-approves the whole tool
// before the adapter's `canUseTool` (and so the bridge's read gate, `readVerdict`) is ever asked.
// If v2 handed the SDK a bare `Read`/`Glob`/`Grep`, the read boundary would do nothing in the app.
//
// So this drives the real chain the desktop app runs — `AcpBridge` → the installed
// `@agentclientprotocol/claude-agent-acp` entry (`resolveAdapterEntry`, no fixture) under the same
// runtime the app picks (`node` when on PATH, else Bun — the compiled sidecar's `BUN_BE_BUN=1`
// self) → the SDK's `query()` → `claude` — in the DEFAULT permission mode, and reads two things:
//   • the SDK's shadow warning on the adapter's stderr (emitted at `query()`, before any spawn), and
//   • the argv the SDK hands `claude` — `--allowedTools` / `--disallowedTools` /
//     `--permission-mode` are what the CLI actually enforces, after everything the adapter appends.
// `claude` is a stub that records its argv and exits (a fake HOME with the real `claude` pops a
// keychain dialog), HOME / XDG / CLAUDE_CONFIG_DIR / MAUDE_INDEX_DIR are throwaway, and every
// inherited CLAUDE_* / ANTHROPIC_* variable of the session running the tests is removed.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const STUDIO = join(import.meta.dir, '..');
const PLUGINS = [
  { type: 'local' as const, path: join(STUDIO, '..', '..', 'plugins', 'design') },
  { type: 'local' as const, path: join(STUDIO, '..', '..', 'plugins', 'flow') },
];
const SHADOW = 'CLAUDE_SDK_CAN_USE_TOOL_SHADOWED';

let tmp: string;
let home: string;
let repo: string;
let argvDir: string;
let stub: string;
const savedEnv: Record<string, string | undefined> = {};
let bridgeMod: typeof import('../acp/bridge.ts');

const RUNTIMES: Array<{ name: string; bin: () => string | null }> = [
  { name: 'node (the app’s pick when node is on PATH)', bin: () => Bun.which('node') },
  { name: 'bun (the compiled sidecar’s BUN_BE_BUN runtime)', bin: () => process.execPath },
];

function setEnv(k: string, v: string | undefined) {
  if (!(k in savedEnv)) savedEnv[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

beforeAll(async () => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'maude-real-adapter-')));
  home = join(tmp, 'home');
  repo = join(tmp, 'repo');
  argvDir = join(tmp, 'argv');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.config'), { recursive: true });
  mkdirSync(join(repo, '.design'), { recursive: true });
  mkdirSync(argvDir, { recursive: true });
  mkdirSync(join(tmp, 'bin'), { recursive: true });
  // The stub `claude`: one NUL-separated argv file per invocation, then exit (the SDK's
  // initialization then fails, which ends the session attempt — the options are already out).
  stub = join(tmp, 'bin', 'claude');
  writeFileSync(stub, `#!/bin/sh\nprintf '%s\\0' "$@" > "${argvDir}/argv-$$"\nexit 3\n`);
  chmodSync(stub, 0o755);

  for (const k of Object.keys(process.env)) {
    if (/^(CLAUDE|ANTHROPIC)/.test(k)) setEnv(k, undefined);
  }
  setEnv('HOME', home);
  setEnv('XDG_CONFIG_HOME', join(home, '.config'));
  setEnv('CLAUDE_CONFIG_DIR', join(home, '.claude'));
  setEnv('MAUDE_INDEX_DIR', join(tmp, 'index'));
  setEnv('NO_OPEN', '1');
  setEnv('MAUDE_ACP_ADAPTER_ENTRY', undefined); // the REAL adapter — never a fixture
  setEnv('MAUDE_CLAUDE_BIN', stub);
  bridgeMod = await import('../acp/bridge.ts');
});

afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(tmp, { recursive: true, force: true });
});

afterEach(() => {
  for (const f of readdirSync(argvDir)) rmSync(join(argvDir, f));
  rmSync(join(home, '.claude', 'settings.json'), { force: true });
});

interface Run {
  stderr: string;
  /** The bare names the SDK warns about; null = no shadow warning at all. */
  shadowed: string[] | null;
  shadowLine: string | null;
  allowed: string[];
  disallowed: string[];
  permissionMode: string | null;
  /** The SDK spells it `--setting-sources=user` (one token). */
  userOnly: boolean;
}

/** One desktop chat session through the real adapter; what reached the SDK and `claude`. */
async function runSession(runtime: string, may?: { assets: boolean; web: boolean }): Promise<Run> {
  setEnv('MAUDE_ACP_RUNTIME', runtime);
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    if (args[0] === '[acp-adapter]') lines.push(String(args[1]));
    else orig(...args);
  };
  const bridge = new bridgeMod.AcpBridge({
    chatId: 'c1',
    repoRoot: repo,
    designRoot: join(repo, '.design'),
    plugins: PLUGINS,
    studioBrief: 'You are working inside Maude.',
    permissionTimeoutMs: 4000,
  });
  try {
    if (may) bridge.setMay(may);
    await Promise.race([
      bridge.prompt('hello', 'c1').catch(() => undefined),
      new Promise((r) => setTimeout(r, 20_000)),
    ]);
  } finally {
    await bridge.stop();
    // the adapter's last stderr chunk can land just after stop()
    await new Promise((r) => setTimeout(r, 200));
    console.error = orig;
  }
  const stderr = lines.join('\n');
  const m = stderr.match(
    new RegExp(
      `\\[${SHADOW}\\][^\\n]*?canUseTool will not be invoked(?: for: (.*?)\\. Bare|: (.*?)\\.)`
    )
  );
  const shadowLine = m ? (stderr.split('\n').find((l) => l.includes(SHADOW)) ?? null) : null;
  const shadowed = m ? (m[1] ? m[1].split(', ') : [`<${m[2]}>`]) : null;

  // The `claude` invocation that is the session (the SDK's stream-json call), not any probe.
  const argvs = readdirSync(argvDir).map((f) =>
    readFileSync(join(argvDir, f), 'utf8').split('\0').slice(0, -1)
  );
  const argv = argvs.find((a) => a.includes('--input-format')) ?? [];
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? (argv[i + 1] ?? '') : null;
  };
  const list = (name: string) => (flag(name) ?? '').split(',').filter(Boolean);
  return {
    stderr,
    shadowed,
    shadowLine,
    allowed: list('--allowedTools'),
    disallowed: list('--disallowedTools'),
    permissionMode: flag('--permission-mode'),
    userOnly: argv.includes('--setting-sources=user'),
  };
}

const bare = (rules: readonly string[]) => rules.filter((r) => !r.includes('('));

for (const rt of RUNTIMES) {
  const bin = rt.bin();
  describe.skipIf(!bin)(`real adapter under ${rt.name}`, () => {
    test('default mode: no bare Read/Glob/Grep reaches the SDK; the shadow warning names exactly WebSearch, WebFetch', async () => {
      const run = await runSession(bin as string);
      // The session really went out (otherwise every assertion below is vacuous).
      expect(run.allowed.length).toBeGreaterThan(0);
      expect(run.permissionMode).toBe('default');
      expect(run.userOnly).toBe(true); // the served project's .claude/ never reaches the session

      // What `claude` enforces: no bare read tool, only path-scoped Read(//abs/**) rules.
      for (const t of ['Read', 'Glob', 'Grep']) expect(run.allowed).not.toContain(t);
      expect(bare(run.allowed)).toEqual(['WebSearch', 'WebFetch']);
      const reads = run.allowed.filter((r) => /^(Read|Glob|Grep)\b/.test(r));
      expect(reads.length).toBeGreaterThan(0);
      for (const r of reads) expect(r).toMatch(/^Read\(\/\/.+\/\*\*\)$/);
      // The adapter appends nothing to the allow list: it is exactly the bridge's read rules + Maude's tools.
      expect(run.allowed.filter((r) => !r.startsWith('Read('))).toEqual(
        bridgeMod.sessionAllowedTools({}).kept
      );

      // The SDK's own view of it: the warning lists only the two web tools, never a read tool.
      expect(run.shadowLine).not.toBeNull();
      expect(run.shadowed).toEqual(['WebSearch', 'WebFetch']);
      // The deny half rides through (credential stores on every session) + the adapter's own entry.
      expect(run.disallowed.some((r) => r.startsWith('Read('))).toBe(true);
    }, 45_000);

    test('the person’s own ~/.claude allows bare Read: the SDK still gets no bare Read (the CLI applies their rule itself)', async () => {
      writeFileSync(
        join(home, '.claude', 'settings.json'),
        JSON.stringify({ permissions: { allow: ['Read', 'Glob', 'Grep'] } })
      );
      const run = await runSession(bin as string);
      expect(run.allowed.length).toBeGreaterThan(0);
      for (const t of ['Read', 'Glob', 'Grep']) expect(run.allowed).not.toContain(t);
      expect(bare(run.allowed)).toEqual(['WebSearch', 'WebFetch']);
      expect(run.shadowed).toEqual(['WebSearch', 'WebFetch']);
    }, 45_000);

    test('web off: both web tools leave the allow list and are denied — the shadow warning is gone', async () => {
      const run = await runSession(bin as string, { assets: true, web: false });
      expect(run.allowed.length).toBeGreaterThan(0);
      expect(run.allowed).not.toContain('WebSearch');
      expect(run.allowed).not.toContain('WebFetch');
      expect(run.disallowed).toEqual(expect.arrayContaining(['WebSearch', 'WebFetch']));
      expect(bare(run.allowed)).toEqual([]);
      expect(run.shadowLine).toBeNull();
    }, 45_000);
  });
}
