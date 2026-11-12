// F6b — what of the person's own opencode config the Studio chat must switch off.
// Contract: .ai/plans/notes/universal-acp-contract.md § "F6b — MCP/hooks isolation and flip".
//
// opencode MERGES every config source (measured, F6): `mcp: {}` in OPENCODE_CONFIG_CONTENT leaves
// the person's MCP servers on, and they run outside every Maude gate. Unlike Codex, opencode keeps
// the person's providers and models in the same files, so the files cannot be shadowed. Instead,
// at every spawn, Maude reads the person's global config sources and names each MCP server there
// `enabled: false` in OPENCODE_CONFIG_CONTENT (applied after them, so the deep merge turns each one
// off; measured, F6b).
//
// Plugins and custom tools CANNOT be switched off (measured, F6b, 1.18.30): OPENCODE_PURE=1 stops a
// plugin from being activated, but opencode's config-plugin loader still `import()`s every module
// it finds — a config `plugin` entry and `{plugin,plugins}/*.{ts,js}` in each config folder — so
// the module's top-level code runs in opencode's own process, outside every Maude gate. That loader
// also reads the SERVED REPO's `.opencode/` folder (and every `.opencode` above it) although
// OPENCODE_DISABLE_PROJECT_CONFIG=1 is set: a planted `.opencode/plugins/x.js` ran. So, fail closed,
// opencode is refused when:
//   • a global config source lists a plugin (`plugin` / `plugins`), or a global config folder holds
//     `{plugin,plugins,tool,tools}/*.{ts,js,mjs,cjs}`;
//   • the project folder or any folder above it (the person's home excepted: that one is a global
//     folder, judged as above) has a `.opencode` entry at all — its agents (`agent/*.md`) can also
//     carry their own permission blocks, which Maude's would have to out-rank.
//
// Sources read (opencode 1.18.30 `Config.loadInstanceState`; project config is already off through
// OPENCODE_DISABLE_PROJECT_CONFIG=1):
//   • $XDG_CONFIG_HOME/opencode/{config.json, opencode.json, opencode.jsonc} (else ~/.config)
//   • $OPENCODE_CONFIG                     (a file the person's env names)
//   • ~/.opencode/{opencode.json, opencode.jsonc}
//   • $OPENCODE_CONFIG_DIR/{opencode.json, opencode.jsonc}
// A remote "well-known" organisation config (an auth.json entry of type `wellknown`) is fetched by
// opencode at start and cannot be read offline, so its MCP servers cannot be named: refused.
//
// Fail closed: a source that exists but cannot be read or parsed (JSONC: comments and trailing
// commas are fine) refuses the spawn with a clear error. A missing file is no source.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { e2eSwitch, IS_RELEASE_BUILD } from '../../release-build.ts';
import type { HostEnv } from './codex-home.ts';

export class OpencodeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpencodeConfigError';
  }
}

export interface PersonOpencodeConfig {
  /** Every MCP server name the person's global config sources declare (deduplicated, in order). */
  mcpNames: string[];
  /** The files that were read. */
  sources: string[];
}

const REFUSE = 'Maude does not start opencode while it is there.';

/**
 * The home the person's GLOBAL opencode sources are read under (`~/.opencode`, the `~/.config` and
 * `~/.local/share` fallbacks). Only the universal-ACP desktop e2e lane moves it (`MAUDE_E2E_OPENCODE_HOME`,
 * e2e sidecar builds only — release-build.ts `e2eSwitch`; a release build ignores it): the lane's fake
 * opencode must not be refused for the developer's own opencode plugins. The project's `.opencode` chain
 * (`projectOpencodeEntries`) always keeps the real HOME as its one exception.
 */
export function opencodePersonHome(env: HostEnv = process.env, release = IS_RELEASE_BUILD): string {
  return abs(e2eSwitch(env, 'MAUDE_E2E_OPENCODE_HOME', release)) ?? abs(env.HOME) ?? homedir();
}

/** Global config folders opencode scans for plugins / tools / agents (existing or not). */
export function opencodeConfigDirs(env: HostEnv = process.env): string[] {
  const home = opencodePersonHome(env);
  const xdg = abs(env.XDG_CONFIG_HOME) ?? join(home, '.config');
  const out = [join(xdg, 'opencode'), join(home, '.opencode')];
  const dir = abs(env.OPENCODE_CONFIG_DIR);
  if (dir) out.push(dir);
  return [...new Set(out)];
}

const CODE_RE = /\.(ts|js|mjs|cjs|tsx|jsx)$/i;

/** Executable code opencode would import from one config folder (`{plugin,plugins,tool,tools}/*`). */
export function opencodeCodeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const sub of ['plugin', 'plugins', 'tool', 'tools']) {
    let names: string[];
    try {
      names = readdirSync(join(dir, sub));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') continue;
      throw new OpencodeConfigError(
        `opencode's folder ${join(dir, sub)} could not be read. ${REFUSE}`
      );
    }
    for (const n of names) if (CODE_RE.test(n)) out.push(join(dir, sub, n));
  }
  return out;
}

