// DDR-143 — session-scoped plugin auto-bootstrap: the WIRE contract.
//
// Two layers: (1) the newSession params carrier — the resolved plugin configs
// must land on `_meta.claudeCode.options.plugins`, coexisting with the studio
// brief's `_meta.systemPrompt.append`; (2) the UPGRADE GUARD — that `_meta` path
// is adapter/SDK-INTERNAL and undocumented, so a dependency bump that stops
// forwarding `_meta.claudeCode.options` (adapter) or drops `plugins` (SDK) must
// fail HERE, loudly, instead of silently shipping a desktop app whose chat
// resolves no `/design:*` on a pristine machine.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { newSessionParams } from '../acp/bridge.ts';
import {
  computeSessionPlugins,
  type SdkPluginConfig,
  suppressionFor,
} from '../acp/plugin-bootstrap.ts';

// Every test here reads Claude Code's config dir through CLAUDE_CONFIG_DIR, pointed at an
// empty scratch dir — never this machine's real ~/.claude (its enabledPlugins would leak in).
let configDir = '';
let prevConfigDir: string | undefined;
beforeEach(() => {
  prevConfigDir = process.env.CLAUDE_CONFIG_DIR;
  configDir = mkdtempSync(join(tmpdir(), 'maude-s12-3-cfg-'));
  process.env.CLAUDE_CONFIG_DIR = configDir;
});
afterEach(() => {
  if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = prevConfigDir;
  rmSync(configDir, { recursive: true, force: true });
});

const PLUGINS: SdkPluginConfig[] = [
  { type: 'local', path: '/bundle/plugins/design', skipMcpDiscovery: true },
  { type: 'local', path: '/bundle/plugins/flow', skipMcpDiscovery: true },
];

type Meta = {
  systemPrompt?: { append?: string };
  claudeCode?: {
    options?: {
      plugins?: SdkPluginConfig[];
      settingSources?: string[];
      settings?: { enabledPlugins?: Record<string, boolean> };
    };
  };
};

describe('newSessionParams — plugin carrier shape', () => {
  test('with plugins: they ride _meta.claudeCode.options.plugins', () => {
    const p = newSessionParams('/repo', undefined, PLUGINS);
    expect(p.cwd).toBe('/repo');
    expect((p._meta as Meta).claudeCode?.options?.plugins).toEqual(PLUGINS);
  });

  test('empty plugins: claudeCode carries settingSources but NO plugins (power-user / web no-op)', () => {
    const p = newSessionParams('/repo', 'BRIEF', []);
    const opts = (p._meta as Meta).claudeCode?.options;
    expect(opts?.plugins).toBeUndefined();
    expect(opts?.settingSources).toEqual(['user']); // security narrowing always present
  });

  test('undefined plugins: claudeCode carries settingSources, no plugins', () => {
    const p = newSessionParams('/repo', 'BRIEF');
    const opts = (p._meta as Meta).claudeCode?.options;
    expect(opts?.plugins).toBeUndefined();
    expect(opts?.settingSources).toEqual(['user']);
  });

  test('brief + plugins coexist under one _meta (both siblings intact)', () => {
    const p = newSessionParams('/repo', 'BRIEF', PLUGINS);
    const meta = p._meta as Meta;
    expect(meta.systemPrompt?.append).toBe('BRIEF');
    expect(meta.claudeCode?.options?.plugins).toEqual(PLUGINS);
  });

  test('plugins only, no brief: still no systemPrompt, but claudeCode present', () => {
    const p = newSessionParams('/repo', undefined, PLUGINS);
    const meta = p._meta as Meta;
    expect(meta.systemPrompt).toBeUndefined();
    expect(meta.claudeCode?.options?.plugins).toEqual(PLUGINS);
  });

  test('nothing injected: _meta still carries the settingSources security narrowing', () => {
    const p = newSessionParams('/repo', undefined, []);
    const meta = p._meta as Meta;
    expect(meta.systemPrompt).toBeUndefined();
    expect(meta.claudeCode?.options?.plugins).toBeUndefined();
    // Every Maude bridge session is auto-approving → settingSources is ALWAYS narrowed.
    expect(meta.claudeCode?.options?.settingSources).toEqual(['user']);
  });

  test('settingSources is narrowed to user-only on EVERY session (DDR-144 F2)', () => {
    for (const p of [
      newSessionParams('/repo'),
      newSessionParams('/repo', 'BRIEF'),
      newSessionParams('/repo', 'BRIEF', PLUGINS),
      newSessionParams('/repo', undefined, PLUGINS),
    ]) {
      expect((p._meta as Meta).claudeCode?.options?.settingSources).toEqual(['user']);
    }
  });

  // DDR-168 — the structural double-registration guard: a non-empty `plugins`
  // must also force off any natively-loaded user-level copy of the same id via
  // the SDK's "flag" settings layer, so the bundled copy is the ONLY one that
  // ever loads.
  test('with plugins: forces each injected id off via options.settings.enabledPlugins (double-registration guard)', () => {
    const p = newSessionParams('/repo', undefined, PLUGINS);
    // S12.3 — derived from the injection set (PLUGINS = design + flow), not a hand literal:
    // flow is suppressed because it is injected here, kgai is not because it is not.
    expect((p._meta as Meta).claudeCode?.options?.settings?.enabledPlugins).toEqual({
      'design@maude': false,
      'flow@maude': false,
    });
  });

  test('empty plugins: options.settings is entirely absent (web/npm path unaffected)', () => {
    const p = newSessionParams('/repo', 'BRIEF', []);
    expect((p._meta as Meta).claudeCode?.options?.settings).toBeUndefined();
  });

  test('undefined plugins: options.settings is entirely absent', () => {
    const p = newSessionParams('/repo', 'BRIEF');
    expect((p._meta as Meta).claudeCode?.options?.settings).toBeUndefined();
  });
});

