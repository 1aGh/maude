// AI chat folder grants — S5.10 (S5-slices row S5.10; 03 AI Chat `ai-attach-menu`, the Consent card).
//
// WHAT A GRANT IS
// ---------------
// "Let AI read “<folder>”?" — asked once per folder (its REAL path), per Mac, recorded in this
// machine's per-project state OUTSIDE the project: `<index dir>/projects/<pid>/ai-grants.json`
// (`grantsFileFor`, the frame key's place — decision v2-gate-b-c4e-frame-key-outside-design-root).
// V2-8.9 B1 (decision maude/v2-p8-grants-outside-design-root): the old home,
// `<designRoot>/_state/ai-grants.json`, sat where the agent auto-writes, so a chat could grant itself
// any folder. A legacy file is migrated once (its folders re-judged by `resolveFolder`) and deleted;
// after that one is only ever deleted, never read. Every use re-judges a stored root too, so even a
// forged store cannot reach a folder the picker would refuse. A grant is consent; it is not access
// on its own:
//   • a chat reads a granted folder only while that folder is ATTACHED to that chat
//     (`chats[<chatId>]`) — removing the chip detaches it, Advanced's Reset revokes it everywhere;
//   • a granted folder is READ-ONLY for every chat: `readOnlyRoots()` feeds the ACP write gate
//     (`acp/write-scope.ts` reason `read-only-grant`), so a write that lands inside one is never
//     auto-approved, even inside the project. The grant never adds a write path;
//   • every use re-resolves the stored path: a folder that is now a symlink, or moved, or deleted,
//     no longer matches its realpath and drops out (`moved`) — a grant never follows a swap.
//
// IT IS THE READ BOUNDARY (M2, decision maude/v2-michal-m2-read-boundary): outside the project (and
// the bundled plugins, Maude's own package and the temp folders), the agent's Read / Glob / Grep are
// approved only inside a folder attached to its chat (`chatReadRootsFor`, read live by the ACP read
// gate, acp/may-scope.ts `readVerdict`); any other read reaches Claude Code's permission card. It is
// not a sandbox under bypassPermissions or the person's own `Read` allow rule in ~/.claude.
//
// Paths come from the desktop shell's native folder picker on the MAIN origin (the routes are
// main-origin only, `routes/chat-attach.ts`); the canvas origin can neither choose nor see one.

import {
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isInsideRoot, resolveRealPath } from '../acp/write-scope.ts';
import { pidOf, projectDir } from '../index/snapshot.ts';

/** The limits the panel states and the routes enforce. */
export const ATTACH_FOLDER_LIMITS = {
  /** A folder is counted up to this many files ("5000+ files"). */
  countCap: 5000,
  /** …and this deep. Deeper files are not counted (and not listed by Maude). */
  depthCap: 8,
  /** One listing returns at most this many entries. */
  listMax: 500,
  /** Folders a Mac may have granted for one project. */
  grantsMax: 200,
  /** A path longer than this is not a path anyone picked. */
  pathMax: 4096,
} as const;

export type FolderRefusal =
  | 'bad-path'
  | 'not-found'
  | 'not-a-folder'
  | 'too-broad'
  | 'sensitive'
  | 'is-project'
  | 'moved'
  | 'not-granted'
  | 'not-attached'
  | 'too-many';

/** CONTRACT §4 voice: what happened, then what to do. */
export const FOLDER_REFUSAL_WORDS: Record<FolderRefusal, string> = {
  'bad-path': 'That isn’t a folder path. Choose a folder… again.',
  'not-found': 'That folder isn’t there any more. Choose a folder… again.',
  'not-a-folder': 'That’s a file, not a folder. Attach it with Attach files… instead.',
  'too-broad': 'That folder holds your whole Mac or home folder. Choose a smaller folder.',
  sensitive: 'That folder holds keys or settings AI shouldn’t read. Choose another folder.',
  'is-project':
    'That folder is this project, and AI already works here. Choose a folder outside it.',
  moved: 'That folder moved or changed since you allowed it. Choose it again to ask once more.',
  'not-granted': 'AI may not read that folder yet. Choose it again and pick Let AI read.',
  'not-attached': 'That folder isn’t attached to this chat.',
  'too-many': 'Too many folders are allowed. Remove some in the panel’s Advanced.',
};

