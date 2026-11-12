// F6b — which of the person's opencode config Maude switches off or refuses
// (acp/policy/opencode-user-config.ts). Contract: .ai/plans/notes/universal-acp-contract.md
// § "F6b — MCP/hooks isolation and flip". Scratch HOME / XDG only.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OPENCODE } from '../acp/agents/catalog.ts';
import type { PolicyCtx } from '../acp/agents/descriptor.ts';
import { MAY_ALL } from '../acp/may-scope.ts';
import { OPENCODE_FLAGS, opencodeLaunchPolicy } from '../acp/policy/launch-opencode.ts';
import {
  disabledMcp,
  OpencodeConfigError,
  opencodeConfigSources,
  readPersonOpencodeConfig,
} from '../acp/policy/opencode-user-config.ts';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'acp-opencode-cfg-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
function world() {
  const home = join(root, `h${++n}`);
  const xdg = join(home, 'xdg');
  mkdirSync(join(xdg, 'opencode'), { recursive: true });
  const proj = join(home, 'proj');
  mkdirSync(proj);
  const env = { HOME: home, XDG_CONFIG_HOME: xdg, XDG_DATA_HOME: join(home, 'data') };
  const put = (rel: string, body: string) => {
    const p = join(xdg, 'opencode', rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, body);
  };
  return { home, xdg, proj, env, put };
}

describe('sources', () => {
  test("global files in opencode's order, then OPENCODE_CONFIG, ~/.opencode and OPENCODE_CONFIG_DIR", () => {
    expect(
      opencodeConfigSources({
        HOME: '/Users/u',
        OPENCODE_CONFIG: '/etc/oc.json',
        OPENCODE_CONFIG_DIR: '/opt/oc',
      })
    ).toEqual([
      '/Users/u/.config/opencode/config.json',
      '/Users/u/.config/opencode/opencode.json',
      '/Users/u/.config/opencode/opencode.jsonc',
      '/etc/oc.json',
      '/Users/u/.opencode/opencode.json',
      '/Users/u/.opencode/opencode.jsonc',
      '/opt/oc/opencode.json',
      '/opt/oc/opencode.jsonc',
    ]);
  });
});

describe('readPersonOpencodeConfig', () => {
  test('no config at all → nothing to switch off', () => {
    const { env, proj } = world();
    expect(readPersonOpencodeConfig(env, proj)).toEqual({ mcpNames: [], sources: [] });
  });

  test('collects every MCP server name across the sources, JSONC included', () => {
    const { env, proj, put, home } = world();
    put('opencode.json', JSON.stringify({ mcp: { a: { type: 'local', command: ['x'] } } }));
    put(
      'opencode.jsonc',
      '{\n  // mine\n  "mcp": { "b": { "type": "remote", "url": "https://x" }, "a": {}, },\n  "provider": {},\n}\n'
    );
    mkdirSync(join(home, '.opencode'));
    writeFileSync(join(home, '.opencode', 'opencode.jsonc'), '{ "mcp": { "c": {} } }');
    const r = readPersonOpencodeConfig(env, proj);
    expect(r.mcpNames).toEqual(['a', 'b', 'c']);
    expect(r.sources).toHaveLength(3);
  });

  test('an empty file is no source of servers', () => {
    const { env, proj, put } = world();
    put('config.json', '  \n');
    expect(readPersonOpencodeConfig(env, proj).mcpNames).toEqual([]);
  });

  test('fails closed on a config it cannot parse, or one that is not an object', () => {
    const a = world();
    a.put('opencode.json', '{ "mcp": ');
    expect(() => readPersonOpencodeConfig(a.env, a.proj)).toThrow(OpencodeConfigError);
    const b = world();
    b.put('opencode.json', '[1]');
    expect(() => readPersonOpencodeConfig(b.env, b.proj)).toThrow(/not a JSON object/);
    const c = world();
    c.put('opencode.json', '{ "mcp": [1] }');
    expect(() => readPersonOpencodeConfig(c.env, c.proj)).toThrow(/mcp/);
  });

  test('refuses a listed plugin (opencode imports it even under OPENCODE_PURE)', () => {
    const a = world();
    a.put('opencode.json', '{ "plugin": ["opencode-foo"] }');
    expect(() => readPersonOpencodeConfig(a.env, a.proj)).toThrow(/plugins/);
    const b = world();
    b.put('opencode.json', '{ "plugin": [] }');
    expect(() => readPersonOpencodeConfig(b.env, b.proj)).not.toThrow();
  });

  test('refuses plugin or tool code in any global config folder', () => {
    for (const rel of ['plugin/a.ts', 'plugins/b.js', 'tool/c.ts', 'tools/d.mjs']) {
      const w = world();
      w.put(rel, 'export {}');
      expect(() => readPersonOpencodeConfig(w.env, w.proj)).toThrow(/plugin or tool code/);
    }
    const home = world();
    mkdirSync(join(home.home, '.opencode', 'plugin'), { recursive: true });
    writeFileSync(join(home.home, '.opencode', 'plugin', 'notify.ts'), 'export {}');
    expect(() => readPersonOpencodeConfig(home.env, home.proj)).toThrow(/plugin or tool code/);
    // Not code: a README in the folder is fine.
    const md = world();
    md.put('plugin/README.md', '#');
    expect(() => readPersonOpencodeConfig(md.env, md.proj)).not.toThrow();
  });

  test("refuses a .opencode in the project or any folder above it — the person's home excepted", () => {
    const a = world();
    mkdirSync(join(a.proj, '.opencode'));
    expect(() => readPersonOpencodeConfig(a.env, a.proj)).toThrow(/project has an opencode folder/);
    const b = world();
    const deep = join(b.proj, 'sub', 'dir');
    mkdirSync(deep, { recursive: true });
    mkdirSync(join(b.proj, '.opencode'));
    expect(() => readPersonOpencodeConfig(b.env, deep)).toThrow(/project has an opencode folder/);
    const c = world();
    mkdirSync(join(c.home, '.opencode'));
    expect(() => readPersonOpencodeConfig(c.env, c.proj)).not.toThrow();
  });

  test('refuses an organisation (well-known) sign-in: its remote config is not readable offline', () => {
    const w = world();
    mkdirSync(join(w.home, 'data', 'opencode'), { recursive: true });
    writeFileSync(
      join(w.home, 'data', 'opencode', 'auth.json'),
      JSON.stringify({ 'https://corp.example': { type: 'wellknown', key: 'K', token: 't' } })
    );
    expect(() => readPersonOpencodeConfig(w.env, w.proj)).toThrow(/organisation/);
    writeFileSync(
      join(w.home, 'data', 'opencode', 'auth.json'),
      JSON.stringify({ anthropic: { type: 'api', key: 'k' } })
    );
    expect(() => readPersonOpencodeConfig(w.env, w.proj)).not.toThrow();
  });
});

