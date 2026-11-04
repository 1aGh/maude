// What a canvas is still waiting for — 2.0.4 task B (decision `v2-204-canvas-waiting-from-ledger`).
//
// A canvas that imports a file this Mac does not hold yet cannot load: its import walk finds nothing
// at the path, the frame is refused, and the old card said "<Canvas> can't be drawn right now" — on a
// second Mac doing a 1.5 h first sync, while the file was simply still coming (or held back by the
// code-module consent). This module answers WHY, from two things the server already has:
//
//   1. the canvas's import closure, walked on disk (the same specifier rules as the access closure,
//      `relativeImportGroups`): every relative import of the canvas and of what it imports, and
//      which of them resolve to nothing here;
//   2. the file plane's ledger (the doručenka, `sync/file-ledger.ts`), which knows per path whether
//      the hub offered it (`remoteHash`), whether it is held (`stuck` / `refused`) and why.
//
// Per missing import: `{ rel, state: 'downloading' | 'waiting' | 'refused', reason? }`. `reason` is
// one of OUR words (`WaitingReason`) — never the ledger's `reason` text, which can embed a snippet of
// a hub error body (`failureReason()`), so a hub cannot put sentences on this card. Plus how far the
// canvas got (`need: { here, total }` files) and the whole project's first sync (`progress:
// { delivered, total }`, the same fold the sync status reports — `computeSeedProgress`).
//
// A READ: no file content leaves here (only design-root-relative paths), nothing is written, the hub
// is never asked. An import that is missing and that the ledger does not explain (sync converged, the
// hub never had it) is a genuine mistake in the code — it is not reported, and the ordinary error card
// stays.
//
// The ledger is read from its own file (`<designRoot>/_state/file-ledger/<hubId>.json`, which the file
// plane persists for "tests and the panel"), so this needs no handle on the live runtime. It is
// runtime state of THIS Mac (DDR-115: `_state/` never syncs), and even a planted one only steers which
// of our own words appear for paths the canvas itself imports.

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import { relativeImportGroups } from '../access/closure.ts';
import { isUnderOrEqual } from '../path-containment.ts';
import type { LedgerRow } from '../sync/file-ledger.ts';
import { classifyProjectFile } from '../sync/file-membership.ts';
import { computeSeedProgress } from '../sync/seed-progress.ts';

export type WaitingState = 'downloading' | 'waiting' | 'refused';

/** Our own words for why a file is held. The card turns each into a sentence. */
export type WaitingReason =
  /** A code module (.ts/.js) from a hub this Mac has not accepted shared code from. */
  | 'code-consent'
  /** Over the file plane's size ceiling — it never moves. */
  | 'too-large'
  /** The workspace's upload allowance is spent for now. */
  | 'quota'
  /** The workspace refused it for good. */
  | 'refused'
  /** A try failed; the plane tries again by itself. */
  | 'retrying'
  /** Something references it and no peer has shared it yet. */
  | 'not-shared';

export interface WaitingFile {
  /** design-root-relative */
  rel: string;
  state: WaitingState;
  reason?: WaitingReason;
}

export interface CanvasWaiting {
  /** Refused first, then downloading, then waiting; at most `MAX_WAITING_FILES`. */
  files: WaitingFile[];
  /** How many more are missing past `files`. */
  more: number;
  /** The files this canvas needs: the canvas, what it imports (transitively), the missing ones. */
  need: { here: number; total: number };
  /** The whole project's sync: files delivered of files tracked. Null when not asked for. */
  progress: { delivered: number; total: number } | null;
}

/** What the module reads of the ledger. */
export interface LedgerView {
  rows: Record<string, LedgerRow>;
  /** How far through the journal this Mac has read; 0 = the first read has not landed. */
  cursor: number;
}

/** Files named in an answer (the card shows five). */
export const MAX_WAITING_FILES = 20;
/** The walk stops after this many files (no canvas comes near it). */
const MAX_WALK = 400;
/** A ledger file larger than this is not parsed (5 041 rows is ~2 MB). */
const MAX_LEDGER_BYTES = 64 * 1024 * 1024;
/** Files whose text can import something. */
const SCAN_RE = /\.(tsx|ts|jsx|js|mjs|cjs|css)$/i;

