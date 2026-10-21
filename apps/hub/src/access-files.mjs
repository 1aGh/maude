// The file plane's canvas scope — V2-1.16 rows L1, L3, L5 (S9.4).
//
// A canvas-only session (a credential whose claim has no project role, only
// canvas grants — V2-1.7 §5.3) may reach the file plane, the control channel
// and the asset routes for exactly ITS CANVASES' CLOSURE: the canvas's own
// sidecars, its relative import graph, its design system and the assets it
// references statically (`apps/studio/access/closure.ts`, computed HERE, on the
// server, from the project's own files). Everything else answers exactly as a
// missing path (U1) — omitted from every listing, 404 where the route answers a
// missing file with 404, 403 `not-in-scope` on every write.
//
// ONE ANSWER PER CREDENTIAL. Every file-plane door asks `fileAccessFor(match)`
// and then only `sees` / `writes` / `exports`; none of them computes a closure
// or reads a claim itself.
//
// PROJECT SESSIONS ARE UNCHANGED (U7). For a credential with a project role,
// `sees(rel)` is exactly today's `matchesScope(match.scope, rel)` and the
// doors keep their own read-only / code-module gates.
//
// THE CLAIM DECIDES FOR A CANVAS-ONLY SESSION. The stored token fields the mint
// door writes for one (`peerSessionFields`, S9.2) are fail-closed projections
// for doors that do NOT read the claim: `read_only` is set, and `scope` is
// DDR-053's label-bound default, which no project path matches. A door that
// asks this module reads the claim instead, so for a canvas-only session
//   - the label-bound `scope` is replaced by the closure (`sees`), and
//   - the `read_only` bit is replaced by `writes()` (G2: create-only new assets,
//     a photo sidecar whose every referrer the session may edit).
// The stored fields stay as they are, so every door this slice does not touch
// (documents, history, the accepted lane) still refuses the session.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { closureFor, createClosureCache } from '../../studio/access/closure.ts';
import {
  mayCreatePerUse,
  resolveAccess,
  seesDoc,
  sees as seesRel,
  writes as writesRel,
} from '../../studio/access/scope.ts';
import { docSlugOf } from './access-docs.mjs';
import { claimForMatch, NOT_IN_SCOPE_REFUSAL } from './access-gate.mjs';
import { cachedJournal } from './journal.mjs';
import { matchesScope } from './tokens.mjs';

export { NOT_IN_SCOPE_REFUSAL };

/** Walk ceilings — the manifest's (`file-manifest.mjs`): files, depth. */
const MAX_WALK_FILES = 20_000;
const MAX_WALK_DEPTH = 8;
/** A text larger than this is not scanned for references (a canvas is KBs). */
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

/** One closure cache per design root, keyed inside by (signature, grants). */
const caches = new Map();
const cacheFor = (designRoot) => {
  let c = caches.get(designRoot);
  if (!c) {
    c = createClosureCache(64);
    caches.set(designRoot, c);
  }
  return c;
};

/** Tests: forget every computed closure. */
export function resetFileAccessCaches() {
  caches.clear();
}

/**
 * Every file under the checkout's design root (canvases and their sidecars
 * included — the closure walks them), as designRoot-relative POSIX paths. Same
 * pruning as the manifest walk: `_`/`.`-prefixed directories and node_modules
 * are runtime state or tooling, never part of a canvas; symlinks are never
 * followed (`isFile()` / `isDirectory()` on the dirent), so every path read
 * below is inside the root by construction.
 */