export interface FolderEnv {
  projectRoot: string;
  designRoot: string;
  /** Injectable for tests; the real home otherwise. */
  home?: string;
}

export interface ResolvedFolder {
  ok: true;
  /** The REAL path — the identity of the grant. */
  root: string;
  name: string;
  /** Outside the project: the consent names the full path. */
  outsideProject: boolean;
}
export type FolderResult = ResolvedFolder | { ok: false; code: FolderRefusal };

const real = (p: string): string => {
  try {
    return realpathSync.native(p);
  } catch {
    return resolve(p);
  }
};
const sameOrInside = (p: string, root: string) => p === root || isInsideRoot(p, root);

/** Home folders that hold keys, tokens or tool settings. Nested inside one, or holding one, is refused. */
const HOME_SENSITIVE = [
  '.ssh',
  '.gnupg',
  '.aws',
  '.azure',
  '.kube',
  '.docker',
  '.config',
  '.claude',
  '.codex',
  '.password-store',
  '.local/share/keyrings',
  'Library',
];
/** Under ~/Library, the two places people keep real files (iCloud Drive, Dropbox / Google Drive). */
const LIBRARY_FILE_HOMES = ['Library/Mobile Documents', 'Library/CloudStorage'];
/** System folders. Refused when the pick is one of them, inside one, or holds one. */
const SYSTEM_SENSITIVE = ['/etc', '/private/etc', '/System', '/usr', '/bin', '/sbin', '/dev'];

/**
 * Turn what the folder picker returned into a grantable folder, or a named refusal. Pure over the
 * filesystem (no write). Symlinks resolve FIRST, so every rule is judged on the real folder: a link
 * to `~/.ssh` is `~/.ssh`.
 */
export function resolveFolder(input: unknown, env: FolderEnv): FolderResult {
  if (typeof input !== 'string' || !input || input.length > ATTACH_FOLDER_LIMITS.pathMax)
    return { ok: false, code: 'bad-path' };
  if (input.includes('\0') || !isAbsolute(input)) return { ok: false, code: 'bad-path' };
  let root: string;
  try {
    root = realpathSync.native(input);
  } catch {
    return { ok: false, code: 'not-found' };
  }
  let isDir = false;
  try {
    isDir = statSync(root).isDirectory();
  } catch {
    return { ok: false, code: 'not-found' };
  }
  if (!isDir) return { ok: false, code: 'not-a-folder' };

  const home = real(env.home ?? homedir());
  if (root === sep || root === home || isInsideRoot(home, root))
    return { ok: false, code: 'too-broad' };

  const inFileHome = LIBRARY_FILE_HOMES.some((h) => isInsideRoot(root, real(join(home, h))));
  for (const rel of HOME_SENSITIVE) {
    if (rel === 'Library' && inFileHome) continue;
    const s = real(join(home, rel));
    if (sameOrInside(root, s) || isInsideRoot(s, root)) return { ok: false, code: 'sensitive' };
  }
  for (const abs of SYSTEM_SENSITIVE) {
    const s = real(abs);
    if (sameOrInside(root, s) || isInsideRoot(s, root)) return { ok: false, code: 'sensitive' };
  }

  const project = real(env.projectRoot);
  const design = real(env.designRoot);
  // The project itself, a folder holding it, the design root or anything inside it: AI already
  // works there — and a read-only grant over it would quietly turn every canvas edit into a prompt.
  if (sameOrInside(project, root) || sameOrInside(root, design) || isInsideRoot(design, root))
    return { ok: false, code: 'is-project' };

  return { ok: true, root, name: basename(root), outsideProject: !isInsideRoot(root, project) };
}

