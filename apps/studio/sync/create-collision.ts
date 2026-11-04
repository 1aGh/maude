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
//
// 2.0.2 — A COLLISION WITH THE SAME FILE IS NOT A COLLISION (Brno Alligators, 2026-11-03: a cloud
// cell's 2.0 conversion made a document for every `.tsx` of its checkout, the owner's Mac replayed
// its queued creates for those same files, and each was renamed — ten duplicate canvases). Before
// renaming, the project's document for the create is compared with this Mac's canvas: when it
// holds this Mac's source byte for byte (what the create carries, or the file on disk now — edited
// after the create), it IS this canvas, and the create is WITHDRAWN: nothing moves, and what queued
// behind it names the same document and goes as it is. Byte-equal source only: a create carries no
// base, so "the project's copy is newer from the same base" is not decidable here — that renames,
// as before. A `_` file is a module (decision maude/v2-p8-lead-underscore-file-is-a-module),
// imported by its name: it is never renamed — its create is withdrawn and the file stays, and the
// cold start holds a differing source as any lane conflict (both kept).

import { createHash } from 'node:crypto';
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
import { isUnderscoreModuleRel } from '../skip-dirs.ts';
import type {
  CreateConflictAnswer,
  CreateRename,
  CreateWithdrawal,
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
  /** 2.0.2 — creates withdrawn instead of renamed (the same file; a module; a canvas gone). */
  withdrawn?: CreateWithdrawal[];
  told?: boolean;
}

/** One live document of the project, as its bootstrap lists it (`lanes` carries the lane hashes). */
export interface LiveDoc {
  doc: string;
  path: string | null;
  lanes?: Record<string, { hash: string | null } | undefined>;
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

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
  liveDocs: () => Promise<LiveDoc[] | null>;
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

  /**
   * Which of a refused proposal's creates the project already has under its name: the one the
   * refusal names (a scoped session may not be told which), and (2.0.2) every other one the
   * project lists — the kernel refuses at the FIRST taken name, and answering one per round left a
   * batch of them past the round cap.
   */
  function conflicting(
    creates: Operation[],
    result: ProposalResult,
    live: LiveDoc[] | null
  ): Operation[] {
    const docs = new Set((live ?? []).map((d) => d.doc));
    const rels = new Set((live ?? []).map((d) => d.path?.toLowerCase()).filter((p) => !!p));
    return creates.filter(
      (o) =>
        (result.doc !== undefined && o.doc === result.doc) ||
        (result.path !== undefined && o.path === result.path) ||
        docs.has(o.doc as string) ||
        rels.has(String(o.path).toLowerCase())
    );
  }

  /**
   * 2.0.2 — the project's document for this create holds this Mac's source byte for byte: what the
   * create carries, or the file as it is now. Only the same document name counts (the kernel ties a
   * name to its path, so another name at this path is not this canvas).
   */
  function sameFile(o: Operation, live: LiveDoc[]): boolean {
    const d = live.find((x) => x.doc === o.doc);
    const hash = d?.lanes?.html?.hash;
    if (!d || !hash || String(d.path).toLowerCase() !== String(o.path).toLowerCase()) return false;
    const carried = (o.lanes as Record<string, unknown> | undefined)?.html;
    if (typeof carried === 'string' && carried !== '' && sha256(carried) === hash) return true;
    try {
      const disk = readFileSync(path.join(deps.paths.designRoot, o.path as string), 'utf8');
      return disk !== '' && sha256(disk) === hash;
    } catch {
      return false;
    }
  }

  async function choose(
    tx: string,
    ops: Operation[],
    result: ProposalResult
  ): Promise<Journal | null> {
    const creates = ops.filter(
      (o) => o.op === 'doc.create' && typeof o.doc === 'string' && typeof o.path === 'string'
    );
    const listed = await deps.liveDocs();
    const hit = conflicting(creates, result, listed);
    if (!hit.length) return null;
    const live = listed ?? [];
    const liveDocs = new Set(live.map((d) => d.doc));
    const liveRels = new Set(live.map((d) => d.path?.toLowerCase()).filter((p) => !!p));
    const chosen = new Set<string>();
    const proposed = new Set(creates.map((o) => String(o.path).toLowerCase()));
    const renames: JournalRename[] = [];
    const withdrawn: CreateWithdrawal[] = [];
    for (const o of hit) {
      const fromRel = o.path as string;
      const doc = o.doc as string;
      // The project already holds this very file: this Mac's canvas IS that document.
      if (sameFile(o, live)) {
        withdrawn.push({ doc, why: 'same' });
        continue;
      }
      // A canvas no longer on this Mac has nothing to keep: the refusal stands for it.
      if (!existsSync(path.join(deps.paths.designRoot, fromRel))) {
        withdrawn.push({ doc, why: 'gone' });
        continue;
      }
      // A module is imported by its name: a rename would break every canvas that imports it.
      if (isUnderscoreModuleRel(fromRel)) {
        withdrawn.push({ doc, why: 'module' });
        continue;
      }
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
    if (!renames.length && !withdrawn.length) return null;
    const j: Journal = { v: 1, tx, at: now(), renames, ...(withdrawn.length ? { withdrawn } : {}) };
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
    for (const w of j.withdrawn ?? []) {
      const rel = String(ops.find((x) => x.op === 'doc.create' && x.doc === w.doc)?.path);
      const slug = slugOf(rel);
      log.log(
        w.why === 'same'
          ? `[sync/${slug}] the project already has ${rel} as it is on this Mac — joined, not renamed.`
          : w.why === 'module'
            ? `[sync/${slug}] the project already has the module ${rel} — it keeps its name.`
            : `[sync/${slug}] the project already has ${rel}, and this Mac no longer does.`
      );
    }
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
      ...(j.withdrawn?.length ? { withdrawn: j.withdrawn } : {}),
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