/**
 * The file plane's own sentence for a code module it will not land (`sync/file-plane.ts`, the
 * receive half of the code-module gate). Matched EXACTLY and only together with our own
 * classification of the path — `test/canvas-waiting.test.ts` holds it equal to the plane's text.
 */
export const CODE_CONSENT_REASON =
  'code modules replicate only from an owner-vouched or loopback hub';

// ── the ledger, from disk ───────────────────────────────────────────────────────────────────────

let ledgerMemo: { key: string; view: LedgerView | null } | null = null;

/**
 * The newest ledger under `<designRoot>/_state/file-ledger/` (one per hub; a relinked project keeps
 * the old hub's file beside it), or null when this project has none — not linked, a cell, or the
 * first pass has not flushed yet. Re-parsed only when the file changes.
 */
export function readLedgerView(designRoot: string): LedgerView | null {
  const dir = path.join(designRoot, '_state', 'file-ledger');
  let newest: { file: string; mtimeMs: number; size: number } | null = null;
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(dir, name);
      const st = statSync(file);
      if (!st.isFile() || st.size > MAX_LEDGER_BYTES) continue;
      if (!newest || st.mtimeMs > newest.mtimeMs)
        newest = { file, mtimeMs: st.mtimeMs, size: st.size };
    }
  } catch {
    return null;
  }
  if (!newest) return null;
  const key = `${newest.file}:${newest.mtimeMs}:${newest.size}`;
  if (ledgerMemo?.key === key) return ledgerMemo.view;
  let view: LedgerView | null = null;
  try {
    const data = JSON.parse(readFileSync(newest.file, 'utf8')) as {
      rows?: unknown;
      cursor?: unknown;
    };
    if (data && typeof data.rows === 'object' && data.rows !== null && !Array.isArray(data.rows))
      view = {
        rows: data.rows as Record<string, LedgerRow>,
        cursor: typeof data.cursor === 'number' && Number.isFinite(data.cursor) ? data.cursor : 0,
      };
  } catch {
    view = null;
  }
  ledgerMemo = { key, view };
  return view;
}

// ── the walk ────────────────────────────────────────────────────────────────────────────────────

/** A regular file at `abs`, held inside the design root (symlinks resolved), or false. */
function isHereFile(abs: string, rootReal: string): boolean {
  try {
    const real = realpathSync(abs);
    return isUnderOrEqual(real, rootReal) && statSync(real).isFile();
  } catch {
    return false;
  }
}

const relOf = (designRoot: string, abs: string) =>
  path.relative(designRoot, abs).split(path.sep).join('/');

/**
 * The canvas's import closure on disk: the files that are here, and every import that resolves to
 * none of its candidates (one candidate list per specifier, design-root-relative).
 */
export function walkCanvasImports(
  designRoot: string,
  canvasAbs: string
): { here: string[]; missing: string[][] } {
  const root = path.resolve(designRoot);
  let rootReal: string;
  try {
    rootReal = realpathSync(root);
  } catch {
    return { here: [], missing: [] };
  }
  const here: string[] = [];
  const missing: string[][] = [];
  const seen = new Set<string>();
  const missingSeen = new Set<string>();
  const queue = [path.resolve(canvasAbs)];
  while (queue.length && seen.size < MAX_WALK) {
    const abs = queue.shift() as string;
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (!isHereFile(abs, rootReal)) continue;
    here.push(relOf(root, abs));
    if (!SCAN_RE.test(abs)) continue;
    let text: string;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    for (const group of relativeImportGroups(text, abs, root)) {
      if (!group.length) continue; // points outside the design root: not ours to explain
      const found = group.find((c) => isHereFile(c, rootReal));
      if (found) {
        if (!seen.has(found)) queue.push(found);
        continue;
      }
      const rels = group.map((c) => relOf(root, c));
      const key = rels.join('\n');
      if (missingSeen.has(key)) continue;
      missingSeen.add(key);
      missing.push(rels);
    }
  }
  return { here, missing };
}