/** Is the stored grant root still exactly the folder it was? (No swap to a symlink, no move.) */
export function stillSame(root: string): boolean {
  try {
    return realpathSync.native(root) === root && statSync(root).isDirectory();
  } catch {
    return false;
  }
}

/** Visible files under a folder, counted without following symlinked folders. */
export function countFiles(root: string): { count: number; capped: boolean } {
  const { countCap, depthCap } = ATTACH_FOLDER_LIMITS;
  let count = 0;
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop() as { dir: string; depth: number };
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        if (depth + 1 < depthCap) stack.push({ dir: abs, depth: depth + 1 });
      } else if (e.isFile()) {
        count++;
      } else if (e.isSymbolicLink()) {
        // A link counts only when it is a file that really lives inside the folder.
        const t = real(abs);
        try {
          if (isInsideRoot(t, root) && statSync(t).isFile()) count++;
        } catch {}
      }
      if (count >= countCap) return { count, capped: true };
    }
  }
  return { count, capped: false };
}

export interface FolderEntry {
  name: string;
  kind: 'file' | 'folder';
  size?: number;
}

/**
 * Read-only, one level. `sub` is relative to the granted root; it is resolved (symlinks included)
 * and must land on the root or inside it. Links that point outside are left out and counted.
 */
export function listFolder(
  root: string,
  sub: unknown
):
  | { ok: true; path: string; entries: FolderEntry[]; truncated: boolean; skipped: number }
  | { ok: false; code: FolderRefusal } {
  if (!stillSame(root)) return { ok: false, code: 'moved' };
  let target = root;
  if (sub !== undefined && sub !== null && sub !== '') {
    if (typeof sub !== 'string' || sub.includes('\0') || isAbsolute(sub) || sub.length > 1024)
      return { ok: false, code: 'bad-path' };
    try {
      target = realpathSync.native(join(root, sub));
    } catch {
      return { ok: false, code: 'not-found' };
    }
    if (!sameOrInside(target, root)) return { ok: false, code: 'bad-path' };
  }
  let entries: Dirent[];
  try {
    if (!statSync(target).isDirectory()) return { ok: false, code: 'not-a-folder' };
    entries = readdirSync(target, { withFileTypes: true });
  } catch {
    return { ok: false, code: 'not-found' };
  }
  const out: FolderEntry[] = [];
  let skipped = 0;
  let truncated = false;
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.')) continue;
    if (out.length >= ATTACH_FOLDER_LIMITS.listMax) {
      truncated = true;
      break;
    }
    const abs = join(target, e.name);
    const t = e.isSymbolicLink() ? real(abs) : abs;
    if (e.isSymbolicLink() && !isInsideRoot(t, root)) {
      skipped++;
      continue;
    }
    try {
      const st = statSync(t);
      if (st.isDirectory()) out.push({ name: e.name, kind: 'folder' });
      else if (st.isFile()) out.push({ name: e.name, kind: 'file', size: st.size });
    } catch {
      skipped++;
    }
  }
  return { ok: true, path: relative(root, target), entries: out, truncated, skipped };
}

// ── the grant store ───────────────────────────────────────────────────────────────────────────

export interface GrantedFolder {
  root: string;
  name: string;
  grantedAt: number;
  outsideProject: boolean;
}
interface GrantsFile {
  v: 1;
  folders: GrantedFolder[];
  /** chatId → the granted roots attached to it. */
  chats: Record<string, string[]>;
}

/** Where grants lived before V2-8.9 B1 — inside the design root. Migrated once, then only deleted. */
export const LEGACY_GRANTS_REL = join('_state', 'ai-grants.json');

/** This machine's grants file for one project: outside the project tree and its design root. */
export function grantsFileFor(projectRoot: string): string {
  return join(projectDir(pidOf(projectRoot)), 'ai-grants.json');
}

