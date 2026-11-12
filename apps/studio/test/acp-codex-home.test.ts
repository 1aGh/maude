// F6b — the Maude-owned CODEX_HOME the Studio chat's Codex runs with (acp/policy/codex-home.ts).
// Contract: .ai/plans/notes/universal-acp-contract.md § "F6b — MCP/hooks isolation and flip".
// Scratch HOME only; never the person's real home.
import { afterAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CODEX } from '../acp/agents/catalog.ts';
import type { PolicyCtx } from '../acp/agents/descriptor.ts';
import { credentialPathsFor, MAY_ALL } from '../acp/may-scope.ts';
import {
  CODEX_HOME_FOREIGN,
  ensureMaudeCodexHome,
  MAUDE_CODEX_CONFIG_TOML,
  maudeCodexHomePath,
  personCodexAuthFile,
  personCodexHome,
  refuseProjectCodexConfig,
} from '../acp/policy/codex-home.ts';
import { codexLaunchPolicy } from '../acp/policy/launch-codex.ts';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'acp-codex-home-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
function world() {
  const home = join(root, `h${++n}`);
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'auth.json'), '{"OPENAI_API_KEY":"sk-fake"}');
  // The person's own config: an MCP server and a hook that must never reach Maude's home.
  writeFileSync(
    join(home, '.codex', 'config.toml'),
    '[mcp_servers.mine]\ncommand = "/bin/sh"\n[[hooks.SessionStart]]\n'
  );
  writeFileSync(join(home, '.codex', 'hooks.json'), '{"hooks":{}}');
  return { home, env: { HOME: home } as Record<string, string> };
}

describe('where it lives', () => {
  test('profile default → ~/.config/maude/agents/codex-home; another profile → profiles/<id>/…', () => {
    expect(maudeCodexHomePath({ HOME: '/Users/u' })).toBe(
      '/Users/u/.config/maude/agents/codex-home'
    );
    expect(maudeCodexHomePath({ HOME: '/Users/u', MAUDE_PROFILE_ID: 'work' })).toBe(
      '/Users/u/.config/maude/profiles/work/agents/codex-home'
    );
    // An id that is not [a-z0-9-]{1,32} is profile default, never a path segment.
    expect(maudeCodexHomePath({ HOME: '/Users/u', MAUDE_PROFILE_ID: '../x' })).toBe(
      '/Users/u/.config/maude/agents/codex-home'
    );
  });

  test('it sits inside a credential folder every agent is denied', () => {
    const env = { HOME: '/Users/u' };
    const creds = credentialPathsFor(env, '/Users/u', 'darwin');
    const home = maudeCodexHomePath(env);
    expect(creds.dirs.some((d) => home.startsWith(`${d}/`))).toBe(true);
  });

  test("the person's Codex home: $CODEX_HOME when absolute, else ~/.codex", () => {
    expect(personCodexHome({ HOME: '/Users/u' })).toBe('/Users/u/.codex');
    expect(personCodexHome({ HOME: '/Users/u', CODEX_HOME: '/opt/cx' })).toBe('/opt/cx');
    expect(personCodexHome({ HOME: '/Users/u', CODEX_HOME: 'rel' })).toBe('/Users/u/.codex');
    expect(personCodexAuthFile({ HOME: '/Users/u', CODEX_HOME: '/opt/cx' })).toBe(
      '/opt/cx/auth.json'
    );
  });

  test("the person's auth.json is a credential file (default and $CODEX_HOME)", () => {
    expect(credentialPathsFor({ HOME: '/Users/u' }, '/Users/u', 'darwin').files).toContain(
      '/Users/u/.codex/auth.json'
    );
    expect(
      credentialPathsFor({ HOME: '/Users/u', CODEX_HOME: '/opt/cx' }, '/Users/u', 'darwin').files
    ).toContain('/opt/cx/auth.json');
  });
});