function walkDesignRoot(designRoot) {
  const found = new Map();
  const walk = (dir, rel, depth) => {
    if (depth > MAX_WALK_DEPTH || found.size >= MAX_WALK_FILES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith('.') || name === 'node_modules') continue;
      const childRel = rel ? `${rel}/${name}` : name;
      const childAbs = join(dir, name);
      if (entry.isDirectory()) {
        // Runtime state is FIRST-segment `_*` only (DDR-115, the studio's diskProjectReader and
        // static lane — gate-b-c4b): a nested `_` dir is versioned content (a design system's
        // `preview/_parts/`), so a canvas-only member's closure must still see it.
        if (!name.startsWith('_') || rel) walk(childAbs, childRel, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (found.size >= MAX_WALK_FILES) return;
      let st;
      try {
        st = statSync(childAbs);
      } catch {
        continue;
      }
      found.set(childRel, { abs: childAbs, size: st.size, mtimeMs: st.mtimeMs });
    }
  };
  if (designRoot) walk(designRoot, '', 1);
  return found;
}

/**
 * The project as the closure reads it: the checkout walk plus every path the
 * journal names (a cell's disk is only a cache for inert media; a tombstoned
 * path a canvas still references stays in the closure, so its deletion row is
 * visible to the session that had it). `head()` is the cache key: the journal
 * position AND a signature of the walk, because a canvas body (plane A) can
 * change what it references without the journal moving.
 */
export function projectReader({ designRoot, journal }) {
  const disk = walkDesignRoot(designRoot);
  const journalPaths = [];
  try {
    for (const row of journal?.compaction?.() ?? []) journalPaths.push(row.path);
  } catch {
    /* a journal that cannot answer adds nothing */
  }
  const sig = createHash('sha256');
  sig.update(`${journal?.epoch?.() ?? ''}\u0000${journal?.head?.() ?? 0}\u0000`);
  for (const [rel, f] of [...disk.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    sig.update(`${rel}\u0000${f.size}\u0000${f.mtimeMs}\u0001`);
  }
  const head = sig.digest('hex');
  const all = new Set([...disk.keys(), ...journalPaths]);
  return {
    list: () => all,
    text(rel) {
      const f = disk.get(rel);
      if (!f || f.size > MAX_SCAN_BYTES) return null;
      try {
        return readFileSync(f.abs, 'utf8');
      } catch {
        return null;
      }
    },
    head: () => head,
  };
}

/**
 * The file-plane answer for one ACCESS CLAIM (V2-1.7 §5.3).
 *
 * @param {object | null} claim the claim (`claimForMatch`); null holds nothing
 * @param {{ scope?: string, designRoot?: string | null, journal?: object | null, dataDir?: string | null }} deps
 *   `scope` is the token's DDR-053 scope (project sessions only).
 */
export function fileAccessForClaim(
  claim,
  { scope = '*', designRoot = null, journal = null, dataDir = null } = {}
) {
  const access = resolveAccess(claim);
  const mode = access.role !== null ? 'project' : access.canvasOnly ? 'canvas' : 'none';
  const journalHandle = journal ?? (dataDir ? cachedJournal(dataDir) : null);
  let reader = null;
  const project = () => {
    if (!reader) reader = projectReader({ designRoot, journal: journalHandle });
    return reader;
  };
  const closureOf = (a) => (designRoot ? closureFor(a, project(), cacheFor(designRoot)) : null);
  let main;
  const closure = () => {
    if (mode !== 'canvas') return null;
    if (main === undefined) main = closureOf(access);
    return main;
  };
  // A download (`export`) is judged over the grants that hold it — a peer token
  // never carries an observer grant (the mint door sends it to the browser
  // door), so this is the main closure in practice; it is computed anyway.
  let exportOnly;
  const exportView = () => {
    if (exportOnly !== undefined) return exportOnly;
    const held = access.grants.filter((g) => access.can('export', g.c));
    if (held.length === access.grants.length) {
      exportOnly = { access, closure: closure() };
    } else {
      const narrowed = resolveAccess({ v: 1, role: null, grants: held.map((g) => ({ ...g })) });
      exportOnly = { access: narrowed, closure: held.length ? closureOf(narrowed) : null };
    }
    return exportOnly;
  };

  const sees = (rel) => {
    if (typeof rel !== 'string' || rel === '') return false;
    if (mode === 'project') return matchesScope(scope, rel);
    if (mode === 'none') return false;
    return seesRel(access, closure(), rel);
  };

  return Object.freeze({
    access,
    mode,
    /** True when the claim — not the stored read_only / scope fields — decides. */
    claimDecides: mode !== 'project',
    canvasOnly: mode === 'canvas',
    closure,
    /** May this session learn that `rel` exists, list it, read it? */
    sees,
    /**
     * May this session write `rel`? Only meaningful when `claimDecides`; a
     * project session keeps its door's own gates (U7).
     */
    writes(rel, { exists, body }) {
      if (mode !== 'canvas' || typeof rel !== 'string') return false;
      return writesRel(access, closure(), rel, { exists: !!exists, body });
    },
    /**
     * S8.15 — before a per-use photo edit's body has landed: may this session create `rel` at
     * all? The door asks `writes()` again with the landed bytes (their hash must be the name).
     */
    mayCreatePerUse(rel) {
      if (mode !== 'canvas' || typeof rel !== 'string') return false;
      return mayCreatePerUse(access, closure(), rel);
    },
    /** May this session download `rel`'s bytes? (A19 per canvas; project: the gate's.) */
    exports(rel) {
      if (mode === 'project') return true;
      if (mode === 'none') return false;
      const v = exportView();
      return v.access.grants.length > 0 && seesRel(v.access, v.closure, rel);
    },
    /** May this session learn about the Y.Doc `documentName`? */
    seesDocument(documentName) {
      if (mode === 'project') return matchesScope(scope, String(documentName ?? ''));
      if (mode === 'none') return false;
      // The document door's own slug (`ui/Plakát.tsx` → `ui-plak-t`), so the
      // two planes name a canvas's document the same way.
      return seesDoc(access, String(documentName ?? ''), docSlugOf);
    },
    /**
     * U5 — the journal head this session may see: the last seq of a path it
     * sees. A project session sees the real head.
     */
    visibleHead() {
      if (!journalHandle) return 0;
      if (mode === 'project') return journalHandle.head();
      let head = 0;
      for (const row of journalHandle.compaction()) {
        if (row.seq > head && sees(row.path)) head = row.seq;
      }
      return head;
    },
  });
}

/**
 * The file-plane answer for one verified peer token (`tokens.mjs verifyToken`).
 * Null when there is no match.
 */
export function fileAccessFor(match, deps = {}) {
  if (!match) return null;
  return fileAccessForClaim(claimForMatch(match), { ...deps, scope: match.scope ?? '*' });
}

/** The closure of a verified peer token's grants, or null (project / no grants). */
export function closureForMatch(match, deps = {}) {
  return fileAccessFor(match, deps)?.closure() ?? null;
}

/**
 * L1 — the journal page a canvas-only session reads.
 *
 * Its rows are only the paths it sees, and its `head` is the last VISIBLE seq,
 * so neither the page nor the cursor reveals a write elsewhere (U5). The log is
 * scanned past invisible rows — a page full of another canvas's writes would
 * otherwise come back empty and `truncated`, and a peer that advances to the
 * last row it received would never move. `epoch`, `reanchor` and `truncated`
 * keep their meaning (V2-1.16 L1).
 *
 * @returns {{ head: number, reanchor?: string, entries?: object[], truncated?: boolean }}
 */
export function visibleJournalPage(files, journal, { since, pageMax, scanPages = 512 }) {
  const head = files.visibleHead();
  if (since < 0 || since > head) return { head, reanchor: 'cursor is not in this log' };
  const entries = [];
  let cursor = since;
  let truncated = false;
  for (let n = 0; n < scanPages; n += 1) {
    const page = journal.entriesSince(cursor);
    for (const e of page.entries) {
      if (e.seq > head) break;
      if (!files.sees(e.path)) continue;
      if (entries.length >= pageMax) {
        truncated = true;
        break;
      }
      entries.push(e);
    }
    if (truncated || !page.truncated || page.entries.length === 0) break;
    const last = page.entries.at(-1).seq;
    if (last >= head) break;
    cursor = last;
    // Budget spent before the end: say so. Never let a peer jump to `head`
    // past rows nobody scanned.
    if (n === scanPages - 1) truncated = true;
  }
  return { head, entries, truncated };
}

// ---------------------------------------------------------------------------
// L3 — the control channel's pokes, per connection.

/** The claim a ctl connection was admitted with (`onAuthenticate` puts it on context.user). */
const claimOfConnection = (connection) => connection?.context?.user?.access ?? null;

/**
 * Is this connection judged by its claim (canvas-only, or a claim holding
 * nothing)? A connection without a claim on its context is a project session.
 */
export function connectionClaimDecides(connection) {
  const claim = claimOfConnection(connection);
  if (!claim) return false;
  return resolveAccess(claim).role === null;
}

/**
 * What the poke emitter asks before telling a claim-judged connection anything.
 * Absent (not wired) ⇒ such a connection hears NOTHING: a timing signal the
 * hub cannot scope is not sent.
 *
 * @param {{ designRoot: string | null, journal: object | null }} deps
 */
export function createPokeVisibility({ designRoot, journal }) {
  return {
    /** The head to send for journal rows in (fromHead, toHead], or null when none is visible. */
    filesHeadFor(connection, fromHead, toHead) {
      if (!journal) return null;
      const files = fileAccessForClaim(claimOfConnection(connection), { designRoot, journal });
      if (!files.canvasOnly) return null;
      let cursor = fromHead;
      let seen = false;
      for (let n = 0; n < 64 && cursor < toHead; n += 1) {
        const page = journal.entriesSince(cursor);
        if (!page.entries.length) break;
        for (const e of page.entries) {
          if (e.seq > toHead) break;
          if (files.sees(e.path)) seen = true;
        }
        if (seen || !page.truncated) break;
        cursor = page.entries.at(-1).seq;
      }
      return seen ? files.visibleHead() : null;
    },
    /** Whether any of these document events is visible to the connection. */
    documentsVisible(connection, events) {
      const files = fileAccessForClaim(claimOfConnection(connection), { designRoot, journal });
      if (!files.canvasOnly) return false;
      return events.some(
        (ev) =>
          (typeof ev?.documentName === 'string' && files.seesDocument(ev.documentName)) ||
          (typeof ev?.path === 'string' && files.sees(ev.path))
      );
    },
    /**
     * Whether a claim-judged connection may hear that a vote on `canvasPath`
     * changed (Gate 0 A18, S9.13). Votes are anchored to one canvas, so the
     * grant itself decides — no closure, no journal.
     */
    votesVisible(connection, canvasPath) {
      return grantSeesCanvas(connection, canvasPath);
    },
    /**
     * Whether a claim-judged connection may hear that an AI run on `canvasPath`
     * changed (V2-1.15 `{t:'runs'}`, V2-5 sweep-fix). A lease key names one
     * canvas, so the grant decides, as for votes.
     */
    runsVisible(connection, canvasPath) {
      return grantSeesCanvas(connection, canvasPath);
    },
  };
}

/** A canvas-only claim's grant reaches this canvas path (votes, runs). */
function grantSeesCanvas(connection, canvasPath) {
  const claim = claimOfConnection(connection);
  if (!claim || typeof canvasPath !== 'string' || canvasPath === '') return false;
  const access = resolveAccess(claim);
  return access.canvasOnly && access.can('read', canvasPath);
}