/** `.opencode` entries in the project folder and every folder above it (the home folder excepted). */
export function projectOpencodeEntries(projectRoot: string, env: HostEnv = process.env): string[] {
  const home = abs(env.HOME) ?? homedir();
  const out: string[] = [];
  let dir = resolve(projectRoot);
  for (;;) {
    if (dir !== home) {
      const p = join(dir, '.opencode');
      if (existsSync(p)) out.push(p);
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return out;
}

const abs = (p: string | undefined) => (p && isAbsolute(p) ? resolve(p) : null);

/** The person's global opencode config files, in opencode's load order (existing or not). */
export function opencodeConfigSources(env: HostEnv = process.env): string[] {
  const home = opencodePersonHome(env);
  const xdg = abs(env.XDG_CONFIG_HOME) ?? join(home, '.config');
  const out = ['config.json', 'opencode.json', 'opencode.jsonc'].map((f) =>
    join(xdg, 'opencode', f)
  );
  const custom = abs(env.OPENCODE_CONFIG);
  if (custom) out.push(custom);
  for (const f of ['opencode.json', 'opencode.jsonc']) out.push(join(home, '.opencode', f));
  const dir = abs(env.OPENCODE_CONFIG_DIR);
  if (dir) for (const f of ['opencode.json', 'opencode.jsonc']) out.push(join(dir, f));
  return [...new Set(out)];
}

/** opencode's auth store (`$XDG_DATA_HOME/opencode/auth.json`). Only entry TYPES are looked at. */
export function opencodeAuthFile(env: HostEnv = process.env): string {
  const home = opencodePersonHome(env);
  return join(abs(env.XDG_DATA_HOME) ?? join(home, '.local', 'share'), 'opencode', 'auth.json');
}

function parseJsonc(text: string, file: string): unknown {
  try {
    return Bun.JSONC.parse(text);
  } catch (e) {
    throw new OpencodeConfigError(
      `Your opencode config ${file} could not be read (${(e as Error).message}). Maude does not start opencode until it can see which MCP servers it must keep off.`
    );
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Read the person's global opencode config sources (and look at the project's `.opencode` chain
 * when `projectRoot` is given). Throws OpencodeConfigError when opencode must not start (fail closed).
 */
export function readPersonOpencodeConfig(
  env: HostEnv = process.env,
  projectRoot?: string
): PersonOpencodeConfig {
  const mcp = new Set<string>();
  const plugins: string[] = [];
  const sources: string[] = [];
  for (const file of opencodeConfigSources(env)) {
    if (!existsSync(file)) continue;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (e) {
      throw new OpencodeConfigError(
        `Your opencode config ${file} could not be read (${(e as NodeJS.ErrnoException).code ?? 'error'}). Maude does not start opencode until it can see which MCP servers it must keep off.`
      );
    }
    sources.push(file);
    if (text.trim() === '') continue;
    const cfg = parseJsonc(text, file);
    if (!isObj(cfg)) {
      throw new OpencodeConfigError(
        `Your opencode config ${file} is not a JSON object. Maude does not start opencode until it can see which MCP servers it must keep off.`
      );
    }
    if (cfg.mcp !== undefined) {
      if (!isObj(cfg.mcp)) {
        throw new OpencodeConfigError(
          `Your opencode config ${file} has an \`mcp\` that is not an object.`
        );
      }
      for (const name of Object.keys(cfg.mcp)) mcp.add(name);
    }
    for (const key of ['plugin', 'plugins']) {
      const list = cfg[key];
      if (list === undefined) continue;
      if (!Array.isArray(list) || list.length > 0) plugins.push(`${file} (\`${key}\`)`);
    }
  }
  if (plugins.length) {
    throw new OpencodeConfigError(
      `Your opencode config lists plugins (${plugins.join(', ')}). opencode loads plugin code even when told not to, outside every limit Maude sets. ${REFUSE}`
    );
  }
  for (const dir of opencodeConfigDirs(env)) {
    const code = opencodeCodeFiles(dir);
    if (code.length) {
      throw new OpencodeConfigError(
        `Your opencode folder has plugin or tool code (${code.slice(0, 3).join(', ')}${code.length > 3 ? ', …' : ''}). opencode loads it even when told not to, outside every limit Maude sets. ${REFUSE}`
      );
    }
  }
  if (projectRoot) {
    const found = projectOpencodeEntries(projectRoot, env);
    if (found.length) {
      throw new OpencodeConfigError(
        `This project has an opencode folder (${found[0]}). opencode loads its plugins, tools and agents although Maude tells it to ignore project config. ${REFUSE}`
      );
    }
  }
  const auth = opencodeAuthFile(env);
  if (existsSync(auth)) {
    let entries: unknown;
    try {
      entries = JSON.parse(readFileSync(auth, 'utf8'));
    } catch {
      throw new OpencodeConfigError(
        `opencode's sign-in file ${auth} could not be read, so Maude cannot tell whether it names a remote organisation config. Maude does not start opencode.`
      );
    }
    if (isObj(entries) && Object.values(entries).some((v) => isObj(v) && v.type === 'wellknown')) {
      throw new OpencodeConfigError(
        'opencode is signed in to an organisation that sends it a remote config, which may start MCP servers Maude cannot see. Maude does not start opencode.'
      );
    }
  }
  return { mcpNames: [...mcp], sources };
}

/** The `mcp` block that turns each named server off (an own key per name, `__proto__` included). */
export function disabledMcp(names: readonly string[]): Record<string, { enabled: false }> {
  return Object.fromEntries(names.map((n) => [n, { enabled: false as const }]));
}