// S12.3 — the suppression map is DERIVED from the injection set (S12-slices §3 row S12.3).
// The old hand literal `{ 'design@maude': false, kgai: false }` drifted twice over: a
// re-enabled flow was never suppressed, and the bare `kgai` key matches no native copy at all
// (Claude Code keys enabledPlugins as `<plugin>@<marketplace>`; kgai installs as
// `kgai@kgai-marketplace`).
describe('suppressionFor — derived from the injection set', () => {
  const bundle = (): string => mkdtempSync(join(tmpdir(), 'maude-s12-3-bundle-'));
  const plant = (root: string, dir: string, manifestName?: string): SdkPluginConfig => {
    const path = join(root, 'plugins', dir);
    mkdirSync(join(path, '.claude-plugin'), { recursive: true });
    if (manifestName !== undefined) {
      writeFileSync(
        join(path, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: manifestName })
      );
    }
    return { type: 'local', path, skipMcpDiscovery: true };
  };
  const userEnabled = (enabled: Record<string, unknown>): void =>
    writeFileSync(join(configDir, 'settings.json'), JSON.stringify({ enabledPlugins: enabled }));

  test('a planted 4th injected plugin is suppressed with no edit to the suppression code', () => {
    const root = bundle();
    try {
      const plugins = [
        plant(root, 'design', 'design'),
        plant(root, 'flow', 'flow'),
        plant(root, 'kgai', 'kgai'),
        plant(root, 'planted', 'planted'),
      ];
      const map = suppressionFor(plugins);
      expect(map['planted@maude']).toBe(false);
      expect(Object.keys(map).sort()).toEqual([
        'design@maude',
        'flow@maude',
        'kgai@maude',
        'planted@maude',
      ]);
      // …and newSessionParams carries exactly that map, so the bridge needs no edit either.
      const p = newSessionParams('/repo', 'BRIEF', plugins);
      expect((p._meta as Meta).claudeCode?.options?.settings?.enabledPlugins).toEqual(map);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the user's own native copy is suppressed under whatever marketplace it came from", () => {
    const root = bundle();
    try {
      userEnabled({
        'kgai@kgai-marketplace': true, // the id kgai really installs under
        'design@my-fork': true, // design added from a marketplace alias (CLAUDE.md: double-load)
        'planted@elsewhere': true,
        'github@claude-plugins-official': true, // not injected — never touched
        'designer@maude': true, // a different plugin whose name only starts the same
      });
      const map = suppressionFor([
        plant(root, 'design', 'design'),
        plant(root, 'kgai', 'kgai'),
        plant(root, 'planted', 'planted'),
      ]);
      expect(map).toEqual({
        'design@maude': false,
        'design@my-fork': false,
        'kgai@maude': false,
        'kgai@kgai-marketplace': false,
        'planted@maude': false,
        'planted@elsewhere': false,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('installed-but-not-in-settings copies are suppressed too (installed_plugins.json)', () => {
    const root = bundle();
    try {
      mkdirSync(join(configDir, 'plugins'), { recursive: true });
      writeFileSync(
        join(configDir, 'plugins', 'installed_plugins.json'),
        JSON.stringify({ plugins: { 'design@other-mkt': [{ scope: 'user' }] } })
      );
      expect(suppressionFor([plant(root, 'design', 'design')])).toEqual({
        'design@maude': false,
        'design@other-mkt': false,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('can only ever switch a plugin OFF — every value is false, whatever the inputs', () => {
    const root = bundle();
    try {
      userEnabled({ 'design@maude': true, 'design@x': 'yes', 'flow@maude': false });
      const map = suppressionFor([plant(root, 'design', 'design'), plant(root, 'flow', 'flow')]);
      expect(Object.keys(map).length).toBeGreaterThan(0);
      for (const v of Object.values(map)) expect(v).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a manifest name that is not a plugin id falls back to the bundle dir name', () => {
    // The manifest is a bundle file, but its name still becomes a settings key: anything that is
    // not a plain plugin id (a key injection, a wildcard, a path) is ignored.
    const root = bundle();
    try {
      const map = suppressionFor([
        plant(root, 'design', 'x@maude": true, "evil'),
        plant(root, 'flow', '*'),
        plant(root, 'kgai'), // no manifest at all
      ]);
      expect(Object.keys(map).sort()).toEqual(['design@maude', 'flow@maude', 'kgai@maude']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a user-config key that is not a plain <id>@<marketplace> is never copied', () => {
    const root = bundle();
    try {
      userEnabled({ 'design@a b': true, 'design@': true, 'design@x@y': true, 'design@ok': true });
      expect(suppressionFor([plant(root, 'design', 'design')])).toEqual({
        'design@maude': false,
        'design@ok': false,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('unreadable / malformed Claude Code config degrades to the canonical ids only', () => {
    writeFileSync(join(configDir, 'settings.json'), '{not json');
    expect(suppressionFor(PLUGINS)).toEqual({ 'design@maude': false, 'flow@maude': false });
  });

  test('empty injection set ⇒ empty map (newSessionParams then omits settings entirely)', () => {
    userEnabled({ 'design@maude': true });
    expect(suppressionFor([])).toEqual({});
  });

  test('the real bundle: computeSessionPlugins over this tree suppresses design@maude', () => {
    const repo = join(import.meta.dir, '..', '..', '..');
    const plugins = computeSessionPlugins({
      native: true,
      designDir: join(repo, 'plugins', 'design'),
      flowDir: null,
      kgaiDir: null,
    });
    expect(suppressionFor(plugins)).toEqual({ 'design@maude': false });
  });

  test('bridge.ts carries no hand-maintained suppression literal any more', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'acp', 'bridge.ts'), 'utf8');
    expect(src).not.toMatch(/enabledPlugins:\s*\{\s*'/);
    expect(src).toContain('suppressionFor(plugins)');
  });
});

describe('upgrade guard — installed adapter + SDK still honor the plugins contract', () => {
  const adapterEntry = join(
    import.meta.dir,
    '..',
    'node_modules',
    '@agentclientprotocol',
    'claude-agent-acp',
    'dist',
    'acp-agent.js'
  );

  test('adapter newSession reads _meta.claudeCode.options and forwards it to query()', () => {
    expect(existsSync(adapterEntry)).toBe(true);
    const src = readFileSync(adapterEntry, 'utf8');
    // Verified at claude-agent-acp@0.49.0 (acp-agent.js newSession):
    //   const userProvidedOptions = sessionMeta?.claudeCode?.options;   (:2302)
    //   const options = { …, ...userProvidedOptions, … };               (:2333)
    //   const q = query({ prompt: input, options });                    (:2455)
    // `plugins` is not in the override list after the spread, so it survives into
    // query(). A bump that renames/drops any link in this chain must fail here —
    // then adapt, or fall back to settings.enabledPlugins + a local marketplace
    // (plan Task 1 fallback).
    expect(src).toMatch(/claudeCode\s*(\?\.|\.)\s*options/);
    expect(src).toContain('userProvidedOptions');
    expect(src).toMatch(/\.\.\.userProvidedOptions/);
    expect(src).toMatch(/query\(\{[\s\S]{0,80}options[\s\S]{0,40}\}\)/);
  });

  test('SDK Options declares plugins?: SdkPluginConfig[] (the accepted field)', () => {
    // Resolve the transitive @anthropic-ai/claude-agent-sdk. Resolve from the
    // adapter's REAL dir (pnpm store), where the SDK is a peer sibling — the
    // apps/studio symlink alone doesn't expose the pnpm peer node_modules.
    let sdkPkg: string | null = null;
    try {
      const realAdapterDir = dirname(realpathSync(adapterEntry));
      sdkPkg = Bun.resolveSync('@anthropic-ai/claude-agent-sdk/package.json', realAdapterDir);
    } catch {
      sdkPkg = null;
    }
    expect(sdkPkg).not.toBeNull();
    const dts = join(dirname(sdkPkg as string), 'sdk.d.ts');
    expect(existsSync(dts)).toBe(true);
    const src = readFileSync(dts, 'utf8');
    // sdk.d.ts:1683 `plugins?: SdkPluginConfig[];` + :3766 the { type:'local'; path } shape.
    expect(src).toMatch(/plugins\?\s*:\s*SdkPluginConfig\[\]/);
    expect(src).toMatch(/SdkPluginConfig\s*=\s*\{/);
    expect(src).toMatch(/type:\s*'local'/);
  });

  // DDR-168 — the same style of guard, for the `options.settings` mechanism the
  // double-registration fix depends on: `settings` must NOT be among the fields
  // the adapter overrides after the `...userProvidedOptions` spread (else our
  // `enabledPlugins: false` override would be silently discarded), and the SDK
  // must still declare `Settings.enabledPlugins` as an accepted field.
  test('adapter forwards `settings` from userProvidedOptions and only ever overrides it conditionally when the caller left it unset', () => {
    expect(existsSync(adapterEntry)).toBe(true);
    const src = readFileSync(adapterEntry, 'utf8');
    // Locate the `...userProvidedOptions` spread and inspect what follows it up
    // to the `query({ options })` call. Verified live at claude-agent-acp@0.57.0:
    // the object DOES contain a later `settings:` assignment (a
    // CLAUDE_MODEL_CONFIG env-var fallback) — but it's gated behind
    // `!userProvidedOptions?.settings && …`, i.e. it only fires when the caller
    // did NOT already provide a settings object. A caller-provided `settings`
    // (ours, carrying `enabledPlugins`) always wins. A bump that drops that
    // guard — making the fallback unconditional — must fail here, since it
    // would silently clobber DDR-168's double-registration override.
    const spreadIdx = src.indexOf('...userProvidedOptions');
    expect(spreadIdx).toBeGreaterThan(-1);
    const queryIdx = src.indexOf('query(', spreadIdx);
    expect(queryIdx).toBeGreaterThan(spreadIdx);
    const window = src.slice(spreadIdx, queryIdx);
    expect(window).toMatch(/!userProvidedOptions\?\.settings\s*&&/);
  });

  test("SDK Options declares settings (Settings.enabledPlugins is the field DDR-168's guard relies on)", () => {
    let sdkPkg: string | null = null;
    try {
      const realAdapterDir = dirname(realpathSync(adapterEntry));
      sdkPkg = Bun.resolveSync('@anthropic-ai/claude-agent-sdk/package.json', realAdapterDir);
    } catch {
      sdkPkg = null;
    }
    expect(sdkPkg).not.toBeNull();
    const dts = join(dirname(sdkPkg as string), 'sdk.d.ts');
    expect(existsSync(dts)).toBe(true);
    const src = readFileSync(dts, 'utf8');
    // sdk.d.ts:1831 `settings?: Settings;` (or similarly named field on Options) +
    // :5193 `Settings.enabledPlugins` — a bump that renames/drops either must
    // fail here, then adapt, rather than silently reopening double-registration.
    expect(src).toMatch(/settings\?\s*:/);
    expect(src).toMatch(/enabledPlugins\??\s*:/);
  });
});
