// F2 (plan B1, discovery half) — find each catalog agent on the login-shell PATH, resolve wrappers
// by READING them (never executing), probe the version off the boot path with a hard timeout.
// Contract: .ai/plans/notes/universal-acp-contract.md (F2) · DDR-252.
//
// Fixtures. A real native binary is `/bin/echo` behind symlinks (copying a platform binary gets it
// SIGKILLed on macOS), made to "print a version" through the descriptor's own versionArgs. A script
// whose shebang is a JS runtime (`#!<bun>`) stands for an npm-installed agent entry; a `#!/bin/sh`
// file is a wrapper and is only ever READ.

import { afterAll, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CATALOG, CLAUDE, CODEX, OPENCODE } from '../acp/agents/catalog.ts';
import type { AgentDescriptor } from '../acp/agents/descriptor.ts';
import {
  clearVersionCache,
  discoverAgents,
  probeAgentVersion,
  resolveAgentBin,
} from '../acp/agents/discover.ts';
import { createAgentStateStore } from '../acp/agents/state.ts';
import { resolveClaudePath } from '../acp/probe.ts';
import { CANVAS_SAFE_API } from '../http.ts';
import { createAgentsRoutes } from '../routes/agents.ts';
import { allSpecs } from '../routes/index.ts';
import { mountRoutes } from '../routes/table.ts';
import { stubDeps } from './_route-stubs.ts';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function sandbox(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'maude-agents-')));
  dirs.push(d);
  return d;
}
function exe(path: string, body: string): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}
/** A JS-runtime script: `#!<bun>` then the body. Runs under the test's own runtime, no network. */
const js = (path: string, body: string) => exe(path, `#!${process.execPath}\n${body}\n`);
const ECHO = realpathSync('/bin/echo');
/** codex-cli's own version line, printed by echo when it is handed the line as an argument. */
const codexDescriptor = (over: Partial<AgentDescriptor['detect']> = {}): AgentDescriptor => ({
  ...CODEX,
  detect: { ...CODEX.detect, ...over },
});
const envOf = (home: string, ...pathDirs: string[]) => ({
  HOME: home,
  PATH: pathDirs.join(':'),
});

