// home/cli.ts — "Install the maude command" (S6.6, contract Q13; DDR-177: the app never assumes npm).
//
//   GET  /_home/cli/status   → { state, link, claude, plugin }
//   POST /_home/cli/install  → link ~/.local/bin/maude → the BUNDLED maude; then, when `claude` is
//                              present, add the plugin (marketplace add 1aGh/maude + install)
//
// The link is made with ONE `symlink(2)` call and nothing else: symlink never follows and never
// replaces an existing path (EEXIST), so there is no check-then-write window to race. Whatever
// already sits at the link path — a regular file, a directory, a symlink anywhere else, a dangling
// one — is reported and left exactly as it was; Home never unlinks, renames over or writes through
// it. A link that already points at the bundled maude is a no-op. The target is only ever the
// bundled CLI: an absolute path to a regular file (not itself a link). No sudo, no shell: the plugin
// step spawns argv arrays with the agent's scrubbed env.

import {
  lstatSync,
  mkdirSync,
  readlinkSync,
  realpathSync,
  type Stats,
  statSync,
  symlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { scrubAgentEnv } from '../acp/env.ts';
import { resolveClaudePath } from '../acp/probe.ts';
import type { HomeAnswer } from './signin.ts';

export type CliState = 'installed' | 'absent' | 'other-link' | 'not-a-link' | 'unavailable';
export type PluginState = { phase: 'idle' } | { phase: 'running' } | { phase: 'done'; ok: boolean };

export interface CliPaths {
  /** the directory the link goes in (default ~/.local/bin) */
  binDir: string;
  /** the bundled maude, or null when this build has none (a source run) */
  bundled: string | null;
}

export const MARKETPLACE = '1aGh/maude';
export const PLUGINS = ['design@maude', 'flow@maude'] as const;
const PLUGIN_STEP_TIMEOUT_MS = 120_000;

/**
 * The bundled maude: the `maude` beside a compiled `maude-server` (Tauri externalBin siblings in
 * Contents/MacOS). Under bun (a source run, a test) there is none.
 */
export function bundledCliPath(execPath: string = process.execPath): string | null {
  if (!path.isAbsolute(execPath) || !path.basename(execPath).startsWith('maude-server'))
    return null;
  const cli = path.join(
    path.dirname(execPath),
    process.platform === 'win32' ? 'maude.exe' : 'maude'
  );
  try {
    return lstatSync(cli).isFile() ? cli : null;
  } catch {
    return null;
  }
}

export function defaultCliPaths(): CliPaths {
  return { binDir: path.join(homedir(), '.local', 'bin'), bundled: bundledCliPath() };
}

function lstatOrNull(p: string): Stats | null {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

/** A usable install target: absolute, a regular file, not a link. */
function bundledOk(bundled: string | null): bundled is string {
  if (!bundled || !path.isAbsolute(bundled)) return false;
  const st = lstatOrNull(bundled);
  return !!st && st.isFile();
}

function isOurs(link: string, bundled: string): boolean {
  try {
    const target = readlinkSync(link);
    if (path.resolve(path.dirname(link), target) === bundled) return true;
    return realpathSync(link) === realpathSync(bundled);
  } catch {
    return false;
  }
}

function classify(link: string, bundled: string | null): CliState {
  const st = lstatOrNull(link);
  if (!st) return bundledOk(bundled) ? 'absent' : 'unavailable';
  if (!st.isSymbolicLink()) return 'not-a-link';
  if (bundledOk(bundled) && isOurs(link, bundled)) return 'installed';
  return 'other-link';
}

const MESSAGES: Record<Exclude<CliState, 'installed' | 'absent'>, string> = {
  unavailable: 'This build of Maude has no maude command to install.',
  'not-a-link':
    'Something else is already at ~/.local/bin/maude. Maude left it as it is — remove it first if you want this one.',
  'other-link':
    '~/.local/bin/maude already points to another maude. Maude left it as it is — remove it first if you want this one.',
};

export interface HomeCli {
  status(): HomeAnswer;
  install(body: unknown): Promise<HomeAnswer>;
  /** resolves when an in-flight plugin step is done (tests) */
  settle(): Promise<void>;
}

async function spawnArgv(argv: string[]): Promise<number> {
  const proc = Bun.spawn(argv, {
    env: scrubAgentEnv(),
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
    windowsHide: true,
  });
  const timer = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
  }, PLUGIN_STEP_TIMEOUT_MS);
  try {
    return await proc.exited;
  } finally {
    clearTimeout(timer);
  }
}

export function createHomeCli(
  opts: {
    paths?: () => CliPaths;
    claude?: () => string | null;
    run?: (argv: string[]) => Promise<number>;
  } = {}
): HomeCli {
  const paths = opts.paths ?? defaultCliPaths;
  const claude = opts.claude ?? resolveClaudePath;
  const run = opts.run ?? spawnArgv;
  let plugin: PluginState = { phase: 'idle' };
  let inFlight: Promise<void> = Promise.resolve();

  const linkOf = (p: CliPaths) => path.join(p.binDir, 'maude');
  const view = (state: CliState) => ({
    ok: state === 'installed' || state === 'absent',
    state,
    link: '~/.local/bin/maude',
    claude: !!claude(),
    plugin,
    ...(state in MESSAGES ? { error: MESSAGES[state as keyof typeof MESSAGES] } : {}),
  });

  function addPlugin(bin: string) {
    if (plugin.phase === 'running') return;
    plugin = { phase: 'running' };
    inFlight = (async () => {
      let ok = true;
      try {
        // marketplace add may fail when it is already there — the installs decide the outcome
        await run([bin, 'plugin', 'marketplace', 'add', MARKETPLACE]);
        for (const p of PLUGINS) if ((await run([bin, 'plugin', 'install', p])) !== 0) ok = false;
      } catch {
        ok = false;
      }
      plugin = { phase: 'done', ok };
    })();
  }

  function status(): HomeAnswer {
    const p = paths();
    return { status: 200, body: view(classify(linkOf(p), p.bundled)) };
  }

  async function install(_body: unknown): Promise<HomeAnswer> {
    const p = paths();
    const link = linkOf(p);
    if (!bundledOk(p.bundled)) return { status: 409, body: view('unavailable') };
    if (!path.isAbsolute(p.binDir)) return { status: 409, body: view('unavailable') };
    try {
      mkdirSync(p.binDir, { recursive: true, mode: 0o755 });
    } catch {
      return {
        status: 409,
        body: { ...view('unavailable'), error: 'Could not create ~/.local/bin.' },
      };
    }
    try {
      if (!statSync(p.binDir).isDirectory()) throw new Error('not a dir');
    } catch {
      return {
        status: 409,
        body: { ...view('unavailable'), error: '~/.local/bin is not a folder.' },
      };
    }
    let state: CliState;
    try {
      symlinkSync(p.bundled, link); // never follows, never replaces: EEXIST if anything is there
      state = 'installed';
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST')
        return {
          status: 409,
          body: { ...view('unavailable'), error: 'Could not create the link.' },
        };
      state = classify(link, p.bundled);
    }
    if (state !== 'installed') return { status: 409, body: view(state) };
    const bin = claude();
    if (bin) addPlugin(bin);
    return { status: 200, body: view('installed') };
  }

  return { status, install, settle: () => inFlight };
}