/** Where a project's grants live and what a stored root is re-judged against. */
export interface GrantPlace {
  projectRoot: string;
  designRoot: string;
  /** Injectable for tests; the real home otherwise. */
  home?: string;
  /** Tests only — the grants file (default `grantsFileFor(projectRoot)`). */
  file?: string;
}
const CHAT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isChatId(v: unknown): v is string {
  return typeof v === 'string' && CHAT_ID_RE.test(v);
}

function emptyGrants(): GrantsFile {
  return { v: 1, folders: [], chats: {} };
}

function readGrants(file: string): GrantsFile {
  if (!existsSync(file)) return emptyGrants();
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (!raw || raw.v !== 1 || !Array.isArray(raw.folders)) return emptyGrants();
    const folders = (raw.folders as unknown[]).filter(
      (f): f is GrantedFolder =>
        !!f &&
        typeof (f as GrantedFolder).root === 'string' &&
        isAbsolute((f as GrantedFolder).root) &&
        typeof (f as GrantedFolder).name === 'string'
    );
    const chats: Record<string, string[]> = {};
    if (raw.chats && typeof raw.chats === 'object') {
      for (const [id, roots] of Object.entries(raw.chats as Record<string, unknown>)) {
        if (isChatId(id) && Array.isArray(roots))
          chats[id] = roots.filter((r): r is string => typeof r === 'string');
      }
    }
    return { v: 1, folders, chats };
  } catch {
    // A torn or hand-broken file grants nothing (fail closed) — it is rewritten on the next grant.
    return emptyGrants();
  }
}

export interface GrantStore {
  list(): GrantedFolder[];
  isGranted(root: string): boolean;
  /** Record consent (once per real path) and attach the folder to `chatId`. */
  grant(folder: ResolvedFolder, chatId: string): { ok: true } | { ok: false; code: FolderRefusal };
  /** Attach an already-granted folder to a chat (asks once — no second consent). */
  attach(root: string, chatId: string): { ok: true } | { ok: false; code: FolderRefusal };
  /** The chip's ×: the chat stops carrying it; the consent stays. */
  detach(root: string, chatId: string): void;
  /** Advanced's Reset for one folder: consent gone, detached from every chat. */
  revoke(root: string): boolean;
  /** The folders this chat may read right now: granted, attached, and still the same folder. */
  chatRoots(chatId: string): string[];
  /** Every granted folder — read-only for every chat (the ACP write gate's list). */
  readOnlyRoots(): string[];
}