describe('resolveAgentBin', () => {
  test('(a) a plain runtime entry in a PATH directory is the real binary', () => {
    const root = sandbox();
    const bin = js(join(root, 'bin', 'codex'), 'console.log("codex-cli 0.166.1")');
    expect(resolveAgentBin(CODEX, envOf(root, join(root, 'bin')))).toBe(bin);
  });

  test('(b) a symlink chain ends at the realpath of the native binary', () => {
    const root = sandbox();
    mkdirSync(join(root, 'bin'));
    mkdirSync(join(root, 'pkg'));
    symlinkSync(ECHO, join(root, 'pkg', 'codex-native'));
    symlinkSync(join(root, 'pkg', 'codex-native'), join(root, 'pkg', 'current'));
    symlinkSync(join(root, 'pkg', 'current'), join(root, 'bin', 'codex'));
    expect(resolveAgentBin(CODEX, envOf(root, join(root, 'bin')))).toBe(ECHO);
  });

  test('(c) the ~/.claude/bin/codex wrapper resolves through $HOME/.local/bin/codex to the real file', () => {
    const home = sandbox();
    // the exact shape of the wrapper the person has installed
    const marker = join(home, 'WRAPPER-RAN');
    exe(
      join(home, '.claude', 'bin', 'codex'),
      `#!/bin/sh\nset -eu\n\nexport MAUDE_CODEX_REAL="$HOME/.local/bin/codex"\ntouch ${marker}\nexec maude codex "$@"\n`
    );
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    mkdirSync(join(home, '.codex', 'packages', 'standalone', 'current', 'bin'), {
      recursive: true,
    });
    symlinkSync(ECHO, join(home, '.codex', 'packages', 'standalone', 'current', 'bin', 'codex'));
    symlinkSync(
      join(home, '.codex', 'packages', 'standalone', 'current', 'bin', 'codex'),
      join(home, '.local', 'bin', 'codex')
    );
    const env = envOf(home, join(home, '.claude', 'bin'), join(home, '.local', 'bin'));
    expect(resolveAgentBin(CODEX, env)).toBe(ECHO);
    // READ, never executed
    expect(existsSync(marker)).toBe(false);
  });

  test('(c2) a wrapper that execs an absolute path or a $VAR is followed; an `env VAR=x` prefix is skipped', () => {
    const home = sandbox();
    const real = js(join(home, 'real', 'codex'), 'console.log("codex-cli 0.166.1")');
    exe(join(home, 'w1', 'codex'), `#!/bin/bash\nexec "${real}" "$@"\n`);
    exe(join(home, 'w2', 'codex'), `#!/bin/sh\nREAL=${real}\nexec env FOO=1 "$REAL" "$@"\n`);
    exe(join(home, 'w3', 'codex'), `#!/bin/sh\nexec env -i "\${HOME}/real/codex" "$@"\n`);
    for (const w of ['w1', 'w2', 'w3']) {
      expect(resolveAgentBin(CODEX, envOf(home, join(home, w)))).toBe(real);
    }
  });

  test('(c3) an unresolvable wrapper is skipped and a later PATH entry still wins', () => {
    const root = sandbox();
    const marker = join(root, 'WRAPPER-RAN');
    exe(join(root, 'wrap', 'codex'), `#!/bin/sh\ntouch ${marker}\nexec maude codex "$@"\n`);
    const real = js(join(root, 'later', 'codex'), 'console.log("codex-cli 0.166.1")');
    expect(resolveAgentBin(CODEX, envOf(root, join(root, 'wrap'), join(root, 'later')))).toBe(real);
    expect(resolveAgentBin(CODEX, envOf(root, join(root, 'wrap')))).toBeNull();
    expect(existsSync(marker)).toBe(false);
  });

  test('(c4) wrappers that point at each other do not loop', () => {
    const root = sandbox();
    exe(join(root, 'a', 'codex'), `#!/bin/sh\nexec ${join(root, 'b', 'codex')} "$@"\n`);
    exe(join(root, 'b', 'codex'), `#!/bin/sh\nexec ${join(root, 'a', 'codex')} "$@"\n`);
    expect(resolveAgentBin(CODEX, envOf(root, join(root, 'a'), join(root, 'b')))).toBeNull();
  });

  test('(d) a missing binary, a directory of that name and a non-executable file are all null', () => {
    const root = sandbox();
    mkdirSync(join(root, 'bin', 'codex'), { recursive: true });
    expect(resolveAgentBin(CODEX, envOf(root, join(root, 'bin'), join(root, 'nope')))).toBeNull();
  });

  test('a non-executable file is not a candidate', () => {
    const root = sandbox();
    mkdirSync(join(root, 'bin'));
    writeFileSync(join(root, 'bin', 'codex'), '\u007fELF-ish');
    chmodSync(join(root, 'bin', 'codex'), 0o644);
    expect(resolveAgentBin(CODEX, envOf(root, join(root, 'bin')))).toBeNull();
  });

  test('an empty or missing PATH finds nothing', () => {
    expect(resolveAgentBin(CODEX, { HOME: '/nonexistent', PATH: '' })).toBeNull();
    expect(resolveAgentBin(CODEX, { HOME: '/nonexistent' })).toBeNull();
  });

  test('claude is whatever resolveClaudePath finds (realpath), never re-derived', () => {
    const root = sandbox();
    mkdirSync(join(root, 'pkg'));
    const real = js(join(root, 'pkg', 'claude-real'), 'console.log("2.1.0 (Claude Code)")');
    symlinkSync(real, join(root, 'claude-link'));
    // the explicit override resolveClaudePath honours first
    const env = {
      ...envOf(root, join(root, 'nothing')),
      MAUDE_CLAUDE_BIN: join(root, 'claude-link'),
    };
    expect(resolveClaudePath(env)).toBe(join(root, 'claude-link'));
    expect(resolveAgentBin(CLAUDE, env)).toBe(real);
    // and with the process environment: the same binary or both absent
    const found = resolveClaudePath();
    expect(resolveAgentBin(CLAUDE)).toBe(found ? realpathSync(found) : null);
  });
});

