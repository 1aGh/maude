// S6.13b — a canvas made on this Mac while it was away, whose name a peer took meanwhile, is
// RENAMED, not held as a conflict (lead decision `maude/v2-lead-offline-create-collision-renames`).
//
// The project refuses the replayed `doc.create` with `path-conflict`. Nothing of anybody's may be
// lost or written over, so this Mac's canvas moves to the next free C4 name in the same folder
// ("Untitled canvas" → "Untitled canvas 2", `nextFreeCanvasName`), its create goes again under that
// name, and what queued behind it follows (the transaction client rewrites it). The peer's canvas
// keeps its name and arrives here as any canvas made elsewhere does.
//
// Crash-safe and idempotent: the chosen names are journaled under `_state/create-renames/<tx>.json`
// (runtime state, DDR-115 `_state/`) BEFORE a file moves, and every move is "move it if it is still
// there and the place is free", so a replay of the same refusal finishes the same rename — the same
// name, once — instead of starting another. A real content conflict (the same canvas edited on two
// sides) is not this case: that is a `base-conflict` on a lane, and keeps its own path.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { canvasArtifacts, relocatedName } from '../canvas-artifacts.ts';
import { nextFreeCanvasName } from '../canvas-create.ts';
import { canvasSlugFromRel } from '../canvas-slug.ts';
import type { Paths } from '../context.ts';
import type {
  CreateConflictAnswer,
  CreateRename,
  Operation,
  ProposalResult,
} from './transaction-client.ts';

/** CONTRACT §3–§4 — said once, when this Mac's canvas takes the next free name. */
export function createRenamedText(fromName: string, toName: string): string {
  return `“${fromName}” was also made on another device — this one is now “${toName}”.`;
}

export const CREATE_RENAMES_REL = path.join('_state', 'create-renames');

interface JournalRename {
  fromDoc: string;
  fromRel: string;
  toDoc: string;
  toRel: string;
}

interface Journal {
  v: 1;
  tx: string;
  at: number;
  renames: JournalRename[];
  told?: boolean;
}

const TX_FILE = /^tx_[A-Za-z0-9]+\.json$/;
const nameOf = (rel: string) => path.posix.basename(rel).replace(/\.tsx$/i, '');

/** A C4 name's root and number: "Untitled canvas 2" → ["Untitled canvas", 2]; no suffix is 1. */
function c4Parts(name: string): [string, number] {
  const m = /^(.*\S) (\d+)$/.exec(name);
  return m ? [m[1] as string, Number(m[2])] : [name, 1];
}

/**
 * The next free C4 name for `rel` in its own folder, counting UP from its own ("Poster" →
 * "Poster 2", "Poster 2" → "Poster 3"). `isTaken` answers for a candidate design-root-relative
 * path (`ui/Untitled canvas 2.tsx`).
 */
export function freeCreateRel(rel: string, isTaken: (candidate: string) => boolean): string {
  const dir = path.posix.dirname(rel);
  const at = (n: string) => (dir === '.' ? `${n}.tsx` : `${dir}/${n}.tsx`);
  const [root, own] = c4Parts(nameOf(rel));
  return at(nextFreeCanvasName(root, (n) => c4Parts(n)[1] <= own || isTaken(at(n))));
}

/**
 * Move every artifact of the canvas at `fromRel` to `toRel` (the `.tsx` first — the tree is never
 * wrong about where the canvas lives — then its sidecars, its slug-keyed runtime state and the
 * per-machine camera). Idempotent: an artifact already moved, or never there, is skipped; nothing
 * is ever written over. The old slug's CRDT cache is dropped, as a move drops it.
 */
export function moveCanvasArtifacts(
  paths: Paths,
  fromRel: string,
  toRel: string,
  fault?: (point: string) => void
): void {
  const all = canvasArtifacts({ rel: fromRel, paths });
  const primary = all.filter((a) => a.kind === 'primary');
  for (const artifact of [...primary, ...all.filter((a) => a.kind !== 'primary')]) {
    if (!existsSync(artifact.abs)) continue;
    if (artifact.carryOnMove === false) {
      rmSync(artifact.abs, { force: true });
      continue;
    }
    const dest = relocatedName(artifact, fromRel, toRel, paths);
    if (path.resolve(dest) === path.resolve(artifact.abs) || existsSync(dest)) continue;
    mkdirSync(path.dirname(dest), { recursive: true });
    renameSync(artifact.abs, dest);
    if (artifact.kind === 'primary') fault?.('moved-primary');
  }
}

export interface RenamedCanvas {
  fromDoc: string;
  toDoc: string;
  fromRel: string;
  toRel: string;
  fromSlug: string;
  toSlug: string;
  /** The source the renamed create carries. */
  html: string | null;
}

export interface CreateCollisionDeps {
  paths: Paths;
  docNameFor: (slug: string) => string;
  /** The project's live documents now (asked again), or null when it cannot tell. */
  liveDocs: () => Promise<Array<{ doc: string; path: string | null }> | null>;
  /**
   * The runtime's part, before any file moves: the old canvas lets go of its
   * file (the peer's canvas arrives there), the new one will join as its create.
   * Returns what to call with that create's final answer.
   */
  onRenaming: (r: RenamedCanvas) => (result: ProposalResult) => void;
  /** Once per rename, after the move: tell the person and point open tabs at it. */
  onRenamed: (r: RenamedCanvas, tell: boolean) => void;
  log?: Pick<Console, 'log' | 'warn'>;
  now?: () => number;
  fault?: (point: string) => void;
}

/**
 * The transaction client's `onCreateConflict`: choose (or recall) the free names, journal them,
 * move the files, and answer with the renamed documents.
 */