describe('ensureMaudeCodexHome', () => {
  test("holds only a link to the person's auth.json and Maude's config.toml, owner-only", () => {
    const { home, env } = world();
    const dir = ensureMaudeCodexHome(env);
    expect(dir).toBe(join(home, '.config', 'maude', 'agents', 'codex-home'));
    expect(readdirSync(dir).sort()).toEqual(['auth.json', 'config.toml']);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const link = join(dir, 'auth.json');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(join(home, '.codex', 'auth.json'));
    expect(readFileSync(link, 'utf8')).toContain('sk-fake');
    const cfg = readFileSync(join(dir, 'config.toml'), 'utf8');
    expect(cfg).toBe(MAUDE_CODEX_CONFIG_TOML);
    // Nothing of the person's config is copied: comments only, no setting, no table.
    const settings = cfg.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
    expect(settings).toEqual([]);
    expect(statSync(join(dir, 'config.toml')).mode & 0o777).toBe(0o600);
  });

  test('every folder it creates is owner-only', () => {
    const { home, env } = world();
    ensureMaudeCodexHome(env);
    for (const p of ['.config/maude', '.config/maude/agents']) {
      expect(statSync(join(home, p)).mode & 0o777).toBe(0o700);
    }
  });

  test("respects the person's own CODEX_HOME, and a missing auth.json leaves a dangling link", () => {
    const { home } = world();
    const cx = join(home, 'elsewhere');
    const dir = ensureMaudeCodexHome({ HOME: home, CODEX_HOME: cx });
    expect(readlinkSync(join(dir, 'auth.json'))).toBe(join(cx, 'auth.json'));
    expect(existsSync(join(dir, 'auth.json'))).toBe(false);
    // The person signs in later (Settings runs `codex login` against THEIR home): the chat sees it.
    mkdirSync(cx);
    writeFileSync(join(cx, 'auth.json'), '{"OPENAI_API_KEY":"sk-later"}');
    expect(readFileSync(join(dir, 'auth.json'), 'utf8')).toContain('sk-later');
  });

  test('a write through the link lands in the person file (a token refresh)', () => {
    const { home, env } = world();
    const dir = ensureMaudeCodexHome(env);
    writeFileSync(join(dir, 'auth.json'), '{"OPENAI_API_KEY":"sk-refreshed"}');
    expect(readFileSync(join(home, '.codex', 'auth.json'), 'utf8')).toContain('sk-refreshed');
    expect(lstatSync(join(dir, 'auth.json')).isSymbolicLink()).toBe(true);
  });

  test('repairs on every spawn: a wrong link, a planted config and the foreign files go', () => {
    const { home, env } = world();
    const dir = ensureMaudeCodexHome(env);
    rmSync(join(dir, 'auth.json'));
    symlinkSync(join(home, 'not-auth'), join(dir, 'auth.json'));
    writeFileSync(join(dir, 'config.toml'), '[mcp_servers.planted]\ncommand = "x"\n');
    for (const f of CODEX_HOME_FOREIGN) {
      if (f === 'rules') {
        mkdirSync(join(dir, 'rules'));
        writeFileSync(join(dir, 'rules', 'default.rules'), 'prefix_rule(pattern=["rm"])');
      } else writeFileSync(join(dir, f), 'planted');
    }
    // Codex's own runtime state stays.
    mkdirSync(join(dir, 'sessions'));
    ensureMaudeCodexHome(env);
    expect(readlinkSync(join(dir, 'auth.json'))).toBe(join(home, '.codex', 'auth.json'));
    expect(readFileSync(join(dir, 'config.toml'), 'utf8')).toBe(MAUDE_CODEX_CONFIG_TOML);
    for (const f of CODEX_HOME_FOREIGN) expect(existsSync(join(dir, f))).toBe(false);
    expect(existsSync(join(dir, 'sessions'))).toBe(true);
  });

  test('a plain auth.json file there is replaced by the link', () => {
    const { home, env } = world();
    const dir = maudeCodexHomePath(env);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'auth.json'), '{"OPENAI_API_KEY":"sk-stale"}');
    ensureMaudeCodexHome(env);
    expect(readlinkSync(join(dir, 'auth.json'))).toBe(join(home, '.codex', 'auth.json'));
  });

  test('fails closed: the folder is a symlink, auth.json is a folder, or CODEX_HOME is Maude’s own', () => {
    const a = world();
    const target = join(a.home, 'decoy');
    mkdirSync(target);
    mkdirSync(join(a.home, '.config', 'maude', 'agents'), { recursive: true });
    symlinkSync(target, maudeCodexHomePath(a.env));
    expect(() => ensureMaudeCodexHome(a.env)).toThrow(/plain folder/);

    const b = world();
    mkdirSync(join(maudeCodexHomePath(b.env), 'auth.json'), { recursive: true });
    expect(() => ensureMaudeCodexHome(b.env)).toThrow(/folder/);

    const c = world();
    expect(() =>
      ensureMaudeCodexHome({ HOME: c.home, CODEX_HOME: maudeCodexHomePath(c.env) })
    ).toThrow(/Maude's own/);
  });
});

describe('the project .codex folder', () => {
  test('refused: codex-acp trusts the session folder, so Codex would load it', () => {
    const { home } = world();
    const proj = join(home, 'proj');
    mkdirSync(proj);
    expect(() => refuseProjectCodexConfig(proj)).not.toThrow();
    mkdirSync(join(proj, '.codex'));
    expect(() => refuseProjectCodexConfig(proj)).toThrow(/Codex folder/);
  });
});

describe('the launch policy', () => {
  const ctxFor = (home: string, proj: string): PolicyCtx => ({
    scopeRoot: proj,
    readRoots: [proj],
    writeRoots: [proj],
    credentialPaths: credentialPathsFor({ HOME: home }, home),
    may: MAY_ALL,
    designRoots: [join(proj, '.design')],
    agentBin: '/usr/local/bin/codex',
    hostEnv: { HOME: home },
  });

  test('the pure builder names CODEX_HOME only when given one', () => {
    const { home } = world();
    const ctx = ctxFor(home, join(home, 'proj'));
    expect(codexLaunchPolicy(ctx).env.CODEX_HOME).toBeUndefined();
    expect(codexLaunchPolicy(ctx, undefined, '/x/codex-home').env.CODEX_HOME).toBe('/x/codex-home');
  });

  test("the catalog's Codex runs with Maude's home, made from the ctx's host env", () => {
    const { home } = world();
    const proj = join(home, 'proj');
    mkdirSync(proj);
    const env = CODEX.enforcement?.launchPolicy(ctxFor(home, proj)).env ?? {};
    expect(env.CODEX_HOME).toBe(join(home, '.config', 'maude', 'agents', 'codex-home'));
    expect(existsSync(join(env.CODEX_HOME, 'config.toml'))).toBe(true);
  });

  test("the catalog's Codex refuses a project with a .codex folder", () => {
    const { home } = world();
    const proj = join(home, 'proj');
    mkdirSync(join(proj, '.codex'), { recursive: true });
    expect(() => CODEX.enforcement?.launchPolicy(ctxFor(home, proj))).toThrow(/Codex folder/);
  });
});