export function createGrantStore(place: GrantPlace, now: () => number = Date.now): GrantStore {
  const file = place.file ?? grantsFileFor(place.projectRoot);
  // Fail closed on a misplaced store (MAUDE_INDEX_DIR pointed into the project): the agent writes
  // there, so a file in it is never trusted and nothing is written to it — no folder is allowed.
  const f = resolveRealPath(file, sep);
  const misplaced = [place.designRoot, place.projectRoot].some((r) => {
    const root = resolveRealPath(r, sep);
    return f === root || isInsideRoot(f, root);
  });
  migrateLegacyGrants(place, file, misplaced);
  const read = (): GrantsFile => (misplaced ? emptyGrants() : readGrants(file));
  const write = (g: GrantsFile) => {
    if (misplaced) throw new Error('grants store is inside the project');
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(g, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
  };
  /** Still a folder the picker would allow, and still the same folder (no swap, no move). */
  const stillAllowed = (root: string) => {
    const r = resolveFolder(root, place);
    return r.ok && r.root === root;
  };
  const granted = (g: GrantsFile, root: string) => g.folders.some((f) => f.root === root);
  const addChat = (g: GrantsFile, root: string, chatId: string) => {
    const list = g.chats[chatId] ?? [];
    if (!list.includes(root)) list.push(root);
    g.chats[chatId] = list;
  };

  return {
    list: () => read().folders,
    isGranted: (root) => granted(read(), root),
    grant(folder, chatId) {
      if (!isChatId(chatId)) return { ok: false, code: 'bad-path' };
      const g = read();
      if (!granted(g, folder.root)) {
        if (g.folders.length >= ATTACH_FOLDER_LIMITS.grantsMax)
          return { ok: false, code: 'too-many' };
        g.folders.push({
          root: folder.root,
          name: folder.name,
          grantedAt: now(),
          outsideProject: folder.outsideProject,
        });
      }
      addChat(g, folder.root, chatId);
      write(g);
      return { ok: true };
    },
    attach(root, chatId) {
      if (!isChatId(chatId)) return { ok: false, code: 'bad-path' };
      const g = read();
      if (!granted(g, root)) return { ok: false, code: 'not-granted' };
      if (!stillSame(root)) return { ok: false, code: 'moved' };
      addChat(g, root, chatId);
      write(g);
      return { ok: true };
    },
    detach(root, chatId) {
      const g = read();
      const list = g.chats[chatId];
      if (!list?.includes(root)) return;
      const next = list.filter((r) => r !== root);
      if (next.length) g.chats[chatId] = next;
      else delete g.chats[chatId];
      write(g);
    },
    revoke(root) {
      const g = read();
      if (!granted(g, root)) return false;
      g.folders = g.folders.filter((f) => f.root !== root);
      for (const id of Object.keys(g.chats)) {
        const next = (g.chats[id] ?? []).filter((r) => r !== root);
        if (next.length) g.chats[id] = next;
        else delete g.chats[id];
      }
      write(g);
      return true;
    },
    chatRoots(chatId) {
      if (!isChatId(chatId)) return [];
      const g = read();
      return (g.chats[chatId] ?? []).filter((r) => granted(g, r) && stillAllowed(r));
    },
    // Deliberately NOT filtered by `stillSame`: a folder that moved is still one the person said
    // AI may only read. Over-including here only ever adds a prompt.
    readOnlyRoots: () => read().folders.map((f) => f.root),
  };
}

/**
 * V2-8.9 B1 — the one-time move of `<designRoot>/_state/ai-grants.json` to the app-owned store.
 * Only while no app-owned store exists yet does the legacy file's content count (each folder
 * re-judged by `resolveFolder`, so a forged `/` or `~/.ssh` is dropped); the store is created then,
 * empty if need be, so a legacy file planted afterwards is deleted unread. Never throws.
 */
function migrateLegacyGrants(place: GrantPlace, file: string, misplaced: boolean): void {
  const legacy = join(place.designRoot, LEGACY_GRANTS_REL);
  try {
    if (misplaced) return;
    if (existsSync(file)) {
      if (existsSync(legacy)) rmSync(legacy, { force: true });
      return;
    }
    const old = readGrants(legacy);
    const folders = old.folders.filter((f) => {
      const r = resolveFolder(f.root, place);
      return r.ok && r.root === f.root;
    });
    const kept = new Set(folders.map((f) => f.root));
    const chats: Record<string, string[]> = {};
    for (const [id, roots] of Object.entries(old.chats)) {
      const next = roots.filter((r) => kept.has(r));
      if (next.length) chats[id] = next;
    }
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ v: 1, folders, chats }, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
    rmSync(legacy, { force: true });
  } catch {
    /* an unwritable index dir: the store stays absent and the legacy file is never read again
       except by this same migration, which only ever drops refused folders */
  }
}

/**
 * For the ACP read gate (M2, decision maude/v2-michal-m2-read-boundary): the folders one chat may read
 * now — allowed, attached to it, still the same folder. Never throws (a broken file allows nothing).
 */
export function chatReadRootsFor(place: GrantPlace, chatId: string): string[] {
  try {
    return createGrantStore(place).chatRoots(chatId);
  } catch {
    return [];
  }
}

/** For the ACP write gate: cheap, and never throws (a broken file grants nothing). */
export function readOnlyRootsFor(place: GrantPlace): string[] {
  try {
    return createGrantStore(place).readOnlyRoots();
  } catch {
    return [];
  }
}