// ── one missing import, explained ───────────────────────────────────────────────────────────────

/** The name to show for an import the ledger has no row for: the one candidate, or the base. */
function shownRel(group: string[]): string {
  if (group.length === 1) return group[0] as string;
  const tsx = group.find((r) => r.endsWith('.tsx'));
  return tsx ? tsx.slice(0, -'.tsx'.length) : (group[0] as string);
}

/** Why `rel` (a ledger row) is not here, in our words — or null when the ledger does not explain it. */
export function explainRow(rel: string, row: LedgerRow, syncing: boolean): WaitingFile | null {
  switch (row.state) {
    case 'refused':
      if (row.blockedClass === 'unreachable') return { rel, state: 'waiting', reason: 'retrying' };
      return {
        rel,
        state: 'refused',
        reason:
          row.blockedClass === 'too-large'
            ? 'too-large'
            : row.blockedClass === 'quota'
              ? 'quota'
              : 'refused',
      };
    case 'stuck':
      // the receive half of the code-module gate: only OUR sentence AND our own class of the path
      if (row.reason === CODE_CONSENT_REASON && classifyProjectFile(rel) === 'code-module')
        return { rel, state: 'refused', reason: 'code-consent' };
      return { rel, state: 'waiting', reason: 'retrying' };
    case 'referenced-but-unoffered':
      return { rel, state: 'waiting', reason: 'not-shared' };
    default:
      break;
  }
  if (typeof row.remoteHash === 'string' && row.remoteHash) return { rel, state: 'downloading' };
  // the hub has not offered it (or said it has none): only a sync still under way explains that
  return syncing ? { rel, state: 'waiting' } : null;
}

function explainGroup(group: string[], ledger: LedgerView, syncing: boolean): WaitingFile | null {
  const rows = group
    .map((rel) => [rel, Object.hasOwn(ledger.rows, rel) ? ledger.rows[rel] : undefined] as const)
    .filter((e): e is readonly [string, LedgerRow] => !!e[1] && typeof e[1] === 'object');
  // the candidate the hub offered wins; else any row; else none
  const best = rows.find(([, r]) => typeof r.remoteHash === 'string' && r.remoteHash) ?? rows[0];
  if (best) return explainRow(best[0], best[1], syncing);
  return syncing ? { rel: shownRel(group), state: 'waiting' } : null;
}

const RANK: Record<WaitingState, number> = { refused: 0, downloading: 1, waiting: 2 };

/**
 * What `canvasAbs` is waiting for, or null when nothing it imports is missing for a reason the sync
 * explains (then the ordinary error card is the truth). `project: false` leaves out the project's
 * totals (a canvas-only session learns nothing about the rest of the project).
 */
export function canvasWaiting(opts: {
  designRoot: string;
  canvasAbs: string;
  ledger: LedgerView | null;
  project?: boolean;
  now?: number;
}): CanvasWaiting | null {
  const { ledger } = opts;
  if (!ledger) return null;
  const walk = walkCanvasImports(opts.designRoot, opts.canvasAbs);
  if (!walk.missing.length) return null;
  const seed = computeSeedProgress({ rows: ledger.rows, now: opts.now ?? Date.now() });
  const syncing = ledger.cursor === 0 || seed.remaining > 0;
  const explained: WaitingFile[] = [];
  for (const group of walk.missing) {
    const w = explainGroup(group, ledger, syncing);
    if (w) explained.push(w);
  }
  if (!explained.length) return null;
  explained.sort((a, b) => RANK[a.state] - RANK[b.state] || a.rel.localeCompare(b.rel));
  return {
    files: explained.slice(0, MAX_WAITING_FILES),
    more: Math.max(0, explained.length - MAX_WAITING_FILES),
    need: { here: walk.here.length, total: walk.here.length + walk.missing.length },
    progress: opts.project === false ? null : { delivered: seed.delivered, total: seed.tracked },
  };
}