describe('the launch policy', () => {
  const ctxFor = (w: ReturnType<typeof world>): PolicyCtx => ({
    scopeRoot: w.proj,
    readRoots: [w.proj],
    writeRoots: [w.proj],
    credentialPaths: { dirs: [], files: [] },
    may: MAY_ALL,
    designRoots: [join(w.proj, '.design')],
    agentBin: '/opt/homebrew/bin/opencode',
    hostEnv: w.env,
  });

  test('each person server is named enabled:false, as an own key (even __proto__)', () => {
    const m = disabledMcp(['a', '__proto__']);
    expect(Object.keys(m)).toEqual(['a', '__proto__']);
    expect(JSON.parse(JSON.stringify(m))).toEqual(
      JSON.parse('{"a":{"enabled":false},"__proto__":{"enabled":false}}')
    );
  });

  test("the catalog's opencode reads the person's servers from the ctx's host env", () => {
    const w = world();
    w.put('opencode.jsonc', '{ "mcp": { "mine": { "type": "local", "command": ["x"] } } }');
    const env = OPENCODE.enforcement?.launchPolicy(ctxFor(w)).env ?? {};
    const cfg = JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? '{}');
    expect(cfg.mcp).toEqual({ mine: { enabled: false } });
    expect(cfg.plugin).toEqual([]);
    expect(env.OPENCODE_PURE).toBe('1');
    // Providers and models stay the person's: the policy never names them.
    expect(cfg.provider).toBeUndefined();
    expect(cfg.model).toBeUndefined();
  });

  test("the catalog's opencode refuses a plugin, a project .opencode, a bad config", () => {
    const a = world();
    a.put('plugins/x.ts', 'export {}');
    expect(() => OPENCODE.enforcement?.launchPolicy(ctxFor(a))).toThrow(OpencodeConfigError);
    const b = world();
    mkdirSync(join(b.proj, '.opencode'));
    expect(() => OPENCODE.enforcement?.launchPolicy(ctxFor(b))).toThrow(OpencodeConfigError);
    const c = world();
    c.put('config.json', '{');
    expect(() => OPENCODE.enforcement?.launchPolicy(ctxFor(c))).toThrow(OpencodeConfigError);
  });

  test('OPENCODE_PURE is one of the flags', () => {
    expect(OPENCODE_FLAGS.OPENCODE_PURE).toBe('1');
    expect(opencodeLaunchPolicy(ctxFor(world())).env.OPENCODE_PURE).toBe('1');
  });
});
