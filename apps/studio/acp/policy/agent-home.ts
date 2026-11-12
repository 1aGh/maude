// B8 — a Maude-owned config home for an ACP agent (Gemini CLI, GitHub Copilot CLI), the same shape
// as F6b's Codex home (codex-home.ts): the chat's agent never reads the person's own config folder,
// where their MCP servers, hooks, extensions, plugins and allow-lists live and start outside every
// Maude gate. Contract: .ai/plans/notes/universal-acp-contract.md § "B8 — Gemini and Copilot".
//
//   ~/.config/maude/agents/<name>/                    profile `default`
//   ~/.config/maude/profiles/<id>/agents/<name>/      any other profile
//
// At every spawn (idempotent, safe while other chats use the folder):
//   • the folder (and every missing parent) is made owner-only; a symlink, a non-folder or a folder
//     another user owns throws: the chat does not start;
//   • `links`: each name becomes a SYMLINK to the person's own file (their sign-in), replaced only
//     when it points elsewhere; a missing target leaves it dangling until they sign in;
//   • `files`: Maude's own config, rewritten by rename;
//   • `foreign`: config surfaces the agent reads from its home but Maude never writes, removed.
//
// Credentials: the folder sits under `~/.config/maude`, which `credentialPathsFor` denies to every
// agent's tool calls; the agent reads it in its own process.

import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

import { resolveProfile } from '../../shell/profile.ts';

export type HostEnv = Readonly<Record<string, string | undefined>>;

export const homeOf = (env: HostEnv) => (env.HOME && isAbsolute(env.HOME) ? env.HOME : homedir());

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
/** A relative path inside the home: no `..`, no absolute, no empty segment. */
const REL_RE = /^(?!.*(^|\/)\.\.?(\/|$))[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

/** The Maude-owned home `<name>` for the profile this process runs as. */
export function maudeAgentHomePath(name: string, env: HostEnv = process.env): string {
  if (!NAME_RE.test(name)) throw new Error(`Maude's agent home: bad name ${JSON.stringify(name)}`);
  const { id } = resolveProfile(env as Record<string, string | undefined>, () => {});
  const maude = join(homeOf(env), '.config', 'maude');
  return id === 'default'
    ? join(maude, 'agents', name)
    : join(maude, 'profiles', id, 'agents', name);
}

export interface AgentHomeSpec {
  /** Folder name under `agents/` (`gemini-home`, `copilot-home`). */
  name: string;
  /** Relative path in the home → absolute path of the person's own file it links to. */
  links?: Readonly<Record<string, string>>;
  /** Relative path in the home → content Maude writes (0600). */
  files?: Readonly<Record<string, string>>;
  /** Relative paths removed at every spawn. */
  foreign?: readonly string[];
}

function assertOwnedDir(p: string, what: string) {
  const st = lstatSync(p);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error(`Maude's agent home: ${what} is not a plain folder (${p})`);
  }
  const uid = process.getuid?.();
  if (uid !== undefined && st.uid !== uid) {
    throw new Error(`Maude's agent home: ${what} is not owned by this user (${p})`);
  }
}

/** mkdir -p, creating every missing level owner-only. */
function mkdirsPrivate(p: string) {
  try {
    lstatSync(p);
    return;
  } catch {
    /* missing */
  }
  mkdirsPrivate(dirname(p));
  try {
    mkdirSync(p, { mode: 0o700 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
}

function relIn(home: string, rel: string): string {
  if (!REL_RE.test(rel)) throw new Error(`Maude's agent home: bad entry ${JSON.stringify(rel)}`);
  const abs = join(home, rel);
  // Every parent level inside the home must itself be a plain folder we own.
  const parent = dirname(abs);
  if (parent !== home) {
    mkdirsPrivate(parent);
    let p = parent;
    while (p !== home && p.startsWith(home + sep)) {
      assertOwnedDir(p, `a folder in it`);
      p = dirname(p);
    }
  }
  return abs;
}

/** Make (or repair) a Maude-owned agent home and return its path. */
export function ensureMaudeAgentHome(spec: AgentHomeSpec, env: HostEnv = process.env): string {
  const home = maudeAgentHomePath(spec.name, env);
  mkdirsPrivate(home);
  assertOwnedDir(home, 'the folder');
  chmodSync(home, 0o700);

  for (const rel of spec.foreign ?? []) {
    rmSync(relIn(home, rel), { recursive: true, force: true });
  }

  for (const [rel, target] of Object.entries(spec.links ?? {})) {
    if (!isAbsolute(target))
      throw new Error(`Maude's agent home: link target not absolute (${target})`);
    const link = relIn(home, rel);
    if (resolve(target) === link || resolve(target).startsWith(home + sep)) {
      throw new Error(`Maude's agent home: ${rel} would link into Maude's own folder`);
    }
    let current: string | null = null;
    try {
      const st = lstatSync(link);
      if (st.isDirectory()) throw new Error(`Maude's agent home: ${rel} is a folder (${link})`);
      current = st.isSymbolicLink() ? readlinkSync(link) : '';
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    if (current !== target) {
      if (current !== null) unlinkSync(link);
      symlinkSync(target, link);
    }
  }

  for (const [rel, content] of Object.entries(spec.files ?? {})) {
    const f = relIn(home, rel);
    try {
      if (lstatSync(f).isDirectory())
        throw new Error(`Maude's agent home: ${rel} is a folder (${f})`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const tmp = join(dirname(f), `.${process.pid}.${Date.now()}.tmp`);
    writeFileSync(tmp, content, { mode: 0o600 });
    renameSync(tmp, f);
  }
  return home;
}

/**
 * The session folder, then each parent up to and including the nearest one holding `.git` (the
 * repository an agent resolves its "project" config from). With no `.git` above, the folder alone.
 */
export function upToGitRoot(projectRoot: string): string[] {
  const chain: string[] = [];
  let p = resolve(projectRoot);
  for (;;) {
    chain.push(p);
    try {
      lstatSync(join(p, '.git'));
      return chain;
    } catch {
      /* not the root */
    }
    const up = dirname(p);
    if (up === p) return [resolve(projectRoot)];
    p = up;
  }
}

/**
 * Throws when any of `entries` exists under `projectRoot` (lstat: a dangling link counts). The
 * served repo is untrusted (DDR-054): config the agent would load from it starts code outside the
 * gates, so Maude does not start the agent while it is there.
 */
export function refuseProjectEntries(
  projectRoot: string,
  entries: readonly string[],
  label: string
): void {
  for (const rel of entries) {
    const p = join(resolve(projectRoot), rel);
    try {
      lstatSync(p);
    } catch (e) {
      if (
        (e as NodeJS.ErrnoException).code === 'ENOENT' ||
        (e as NodeJS.ErrnoException).code === 'ENOTDIR'
      )
        continue;
      throw e;
    }
    throw new Error(
      `This project has ${label} configuration (${p}). ${label} would load it outside the limits Maude sets, so Maude does not start ${label} while it is there.`
    );
  }
}