export function createCollisionRenamer(deps: CreateCollisionDeps) {
  const dir = path.join(deps.paths.designRoot, CREATE_RENAMES_REL);
  const log = deps.log ?? console;
  const now = deps.now ?? Date.now;
  const fileOf = (tx: string) => path.join(dir, `${tx}.json`);
  const slugOf = (rel: string) => canvasSlugFromRel(rel, deps.paths.designRel);

  const read = (tx: string): Journal | null => {
    try {
      const j = JSON.parse(readFileSync(fileOf(tx), 'utf8')) as Journal;
      return j?.v === 1 && Array.isArray(j.renames) ? j : null;
    } catch {
      return null;
    }
  };
  const write = (j: Journal): void => {
    mkdirSync(dir, { recursive: true });
    const tmp = `${fileOf(j.tx)}.tmp`;
    writeFileSync(tmp, JSON.stringify(j));
    renameSync(tmp, fileOf(j.tx));
  };

  /** Which of a refused proposal's creates the project already has under its name. */
  async function conflicting(creates: Operation[], result: ProposalResult): Promise<Operation[]> {
    const named = creates.filter(
      (o) =>
        (result.doc !== undefined && o.doc === result.doc) ||
        (result.path !== undefined && o.path === result.path)
    );
    if (named.length) return named;
    // The refusal does not say which (a scoped session may not be told): ask the project.
    const live = await deps.liveDocs();
    if (!live) return [];
    const docs = new Set(live.map((d) => d.doc));
    const rels = new Set(live.map((d) => d.path?.toLowerCase()).filter((p) => !!p));
    return creates.filter(
      (o) => docs.has(o.doc as string) || rels.has(String(o.path).toLowerCase())
    );
  }

  async function choose(
    tx: string,
    ops: Operation[],
    result: ProposalResult
  ): Promise<Journal | null> {
    const creates = ops.filter(
      (o) => o.op === 'doc.create' && typeof o.doc === 'string' && typeof o.path === 'string'
    );
    const hit = await conflicting(creates, result);
    if (!hit.length) return null;
    const live = (await deps.liveDocs()) ?? [];
    const liveDocs = new Set(live.map((d) => d.doc));
    const liveRels = new Set(live.map((d) => d.path?.toLowerCase()).filter((p) => !!p));
    const chosen = new Set<string>();
    const proposed = new Set(creates.map((o) => String(o.path).toLowerCase()));
    const renames: JournalRename[] = [];
    for (const o of hit) {
      const fromRel = o.path as string;
      // A canvas no longer on this Mac has nothing to keep: the refusal stands for it.
      if (!existsSync(path.join(deps.paths.designRoot, fromRel))) continue;
      const toRel = freeCreateRel(fromRel, (candidate) => {
        const lower = candidate.toLowerCase();
        const abs = path.join(deps.paths.designRoot, candidate);
        return (
          existsSync(abs) ||
          existsSync(abs.replace(/\.tsx$/i, '.meta.json')) ||
          liveRels.has(lower) ||
          liveDocs.has(deps.docNameFor(slugOf(candidate))) ||
          proposed.has(lower) ||
          chosen.has(slugOf(candidate))
        );
      });
      chosen.add(slugOf(toRel));
      renames.push({
        fromDoc: o.doc as string,
        fromRel,
        toDoc: deps.docNameFor(slugOf(toRel)),
        toRel,
      });
    }
    if (!renames.length) return null;
    const j: Journal = { v: 1, tx, at: now(), renames };
    write(j);
    return j;
  }

  async function onCreateConflict(
    ops: Operation[],
    result: ProposalResult,
    tx: string
  ): Promise<CreateConflictAnswer | null> {
    const j = read(tx) ?? (await choose(tx, ops, result));
    if (!j) return null;
    const htmlOf = (doc: string) => {
      const o = ops.find((x) => x.op === 'doc.create' && x.doc === doc);
      const html = (o?.lanes as Record<string, unknown> | undefined)?.html;
      return typeof html === 'string' ? html : null;
    };
    const canvases: RenamedCanvas[] = j.renames.map((r) => ({
      ...r,
      fromSlug: slugOf(r.fromRel),
      toSlug: slugOf(r.toRel),
      html: htmlOf(r.fromDoc),
    }));
    const settles = canvases.map((c) => deps.onRenaming(c));
    for (const c of canvases) {
      moveCanvasArtifacts(deps.paths, c.fromRel, c.toRel, deps.fault);
      log.log(
        `[sync/${c.fromSlug}] the project already has ${c.fromRel} — this Mac's canvas is now ${c.toRel}.`
      );
      deps.onRenamed(c, !j.told);
    }
    if (!j.told) write({ ...j, told: true });
    const renames: CreateRename[] = j.renames.map((r) => ({
      fromDoc: r.fromDoc,
      toDoc: r.toDoc,
      toPath: r.toRel,
    }));
    return {
      renames,
      settled: (r) => {
        for (const s of settles) s(r);
        rmSync(fileOf(tx), { force: true });
      },
    };
  }

  /**
   * Journals a finished rename left behind (a crash after its refused entry was gone): every
   * replay that needed one has run once the boot drain is done. Only those older than `before`.
   */
  function sweep(before: number): void {
    let names: string[] = [];
    try {
      names = readdirSync(dir).filter((n) => TX_FILE.test(n));
    } catch {
      return;
    }
    for (const n of names) {
      const tx = n.replace(/\.json$/, '');
      const j = read(tx);
      let at = j?.at ?? 0;
      if (!j) {
        try {
          at = statSync(fileOf(tx)).mtimeMs;
        } catch {
          continue;
        }
      }
      if (at < before) rmSync(fileOf(tx), { force: true });
    }
  }

  return { onCreateConflict, sweep };
}