describe('probeAgentVersion', () => {
  test('parses the version a real binary prints', async () => {
    clearVersionCache();
    const d = codexDescriptor({ versionArgs: ['codex-cli 0.166.1'] });
    expect(await probeAgentVersion(d, ECHO)).toBe('0.166.1');
  });

  test('(e) a hanging --version times out near 5 s and reports null', async () => {
    clearVersionCache();
    const root = sandbox();
    const hang = js(join(root, 'hang'), 'setInterval(() => {}, 1000)');
    const t0 = Date.now();
    const v = await probeAgentVersion(codexDescriptor(), hang);
    const dt = Date.now() - t0;
    expect(v).toBeNull();
    expect(dt).toBeGreaterThanOrEqual(4900);
    expect(dt).toBeLessThanOrEqual(5500);
  }, 10_000);

  // Security review 2026-11-12 (defender warning): the timeout killed only the direct child, so a
  // wrapper's grandchild kept running.
  test('a timed-out probe kills the whole process group, grandchildren included', async () => {
    clearVersionCache();
    const root = sandbox();
    const pidFile = join(root, 'grandchild.pid');
    const wrapper = exe(
      join(root, 'wrapper'),
      `#!/bin/sh\nsleep 30 &\necho $! > "${pidFile}"\nwait\n`
    );
    const v = await probeAgentVersion(codexDescriptor(), wrapper, { timeoutMs: 1500 });
    expect(v).toBeNull();
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    expect(pid).toBeGreaterThan(0);
    let alive = true;
    for (let i = 0; i < 20 && alive; i++) {
      try {
        process.kill(pid, 0);
        await Bun.sleep(50);
      } catch {
        alive = false;
      }
    }
    if (alive) process.kill(pid, 'SIGKILL');
    expect(alive).toBe(false);
  }, 10_000);

  test('output that does not match versionRe is null; a crash is null', async () => {
    clearVersionCache();
    const root = sandbox();
    const odd = js(join(root, 'odd'), 'console.log("hello world")');
    const boom = js(join(root, 'boom'), 'process.exit(3)');
    expect(await probeAgentVersion(codexDescriptor(), odd)).toBeNull();
    expect(await probeAgentVersion(codexDescriptor(), boom)).toBeNull();
    expect(await probeAgentVersion(codexDescriptor(), join(root, 'missing'))).toBeNull();
  });

  test('the probe runs with the shared scrub: provider keys never reach the binary', async () => {
    clearVersionCache();
    const root = sandbox();
    const dump = join(root, 'env.json');
    const spy = js(
      join(root, 'spy'),
      `require("node:fs").writeFileSync(${JSON.stringify(dump)}, JSON.stringify(process.env)); console.log("codex-cli 0.166.1")`
    );
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-should-be-scrubbed';
    try {
      expect(await probeAgentVersion(codexDescriptor(), spy)).toBe('0.166.1');
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
    expect(readFileSync(dump, 'utf8')).not.toContain('sk-should-be-scrubbed');
  });

  test('(f) cached by realpath + mtime: a second probe is a hit, a touched file a miss, force bypasses', async () => {
    clearVersionCache();
    const root = sandbox();
    const log = join(root, 'runs.log');
    const counter = js(
      join(root, 'counter'),
      `require("node:fs").appendFileSync(${JSON.stringify(log)}, "x"); console.log("codex-cli 0.166.1")`
    );
    const runs = () => (existsSync(log) ? readFileSync(log, 'utf8').length : 0);
    const d = codexDescriptor();
    expect(await probeAgentVersion(d, counter)).toBe('0.166.1');
    expect(runs()).toBe(1);
    expect(await probeAgentVersion(d, counter)).toBe('0.166.1'); // hit
    expect(runs()).toBe(1);
    const later = new Date(Date.now() + 60_000);
    utimesSync(counter, later, later); // mtime moved: an upgrade in place
    expect(await probeAgentVersion(d, counter)).toBe('0.166.1'); // miss
    expect(runs()).toBe(2);
    expect(await probeAgentVersion(d, counter, { force: true })).toBe('0.166.1');
    expect(runs()).toBe(3);
  });
});

describe('discoverAgents', () => {
  test('every catalog entry gets a row; missing agents are installed:false with null version and fit', async () => {
    const root = sandbox();
    const rows = await discoverAgents({ env: envOf(root, join(root, 'empty')), force: true });
    expect(rows.map((r) => r.id)).toEqual(CATALOG.map((d) => d.id));
    for (const r of rows) {
      expect(r).toMatchObject({ installed: false, realBin: null, version: null, fit: null });
      expect(r.offerable).toBe(false);
    }
    expect(rows[0]).toMatchObject({ id: 'claude', label: 'Claude', vendor: 'Anthropic' });
  });

  test('an installed agent reports its realpath, version, fit and policy', async () => {
    clearVersionCache();
    const root = sandbox();
    const d = codexDescriptor({ versionArgs: ['codex-cli 0.166.1'] });
    mkdirSync(join(root, 'bin'));
    symlinkSync(ECHO, join(root, 'bin', 'codex'));
    const [row] = await discoverAgents({
      env: envOf(root, join(root, 'bin')),
      catalog: [d],
      force: true,
    });
    expect(row).toEqual({
      id: 'codex',
      label: 'Codex',
      vendor: 'OpenAI',
      installed: true,
      realBin: ECHO,
      version: '0.166.1',
      fit: 'ok',
      policy: 'bridge-enforced',
      offerable: true,
    });
  });

  test('fit is too-old below minVersion, untested above testedMax, null when the version is unknown', async () => {
    clearVersionCache();
    const root = sandbox();
    mkdirSync(join(root, 'bin'));
    symlinkSync(ECHO, join(root, 'bin', 'codex'));
    const env = envOf(root, join(root, 'bin'));
    const fit = async (line: string) =>
      (
        await discoverAgents({
          env,
          catalog: [codexDescriptor({ versionArgs: [line] })],
          force: true,
        })
      )[0];
    expect((await fit('codex-cli 0.153.0')).fit).toBe('too-old');
    expect((await fit('codex-cli 0.170.0')).fit).toBe('untested');
    const unknown = await fit('no version here');
    expect(unknown).toMatchObject({ installed: true, version: null, fit: null });
  });

  test('one agent that hangs does not block the others', async () => {
    clearVersionCache();
    const root = sandbox();
    js(join(root, 'bin', 'codex'), 'setInterval(() => {}, 1000)');
    mkdirSync(join(root, 'bin2'));
    symlinkSync(ECHO, join(root, 'bin2', 'opencode'));
    const opencode: AgentDescriptor = {
      ...OPENCODE,
      detect: { ...OPENCODE.detect, versionArgs: ['1.18.30'] },
    };
    const t0 = Date.now();
    let fastDoneAt = 0;
    const rowsP = discoverAgents({
      env: envOf(root, join(root, 'bin'), join(root, 'bin2')),
      catalog: [codexDescriptor(), opencode],
      force: true,
      onRow: (r) => {
        if (r.id === 'opencode') fastDoneAt = Date.now() - t0;
      },
    });
    const rows = await rowsP;
    const dt = Date.now() - t0;
    expect(rows.find((r) => r.id === 'codex')).toMatchObject({ installed: true, version: null });
    expect(rows.find((r) => r.id === 'opencode')).toMatchObject({ version: '1.18.30', fit: 'ok' });
    expect(fastDoneAt).toBeLessThan(2000); // not queued behind the hang
    expect(dt).toBeLessThanOrEqual(5500);
  }, 10_000);

  test('the default call is cached for the process; force re-probes', async () => {
    const root = sandbox();
    const log = join(root, 'runs.log');
    js(
      join(root, 'bin', 'codex'),
      `require("node:fs").appendFileSync(${JSON.stringify(log)}, "x"); console.log("codex-cli 0.166.1")`
    );
    const env = envOf(root, join(root, 'bin'));
    clearVersionCache();
    const runs = () => (existsSync(log) ? readFileSync(log, 'utf8').length : 0);
    // an explicit env/catalog never touches the process-wide cache
    await discoverAgents({ env, catalog: [CODEX] });
    await discoverAgents({ env, catalog: [CODEX] });
    expect(runs()).toBe(1); // the version cache (realpath+mtime), not a re-run
    await discoverAgents({ env, catalog: [CODEX], force: true });
    expect(runs()).toBe(2);
  });
});

describe('GET /_api/agents', () => {
  test('one main-origin GET in the table, in neither canvas allowlist', () => {
    const specs = allSpecs(stubDeps()).filter((s) => s.path === '/_api/agents');
    expect(specs.map((s) => [s.method, s.origin, s.readOnly])).toEqual([
      ['GET', 'main', 'allowed'],
    ]);
    expect(mountRoutes(allSpecs(stubDeps())).canvasPaths).not.toContain('/_api/agents');
    expect(CANVAS_SAFE_API.has('/_api/agents')).toBe(false);
  });

  test('answers { agents } uncached; ?refresh=1 forces a re-probe', async () => {
    const calls: Array<{ force?: boolean }> = [];
    const row = {
      id: 'codex',
      label: 'Codex',
      vendor: 'OpenAI',
      installed: true,
      realBin: '/x/codex',
      version: '0.166.1',
      fit: 'ok',
      policy: 'bridge-enforced',
      offerable: true,
    };
    const [spec] = createAgentsRoutes({
      discover: async (o) => {
        calls.push({ force: o?.force });
        return [row] as never;
      },
      // F7 added the connect state to every row; keep this test off the real profile's agents.json
      store: createAgentStateStore(
        join(mkdtempSync(join(tmpdir(), 'agents-route-')), 'agents.json')
      ),
      authStatus: async () => 'unknown',
    });
    const res = await spec.handle(new Request('http://localhost/_api/agents'), {});
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]).toMatchObject(row); // F2's fields are untouched
    // Codex is bridge-enforced in the catalog: installed, fitting, not connected → offered.
    expect(body.offerAgents).toEqual(['codex']);
    await spec.handle(new Request('http://localhost/_api/agents?refresh=1'), {});
    await spec.handle(new Request('http://localhost/_api/agents?refresh=0'), {});
    expect(calls).toEqual([{ force: false }, { force: true }, { force: false }]);
  });

  test('a discovery failure is a 500 JSON, not a crash', async () => {
    const [spec] = createAgentsRoutes({
      discover: async () => {
        throw new Error('boom');
      },
      store: createAgentStateStore(
        join(mkdtempSync(join(tmpdir(), 'agents-route-')), 'agents.json')
      ),
    });
    const res = await spec.handle(new Request('http://localhost/_api/agents'), {});
    expect(res.status).toBe(500);
    expect((await res.json()).ok).toBe(false);
  });
});
