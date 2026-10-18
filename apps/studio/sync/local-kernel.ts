// The local home — the one op log for a project with no hub (S5.1b).
//
// The hub's acceptance kernel and store core (`apps/hub/src/project-
// transactions/kernel.mjs` + `store-core.mjs`) run here, in the studio process,
// over `bun:sqlite` at `<designRoot>/_state/project-store.sqlite` (V2-1.5 §5.6,
// S5-kernel-foundation §4). Nothing here forks the log: the same envelope, the
// same effects, the same undo — so `/_api/project/{history,undo,restore}` stop
// answering `legacy` for a local project and no route learns which home
// answered (foundation §5).
//
// What makes it different from a hub is only WHERE the content lives: the disk
// already holds it, so there is no projection. A change on disk is PROPOSED by
// the watcher feed (`observe`) as an ordinary action of `kind: 'outside'`; an
// accepted undo / restore is PUBLISHED by writing the files back
// (`applyAccepted`). Every file write here first checks the disk still holds
// what the store last recorded — an unrecorded byte on disk (a half-typed edit
// the source gate refused) is never overwritten.
//
// S1's four conditions for the local store (V2-1.9 §5.3) are part of it:
//   C1  one machine per store — `store_meta.machine`; a copied store is renamed
//       `project-store.<machine>.sqlite` and only ever opened read-only;
//   C2  one writer — `_state/project-store.lock` `{ pid, bootId, machine, at }`;
//       a second studio on the folder opens the store read-only;
//   C3  baseline — one `migration.import` action per canvas on the first boot;
//   C4  gzip bodies — `createStoreCore(sql, { codec: GZIP_CODEC })`.
//
// None of these paths is a new runtime class: `_state/` is already ignored in
// all four DDR-115 lists.

import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { homedir, hostname, uptime } from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { MIGRATION_ACTOR } from '../../hub/src/project-transactions/baseline.mjs';
import { createKernel, EMPTY_HASH, PROTOCOL } from '../../hub/src/project-transactions/kernel.mjs';
import { laneHash, mergeLane } from '../../hub/src/project-transactions/lanes.mjs';
import { createStoreCore } from '../../hub/src/project-transactions/store-core.mjs';
import { serializeBoard } from '../annotations/schema.ts';
import { attributeArtboards } from '../attribute-artboards.ts';
import { canvasSlugFromRel } from '../canvas-slug.ts';
import { bumpTrashSeq, type TrashListing } from '../history/trash.ts';
import { createActionStage, type RunFence, type RunStageSummary } from './action-stage.ts';
import { atomicWrite } from './atomic-write.ts';
import { validateCanvasPath } from './canvas-path.ts';
import { laneValueFromFile, mergeSharedMetaIntoLocal } from './codec.ts';
import { hashBytes } from './echo-guard.ts';
import { canvasLanes, namedField, type RowNamed } from './history-fields.ts';
import { mergeSource } from './source-merge.ts';
import { type ParkedCanvas, removeClearedCopies } from './trash-clear-copies.ts';
import {
  asTarget,
  chatActionIds,
  originFields,
  type UndoTarget,
  undoLabel,
} from './undo-target.ts';

/* ------------------------------------------------------------------ files */

export const STORE_FILE = 'project-store.sqlite';
export const LOCK_FILE = 'project-store.lock';
/** S5.5b — this home's held AI runs (V2-1.5 §5.5), apart from the hub link's `ai-stage.json`. */
export const AI_STAGE_FILE = 'ai-stage-local.json';
/** S5.5b — how long a studio write's content note waits for the watcher to read it. */
export const WRITE_NOTE_MS = 30_000;
/** The label a person's studio edit carries (the hub link's `LANE_LABEL.html`). */
export const STUDIO_EDIT_LABEL = 'Edit canvas';
/** S2.20b (U20) — the hub link's `LANE_LABEL` per local lane: a layout move, an annotation stroke. */
export const STUDIO_LANE_LABEL = {
  html: STUDIO_EDIT_LABEL,
  meta: 'Edit layout',
  annotations: 'Edit annotations',
} as const;
/** A foreign machine's store, kept read-only (C1). */
export const FOREIGN_STORE = /^project-store\.([A-Za-z0-9_-]{1,64})\.sqlite$/;
const SQLITE_SIDECARS = ['', '-wal', '-shm'] as const;

/** The lanes a local canvas carries. Comments stay per machine (`_comments/`). */
export const LOCAL_LANES = ['html', 'meta', 'annotations'] as const;
type LocalLane = (typeof LOCAL_LANES)[number];
/**
 * The lanes the watcher records from disk. The board (and the comments a
 * conversion touches) have a second writer — the collab room projects onto
 * them — so, as on a hub link (projection.ts), they are never proposed from a
 * file event: they reach the store only as an explicit action (S4.7
 * `proposeLanes`), and an accepted undo merges back into what the disk holds.
 */
const WATCHED_LANES = ['html', 'meta'] as const;
/** S4.7 — lanes only an explicit action writes; published three-way onto the disk. */
const EXPLICIT_LANES = ['annotations', 'comments'] as const;
type ExplicitLane = (typeof EXPLICIT_LANES)[number];
const isExplicit = (lane: string): lane is ExplicitLane =>
  (EXPLICIT_LANES as readonly string[]).includes(lane);

/** What the watcher's actions say (V2-1.9 §5.2). */
export const OUTSIDE_KIND = 'outside';
export const BASELINE_KIND = 'migration.import';
export const BASELINE_LABEL = 'Version history starts here';
/** How long a burst of fs events on one canvas settles before it is proposed. */
export const OBSERVE_SETTLE_MS = 300;
/** How often a read-only studio asks whether the writer has gone (C2). */
export const LOCK_RETRY_MS = 5_000;

/* ------------------------------------------------------------- identities */

export interface MachineIdentity {
  /** Stable for this install — never per project copy. */
  id: string;
  /** "History from <name>" (V2-1.9 §5.3 C1). */
  name: string;
}

const MACHINE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** `~/.config/maude/machine.json` (XDG-aware; `MAUDE_MACHINE_FILE` overrides). */
export function machineIdentityPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MAUDE_MACHINE_FILE) return env.MAUDE_MACHINE_FILE;
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : path.join(homedir(), '.config');
  return path.join(base, 'maude', 'machine.json');
}

/** This install's identity, created once. */
export function machineIdentity(file: string = machineIdentityPath()): MachineIdentity {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')) as Partial<MachineIdentity>;
    if (typeof v.id === 'string' && MACHINE_ID.test(v.id)) {
      return { id: v.id, name: typeof v.name === 'string' && v.name ? v.name : v.id };
    }
  } catch {
    /* absent or unreadable — mint one below */
  }
  const id = `m_${randomUUID().replace(/-/g, '')}`;
  let name = 'this Mac';
  try {
    name =
      hostname()
        .replace(/\.local$/i, '')
        .slice(0, 64) || name;
  } catch {
    /* keep the default */
  }
  const ident = { id, name };
  try {
    atomicWrite(file, `${JSON.stringify(ident, null, 2)}\n`);
  } catch (err) {
    console.warn(`[local-kernel] could not save the machine id at ${file}:`, err);
  }
  return ident;
}

/**
 * This boot of the operating system. A lock whose pid is alive but whose boot
 * differs belongs to a pid from before a restart (a reused number).
 */
export function bootIdentity(): string {
  try {
    if (process.platform === 'linux') {
      return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    }
    if (process.platform === 'darwin') {
      const r = Bun.spawnSync(['sysctl', '-n', 'kern.bootsessionuuid'], { stderr: 'ignore' });
      const out = r.stdout.toString().trim();
      if (r.exitCode === 0 && out) return out;
    }
  } catch {
    /* fall through to the uptime estimate */
  }
  // Boot time to the minute: stable across this boot, different after one.
  return `t${Math.floor((Date.now() / 1000 - uptime()) / 60)}`;
}

/* ------------------------------------------------------------ sql + codec */

interface SqlAdapter {
  exec(query: string, ...params: unknown[]): Record<string, unknown>[];
  transaction<T>(fn: () => T): T;
}

/** The synchronous `{ exec, transaction }` interface store-core takes. */
export function bunSqliteAdapter(db: Database): SqlAdapter {
  const cache = new Map<string, ReturnType<Database['query']>>();
  const statement = (q: string) => {
    let s = cache.get(q);
    if (!s) {
      s = db.query(q);
      cache.set(q, s);
    }
    return s;
  };
  return {
    exec(query, ...params) {
      const s = statement(query);
      const args = params as never[];
      if (s.columnNames.length > 0) return s.all(...args) as Record<string, unknown>[];
      s.run(...args);
      return [];
    },
    transaction(fn) {
      return db.transaction(fn)();
    },
  };
}

/** C4 — gzip lane bodies; a plain TEXT row written before the codec still reads. */
export const GZIP_CODEC = Object.freeze({
  encode: (text: string): Uint8Array => gzipSync(Buffer.from(text, 'utf8')),
  decode: (stored: unknown): string =>
    typeof stored === 'string'
      ? stored
      : gunzipSync(Buffer.from(stored as Uint8Array)).toString('utf8'),
});

/* ------------------------------------------------------------------- lock */

export interface LockRecord {
  pid: number;
  bootId: string;
  machine: string;
  at: number;
  token: string;
}

export type LockOutcome =
  | { held: true; release(): void; record: LockRecord }
  | { held: false; holder: LockRecord | null };

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: alive, someone else's. ESRCH: gone.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLock(file: string): { raw: string; rec: LockRecord | null } | null {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    const v = JSON.parse(raw) as LockRecord;
    if (Number.isSafeInteger(v.pid) && typeof v.bootId === 'string') return { raw, rec: v };
  } catch {
    /* torn / foreign bytes — stale */
  }
  return { raw, rec: null };
}

/**
 * C2 — take `project-store.lock`, exclusively. A lock held by a live process of
 * this boot on this machine is respected; one whose pid is gone, whose boot
 * differs, or which another machine wrote (a copied folder) is taken over.
 */
export function acquireStoreLock(
  file: string,
  me: { pid: number; bootId: string; machine: string; now?: () => number }
): LockOutcome {
  const record: LockRecord = {
    pid: me.pid,
    bootId: me.bootId,
    machine: me.machine,
    at: (me.now ?? Date.now)(),
    token: randomUUID(),
  };
  mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx', 0o600);
      writeSync(fd, `${JSON.stringify(record)}\n`);
      closeSync(fd);
      return {
        held: true,
        record,
        release() {
          // Only our own lock: a takeover after we hung must not be undone.
          if (readLock(file)?.rec?.token === record.token) {
            try {
              unlinkSync(file);
            } catch {
              /* already gone */
            }
          }
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const cur = readLock(file);
    if (!cur) continue; // released between the two calls
    const h = cur.rec;
    const live =
      h !== null && h.machine === me.machine && h.bootId === me.bootId && pidAlive(h.pid);
    if (live) return { held: false, holder: h };
    // Stale. Remove it only if it is still the bytes we judged.
    if (readLock(file)?.raw === cur.raw) {
      try {
        unlinkSync(file);
      } catch {
        /* someone else took it over first */
      }
    }
  }
  return { held: false, holder: readLock(file)?.rec ?? null };
}

/* ------------------------------------------------------------------ store */

type AsyncStore = Record<string, (...args: unknown[]) => Promise<any>>;

/** The kernel as this module drives it (the `.mjs` carries no types). */
interface KernelLike {
  submit(
    bytes: string,
    auth: { actor: string; can?: (cap: string) => boolean }
  ): Promise<{ status: number; body: any }>;
}
const makeKernel = createKernel as unknown as (o: Record<string, unknown>) => KernelLike;

interface OpenedStore {
  db: Database;
  store: AsyncStore;
  core: Record<string, (...args: unknown[]) => any>;
  sql: SqlAdapter;
}

function openStore(
  file: string,
  { readonly, now }: { readonly: boolean; now: () => number }
): OpenedStore {
  const db = readonly
    ? new Database(file, { readonly: true })
    : new Database(file, { create: true, readwrite: true });
  if (!readonly) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
    db.exec('PRAGMA foreign_keys = ON');
  }
  db.exec('PRAGMA busy_timeout = 2000');
  const sql = bunSqliteAdapter(db);
  const core = createStoreCore(sql, { now, codec: GZIP_CODEC }) as unknown as OpenedStore['core'];
  if (!readonly) core.migrate();
  const store: AsyncStore = {};
  for (const [name, fn] of Object.entries(core)) {
    if (name === 'migrate') continue;
    store[name] = async (...args: unknown[]) => fn(...args);
  }
  return { db, store, core, sql };
}

function storeMachine(sql: SqlAdapter): string | null {
  try {
    const row = sql.exec(`SELECT v FROM store_meta WHERE k = 'machine'`)[0];
    return row ? String(row.v) : null;
  } catch {
    return null; // a store with no schema yet
  }
}

function setStoreMeta(sql: SqlAdapter, k: string, v: string): void {
  sql.exec(
    `INSERT INTO store_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
    k,
    v
  );
}

function readStoreMeta(sql: SqlAdapter, k: string): string | null {
  const row = sql.exec(`SELECT v FROM store_meta WHERE k = ?`, k)[0];
  return row ? String(row.v) : null;
}

const sanitizeMachine = (m: string) => m.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'unknown';

/** Move a store (and its WAL sidecars) aside as a foreign machine's copy. */
function moveAside(stateDir: string, machine: string): string {
  const base = `project-store.${sanitizeMachine(machine)}`;
  let target = path.join(stateDir, `${base}.sqlite`);
  for (let n = 2; existsSync(target); n++) {
    target = path.join(stateDir, `${base}-${n}.sqlite`.slice(0, 80));
  }
  const from = path.join(stateDir, STORE_FILE);
  for (const s of SQLITE_SIDECARS) {
    if (existsSync(`${from}${s}`)) renameSync(`${from}${s}`, `${target}${s}`);
  }
  return target;
}

/* ------------------------------------------------------------- the runtime */

export interface LocalHistoryRow {
  revision: number;
  actionId: string;
  actor: string;
  mine: boolean;
  kind: string;
  label: string | null;
  committedAt: number;
  undoes: string | string[] | null;
  /** Design-root-relative canvas paths the action touched. */
  canvases: string[];
  /** S1.12b — per canvas, the lanes the action touched there (additive). */
  lanes: Record<string, string[]>;
  /** S1.12b — a `name` action's target revision and name (`origin.named`; null clears). */
  named?: RowNamed;
  /** V2-1.5 §5.1 origin keys (S5.5). */
  runId?: string;
  chatId?: string;
  madeAt?: number;
  partial?: true;
}

export type LocalOutcome = {
  status: 'accepted' | 'rejected';
  code?: string;
  actionId?: string;
  revision?: number;
  undoes?: string | string[];
  skipped?: Array<{
    doc?: string;
    lane?: string;
    id?: string;
    reason: string;
    conflictWith?: string;
  }>;
  /** S1.7 — trash.restore: where the canvas came back; trash.clear: the ids cleared. */
  path?: string;
  cleared?: string[];
};

/**
 * S1.13 (V2-1.9 §5.8) — a restore that is not "the whole canvas at a revision": the studio computed
 * the lanes (history/restore-artboard.ts, restore-object.ts, an aside body) and proposes them as ONE
 * `kind: 'restore'` action, each `lane.replace` carrying `baseContent` = the head it read, so the
 * kernel merges three-way onto whatever landed since. `label` alone relabels a whole restore.
 */
export interface RestoreOptions {
  label?: string;
  lanes?: Array<{
    lane: 'html' | 'css' | 'meta' | 'annotations';
    content: string;
    baseContent: string;
  }>;
}

/** The `ctx.syncControl.current()` surface a local project answers through. */
export interface LocalRuntime {
  cancelAssetSweep(): boolean;
  /**
   * S4.7 — several lanes of one canvas as ONE action (sync/index.ts `proposeLanes`). `o.origin`
   * (S1.13b): envelope origin keys the kernel keeps, e.g. an artboard-trash action's
   * `trashed` (S1-trash.md §2).
   */
  proposeLanes(
    slug: string,
    lanes: Array<{ lane: string; text: string; baseText: string }>,
    o: { kind: string; label: string; origin?: Record<string, unknown> }
  ): Promise<LocalOutcome>;
  acceptedHistory(q: {
    limit?: number;
    before?: number | null;
    path?: string | null;
    chat?: string | null;
    kind?: string | null;
    mine?: boolean;
  }): Promise<LocalHistoryRow[]>;
  /**
   * S1.11 — `lane`: the source (default), or its meta; the local store has no CSS lane (→ null).
   * S1.13 — `{ aside: true }`: the body a `history.aside` at exactly `revision` kept for that lane.
   */
  acceptedVersion(
    repoRel: string,
    revision: number,
    lane?: 'html' | 'css' | 'meta' | 'annotations',
    o?: { aside?: boolean }
  ): Promise<string | null>;
  /** S1.13 — `o.lanes`: one artboard / object / kept-aside restore, ONE `restore` action. */
  acceptedRestore(repoRel: string, revision: number, o?: RestoreOptions): Promise<LocalOutcome>;
  /** S1.12b — `history.name` (V2-1.9 §5.4); `null` clears. */
  acceptedName(repoRel: string, revision: number, name: string | null): Promise<LocalOutcome>;
  /** S1.12b — `history.aside`: a version nobody kept, no head moves. */
  acceptedAside(
    repoRel: string,
    lane: 'html' | 'css' | 'meta' | 'annotations',
    content: string,
    label?: string
  ): Promise<LocalOutcome>;
  acceptedUndo(
    target: string | UndoTarget,
    redo?: boolean,
    o?: { via?: 'keys' | 'panel' }
  ): Promise<LocalOutcome>;
  /** S1.7 — the shared Trash (history/trash.ts `TrashRuntime`). */
  acceptedTrash(): Promise<TrashListing | null>;
  acceptedTrashRestore(entry: string): Promise<LocalOutcome>;
  acceptedTrashClear(items?: string[]): Promise<LocalOutcome>;
  /** S1.18 — the manifest rows a stable link resolves over (history/links.ts). */
  acceptedLinkDocs(): Promise<{ entry: string; path: string | null; retired: boolean }[] | null>;
  /** S1.18 — is the entry in the shared Trash (cleared items excluded)? */
  acceptedTrashed(entry: string): Promise<boolean>;
  /** S5.5b (U21) — the same run-stage surface the hub runtime has (sync/index.ts). */
  beginAiAction(
    key: string,
    label: string,
    meta?: { runId?: string; chatId?: string; actor?: string }
  ): void;
  claimAiWrite(key: string, repoRel: string, hash?: string | null): void;
  /**
   * S2.20b (U20) — server.ts calls this right after the studio wrote a canvas's layout
   * (`onMetaChanged`) or its board (`onAnnotationsChanged`). The local home only NOTES the content —
   * the disk already holds it, and the watcher records it as the person's `edit` — and answers null,
   * so the caller keeps its room bridge exactly as before.
   */
  proposeLane(
    slug: string,
    lane: 'comments' | 'annotations' | 'meta',
    text: string,
    opts?: { baseText?: string; writeId?: string }
  ): null;
  endAiAction(
    key: string,
    outcome: 'done' | 'failed' | 'stopped',
    o?: { fence?: RunFence }
  ): Promise<AiActionOutcome | null>;
  resolveAiAction(
    choice: 'publish' | 'discard',
    runId?: string
  ): Promise<(AiActionOutcome & { canvases?: number }) | null>;
}

/** What a run's end answers: the action it landed as and the artboards it touched. */
export interface AiActionOutcome {
  status: 'accepted' | 'rejected' | 'discarded';
  code?: string;
  actionId?: string;
  /** design-root-relative canvas → artboards (V2-1.5 §5.7). */
  touched?: Record<string, string[]>;
}

export interface LocalHomeOptions {
  /** Absolute design root. */
  designRoot: string;
  /** Repo-relative design root (`.design`). */
  designRel: string;
  /** The project's canvas groups (live — config reloads). */
  canvasGroups?: () => { path: string }[] | null;
  machine?: MachineIdentity;
  bootId?: string;
  pid?: number;
  now?: () => number;
  settleMs?: number;
  /** Retry the lock this often while read-only; 0 = never (tests). */
  lockRetryMs?: number;
  /** S5.5b — how long a run's last tool write gets to reach the watcher before the run ends. */
  aiSettleMs?: number;
  log?: Pick<Console, 'warn' | 'error'>;
  /** S1.7b — ctx.bus.emit: `trash:changed` when an accepted action changed the Trash. */
  emit?: (event: string, payload: unknown) => void;
}

export interface ForeignStore {
  machine: string;
  name: string | null;
  file: string;
}

export interface LocalHome {
  readonly file: string;
  /** `writer` holds the lock; `read-only` waits for it (C2). */
  mode(): 'writer' | 'read-only';
  /** Baseline + boot reconcile finished. */
  ready(): Promise<void>;
  runtime: LocalRuntime;
  /** The fs watcher feed: a design-root-relative path changed. */
  observe(rel: string): void;
  /**
   * S5.5b — the studio itself wrote `content` to canvas `rel` (api.ts `source-written`): when
   * the watcher reads exactly that content it is the person's `edit`, never `outside` and never
   * an AI run's.
   */
  noteWritten(rel: string, content: string): void;
  /** S5.5b — the runs this home stages (open and held), no bytes. */
  aiRuns(): RunStageSummary[];
  /** A canvas moved on disk (the studio's own move). */
  observeMove(fromRel: string, toRel: string): void;
  /** Propose every pending observation now. */
  flush(): Promise<void>;
  /** Other machines' stores in `_state/`, read-only (C1). */
  foreignStores(): ForeignStore[];
  /** Read-only history of one foreign store. */
  foreignHistory(
    machine: string,
    q?: { limit?: number; before?: number | null }
  ): Promise<LocalHistoryRow[] | null>;
  /** The async store (runs, leases, fences) for the run registry. */
  store(): AsyncStore;
  /** This person's actor id in the store. */
  actor: string;
  close(): void;
}

const NAME = (rel: string) => path.posix.basename(rel).replace(/\.tsx$/i, '');

/** `.design/ui/a.tsx` → `ui/a.tsx` (null when outside the design root). */
function designRelOf(repoRel: string, designRel: string): string | null {
  const p = String(repoRel).replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix = `${designRel.replace(/^\/+|\/+$/g, '')}/`;
  if (prefix !== '/' && p.startsWith(prefix)) return p.slice(prefix.length);
  return null;
}

/** The canvas a design-root-relative path belongs to (body / meta / board). */
export function canvasOfRel(rel: string): string | null {
  const p = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!p || p.split('/').some((c) => c.startsWith('_') || c.startsWith('.'))) return null;
  if (/\.tsx$/i.test(p)) return p;
  const m = /^(.*)\.(meta|annotations)\.json$/i.exec(p);
  return m ? `${m[1]}.tsx` : null;
}

export function openLocalHome(opts: LocalHomeOptions): LocalHome {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? console;
  const machine = opts.machine ?? machineIdentity();
  const bootId = opts.bootId ?? bootIdentity();
  const pid = opts.pid ?? process.pid;
  const settleMs = opts.settleMs ?? OBSERVE_SETTLE_MS;
  const lockRetryMs = opts.lockRetryMs ?? LOCK_RETRY_MS;
  const designRel = opts.designRel;
  const stateDir = path.join(opts.designRoot, '_state');
  const file = path.join(stateDir, STORE_FILE);
  const lockFile = path.join(stateDir, LOCK_FILE);
  const actor = `local:${machine.id}`;
  mkdirSync(stateDir, { recursive: true });

  let lock: Extract<LockOutcome, { held: true }> | null = null;
  let opened: OpenedStore | null = null;
  let kernel: KernelLike | null = null;
  let projectId = '';
  let readyP: Promise<void> = Promise.resolve();
  let retryTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  const foreignOpen = new Map<string, OpenedStore>();
  const aiSettleMs = opts.aiSettleMs ?? 250;

  /* ------------------------------------------------------- S5.5b — AI runs */

  // A run's tool writes are STAGED here (sync/action-stage.ts — the same stage the hub link
  // uses), so the watcher never records a canvas a run covers as `outside`: the run lands as
  // ONE `ai` action when it ends (V2-1.5 §5.5, U21). The disk stays the working copy, so it may
  // hold staged bytes the store has not accepted; `seen` remembers what each lane held when the
  // watcher last read it — the `d0` a change is composed from (`R.mine = merge3(d0, d1, mine)`)
  // and the base a person's edit made on top of staged bytes is proposed from.
  /** `${rel}|${lane}` → the lane's value on disk when last read (or written) here. */
  const seen = new Map<string, string>();
  /**
   * `${canvas}|${lane}` → the studio's own write of that lane (api.ts `source-written` for the
   * source, server.ts `proposeLane` for layout and board — S2.20b), until the watcher reads it.
   */
  const notes = new Map<string, { hash: string; at: number }>();
  /** canvas slug → its design-root-relative path (the board file is named by the slug). */
  const slugs = new Map<string, string>();
  /** >0 while a proposal made FROM the disk is accepted: the disk already holds it. */
  let fromDisk = 0;
  let runTx = 0;
  const stage = createActionStage({
    designRoot: opts.designRoot,
    stateFile: path.join(stateDir, AI_STAGE_FILE),
    propose: async (a) => {
      // The local store has no lease rows (the run registry's lease home is in process), so a
      // fence would only ever mismatch: the publish goes without it.
      const r = await serial(() =>
        submit(a.operations, { kind: a.kind, label: a.label }, actor, a.origin ?? {}, true)
      );
      return {
        protocol: PROTOCOL,
        status: r.status,
        transactionId: a.transactionId,
        ...(r.code ? { code: r.code } : {}),
        ...(r.actionId ? { actionId: r.actionId } : {}),
        ...(r.revision !== undefined ? { revision: r.revision } : {}),
      };
    },
    newTransactionId: () => `lt_run_${now().toString(36)}_${(++runTx).toString(36)}`,
    attribute: (slug, before, after) =>
      /\.tsx$/i.test(slug)
        ? { canvas: slug, artboards: attributeArtboards(slug, before, after).artboards }
        : null,
    log: { log() {}, warn: (m: string) => log.warn(m) },
    now,
  });

  function noteWritten(rel: string, content: string): void {
    const canvas = canvasOfRel(rel);
    if (!canvas || canvas !== rel.replace(/\\/g, '/').replace(/^\/+/, '')) return;
    notes.set(`${canvas}|html`, { hash: hashBytes(content), at: now() });
  }

  /** S2.20b — the studio wrote lane `lane` of the canvas named `slug` (server.ts `proposeLane`). */
  function noteLane(slug: string, lane: string, text: string): void {
    if (lane !== 'meta' && lane !== 'annotations') return;
    const canvas = canvasForSlug(slug);
    const value = canvas ? laneValueFromFile(lane, text) : null;
    if (!canvas || value === null) return;
    notes.set(`${canvas}|${lane}`, { hash: hashBytes(value), at: now() });
  }

  /** The studio's note for this lane value, consumed (null when the content is not the studio's). */
  function takeNote(
    rel: string,
    lane: LocalLane,
    value: string | undefined
  ): { at: number } | null {
    const k = `${rel}|${lane}`;
    const n = notes.get(k);
    if (!n) return null;
    if (now() - n.at > WRITE_NOTE_MS) {
      notes.delete(k);
      return null;
    }
    if (value === undefined || hashBytes(value) !== n.hash) return null;
    notes.delete(k);
    return { at: n.at };
  }

  /** The canvas a slug names: the ones seen so far, else a walk of the disk. */
  function canvasForSlug(slug: string): string | null {
    const hit = slugs.get(slug);
    if (hit) return hit;
    for (const rel of diskCanvases()) slugs.set(canvasSlugFromRel(rel, designRel), rel);
    return slugs.get(slug) ?? null;
  }

  /** The canvas a changed path belongs to — the board is `<designRoot>/<slug>.annotations.json`. */
  function canvasOfPath(rel: string): string | null {
    const p = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    const board = /^([^/]+)\.annotations\.json$/i.exec(p);
    if (board && !board[1].startsWith('_') && !board[1].startsWith('.')) {
      return canvasForSlug(board[1].toLowerCase()) ?? canvasOfRel(p);
    }
    return canvasOfRel(p);
  }

  /* ---------------------------------------------------------------- open */

  function openWriter(): void {
    // C1 — a store another machine wrote is never written by this one.
    if (existsSync(file)) {
      let other: string | null = null;
      try {
        const probe = new Database(file, { readonly: true });
        other = storeMachine(bunSqliteAdapter(probe));
        probe.close();
      } catch {
        other = null;
      }
      if (other !== null && other !== machine.id) {
        const moved = moveAside(stateDir, other);
        log.warn(`[local-kernel] ${file} came from another machine — kept read-only as ${moved}`);
      }
    }
    opened = openStore(file, { readonly: false, now });
    const sql = opened.sql;
    if (storeMachine(sql) === null) {
      setStoreMeta(sql, 'machine', machine.id);
      setStoreMeta(sql, 'machineName', machine.name);
    }
    projectId = readStoreMeta(sql, 'localProjectId') ?? '';
    if (!projectId) {
      projectId = `local_${randomUUID().replace(/-/g, '')}`;
      setStoreMeta(sql, 'localProjectId', projectId);
    }
    if (opened.core.state().mode !== 'transactions') {
      opened.core.setMode({ mode: 'transactions' });
    }
    kernel = makeKernel({
      store: opened.store,
      projectId,
      applyAccepted: publish,
      canvasGroups: () => opts.canvasGroups?.() ?? null,
      designRel,
      now,
      log,
    });
    // S5.5b (U14) — a run the last session left comes back HELD, before the boot reconcile
    // reads the disk: its bytes are its stage's, never an `outside` row.
    stage.restore();
  }

  function openReadOnly(): void {
    opened = existsSync(file) ? openStore(file, { readonly: true, now }) : null;
    kernel = null;
  }

  function start(): void {
    const got = acquireStoreLock(lockFile, { pid, bootId, machine: machine.id, now });
    if (got.held) {
      lock = got;
      openWriter();
      readyP = reconcile().catch((err) => log.error('[local-kernel] boot reconcile failed:', err));
      return;
    }
    openReadOnly();
    if (lockRetryMs > 0) {
      retryTimer = setInterval(() => {
        if (closed || lock) return;
        const again = acquireStoreLock(lockFile, { pid, bootId, machine: machine.id, now });
        if (!again.held) return;
        if (retryTimer) clearInterval(retryTimer);
        retryTimer = null;
        opened?.db.close();
        lock = again;
        openWriter();
        readyP = reconcile().catch((err) =>
          log.error('[local-kernel] reconcile after taking the lock failed:', err)
        );
      }, lockRetryMs);
      (retryTimer as { unref?: () => void }).unref?.();
    }
  }

  /* -------------------------------------------------------------- submit */

  let txn = 0;
  async function submit(
    operations: unknown[],
    action: { kind: string; label: string | null },
    as: string = actor,
    origin: Record<string, unknown> = {},
    /** The proposal IS what the disk holds: its acceptance writes nothing back. */
    disk = false
  ): Promise<LocalOutcome> {
    if (!kernel || !opened) return { status: 'rejected', code: 'store-locked' };
    const { epoch } = await opened.store.state();
    const bytes = JSON.stringify({
      protocol: PROTOCOL,
      projectId,
      epoch,
      transactionId: `lt_${now().toString(36)}_${(++txn).toString(36)}_${randomUUID().slice(0, 8)}`,
      origin: { deviceId: machine.id, client: 'studio-local', madeAt: now(), ...origin },
      action: { kind: action.kind, label: action.label, operations },
    });
    if (disk) fromDisk += 1;
    let body: any;
    try {
      // S1.6 — a local project is its owner's (S1 Q4): every per-op cap holds,
      // `trash.clear` (`delete`) included, which the kernel refuses without `can`.
      ({ body } = await kernel.submit(bytes, { actor: as, can: () => true }));
    } finally {
      if (disk) fromDisk -= 1;
    }
    if (body?.status === 'accepted') {
      return {
        status: 'accepted',
        ...(body.actionId ? { actionId: body.actionId } : {}),
        ...(Number.isSafeInteger(body.revision) ? { revision: body.revision } : {}),
        ...(typeof body.undoes === 'string' || Array.isArray(body.undoes)
          ? { undoes: body.undoes }
          : {}),
        ...(Array.isArray(body.skipped) && body.skipped.length ? { skipped: body.skipped } : {}),
        ...(Array.isArray(body.cleared) ? { cleared: body.cleared } : {}),
      };
    }
    return { status: 'rejected', code: String(body?.code ?? 'retryable') };
  }

  /* ------------------------------------------------------------ disk ⇄ lanes */

  const abs = (rel: string) => path.join(opts.designRoot, ...rel.split('/'));
  // The board is NOT a sibling: it sits at the design root under the canvas's
  // flat slug (`<slug>.annotations.json`, api.ts `annotationsPath`, DDR-242).
  const sibling = (rel: string, lane: LocalLane) =>
    lane === 'html'
      ? rel
      : lane === 'meta'
        ? rel.replace(/\.tsx$/i, '.meta.json')
        : `${canvasSlugFromRel(rel, designRel)}.annotations.json`;
  /** S4.7 — the file an explicit lane is published to. */
  const explicitFile = (rel: string, lane: ExplicitLane) =>
    lane === 'annotations'
      ? sibling(rel, 'annotations')
      : `_comments/${canvasSlugFromRel(rel, designRel)}.json`;
  const readText = (rel: string): string | null => {
    try {
      return readFileSync(abs(rel), 'utf8');
    } catch {
      return null;
    }
  };

  /** A lane's value on disk: '' when its file is absent, null when unreadable as that lane. */
  function diskLane(rel: string, lane: LocalLane): string | null {
    const text = readText(sibling(rel, lane));
    if (text === null) return '';
    return laneValueFromFile(lane, text);
  }

  const hashOr = (h: unknown) => (typeof h === 'string' && h ? h : EMPTY_HASH);

  function inGroups(rel: string): boolean {
    const groups = (opts.canvasGroups?.() ?? []).map((g) => g.path).filter(Boolean);
    const verdict = validateCanvasPath({
      path: rel,
      slug: canvasSlugFromRel(rel, designRel),
      designRel,
      canvasGroups: groups.length ? groups.map((p) => ({ path: p })) : undefined,
      allowUndeclaredGroup: groups.length === 0,
    });
    return verdict.ok;
  }

  /**
   * Propose what the disk holds for one canvas — the one function the baseline,
   * the boot reconcile and the watcher share. Returns null when nothing changed.
   */
  async function syncCanvas(
    rel: string,
    action: { kind: string; label: string | null },
    as: string = actor
  ): Promise<LocalOutcome | null> {
    if (!opened || !kernel) return null;
    const store = opened.store;
    const live: string | null = await store.docByPath(rel);
    const onDisk = existsSync(abs(rel));
    if (!onDisk) {
      for (const lane of LOCAL_LANES) seen.delete(`${rel}|${lane}`);
      if (!live) return null;
      const st = (await store.heads([live]))[live];
      return submit(
        [{ op: 'doc.delete', doc: live, generation: st?.generation }],
        { ...action, label: action.label ?? NAME(rel) },
        as
      );
    }
    if (!inGroups(rel)) return null;
    slugs.set(canvasSlugFromRel(rel, designRel), rel);
    const values: Partial<Record<LocalLane, string>> = {};
    for (const lane of WATCHED_LANES) {
      const v = diskLane(rel, lane);
      if (v !== null) values[lane] = v;
    }
    if (!values.html) return null; // an empty or unreadable body is not a canvas yet
    if (!live) {
      const lanes = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''));
      return submit(
        [{ op: 'doc.create', doc: canvasSlugFromRel(rel, designRel), path: rel, lanes }],
        { ...action, label: action.label ?? NAME(rel) },
        as
      );
    }
    const head = (await store.heads([live]))[live] as {
      lanes: Record<string, { hash: string | null }>;
    };
    // S5.5b — the studio's own write is the person's edit; a write a run claims (or a run
    // covers) joins that run's stage; anything else is outside, as before. S2.20b (U20) — per
    // lane: a layout move the studio wrote is an `edit` too (the board is not watched — S4.7), labelled by
    // its lane like the hub link's `LANE_LABEL`, and a lane nobody noted in the same read stays
    // `outside` in its own action.
    type Group = { ops: unknown[]; seen: Array<[string, string]>; lanes: LocalLane[]; at: number };
    const edit: Group = { ops: [], seen: [], lanes: [], at: Number.POSITIVE_INFINITY };
    const other: Group = { ops: [], seen: [], lanes: [], at: 0 };
    for (const lane of WATCHED_LANES) {
      const v = values[lane];
      if (v === undefined) continue;
      const k = `${rel}|${lane}`;
      const headHash = hashOr(head?.lanes?.[lane]?.hash);
      const prev = seen.get(k);
      if (prev !== undefined ? prev === v : laneHash(v) === headHash) continue;
      const base =
        prev ?? (headHash === EMPTY_HASH ? '' : (((await store.blob(headHash)) as string) ?? ''));
      const noted = action.kind === OUTSIDE_KIND ? takeNote(rel, lane, v) : null;
      if (!noted && action.kind === OUTSIDE_KIND && stage.captures(rel, true, v)) {
        seen.set(k, v);
        void stage
          .capture(rel, live, {
            lane,
            content: v,
            baseContent: base,
            transactionId: `lt_stage_${now().toString(36)}_${(++runTx).toString(36)}`,
            stageable: true,
          })
          .catch(() => null);
        continue;
      }
      const g = noted ? edit : other;
      if (noted) g.at = Math.min(g.at, noted.at);
      g.ops.push(
        laneHash(base) === headHash
          ? { op: 'lane.replace', doc: live, lane, content: v, base: headHash }
          : { op: 'lane.replace', doc: live, lane, content: v, baseContent: base }
      );
      g.seen.push([k, v]);
      g.lanes.push(lane);
    }
    let r: LocalOutcome | null = null;
    if (edit.ops.length) {
      const label = edit.lanes.includes('html')
        ? STUDIO_LANE_LABEL.html
        : STUDIO_LANE_LABEL[edit.lanes[0]];
      r = await submit(edit.ops, { kind: 'edit', label }, as, { madeAt: edit.at }, true);
      if (r.status === 'accepted') for (const [k, v] of edit.seen) seen.set(k, v);
    }
    if (other.ops.length) {
      r = await submit(other.ops, { ...action, label: action.label ?? NAME(rel) }, as, {}, true);
      if (r.status === 'accepted') for (const [k, v] of other.seen) seen.set(k, v);
    }
    return r;
  }

  /** Every canvas on disk under the groups, design-root-relative. */
  function diskCanvases(): string[] {
    const out: string[] = [];
    const groups = (opts.canvasGroups?.() ?? []).map((g) => g.path).filter(Boolean);
    const roots = groups.length
      ? groups
      : readdirSync(opts.designRoot, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
          .map((d) => d.name);
    const walk = (dirRel: string, depth: number) => {
      if (depth > 8) return;
      let entries: import('node:fs').Dirent[];
      try {
        entries = readdirSync(abs(dirRel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('_') || e.name.startsWith('.') || e.name === 'node_modules') continue;
        const rel = `${dirRel}/${e.name}`;
        if (e.isDirectory()) walk(rel, depth + 1);
        else if (e.isFile() && /\.tsx$/i.test(e.name)) out.push(rel);
      }
    };
    for (const g of new Set(roots)) walk(g.replace(/^\/+|\/+$/g, ''), 1);
    return out.sort();
  }

  /**
   * C3 + boot reconcile. A fresh store (or one whose import never finished)
   * gets one `migration.import` action per canvas; then whatever changed on
   * disk while no studio watched becomes `outside` rows.
   */
  async function reconcile(): Promise<void> {
    if (!opened) return;
    const store = opened.store;
    const st = await store.state();
    const baseline = st.importPending || st.revision === 0;
    for (const rel of diskCanvases()) {
      const action = baseline
        ? { kind: BASELINE_KIND, label: BASELINE_LABEL }
        : { kind: OUTSIDE_KIND, label: null };
      const r = await syncCanvas(rel, action, baseline ? MIGRATION_ACTOR : actor);
      if (r && r.status !== 'accepted') {
        log.warn(`[local-kernel] ${rel} not recorded (${r.code}) — kept on disk as it is`);
      }
    }
    if (baseline) await store.markImported();
    // Canvases deleted while no studio watched.
    const m = await store.manifest();
    for (const d of m.docs as { path: string; retired: boolean }[]) {
      if (!d.retired && d.path && !existsSync(abs(d.path))) {
        await syncCanvas(d.path, { kind: OUTSIDE_KIND, label: null });
      }
    }
  }

  /* -------------------------------------------------------------- publish */

  /**
   * The kernel's `applyAccepted` — an accepted action reaches the disk. The
   * echo returns through the watcher and finds the head already equal.
   */
  async function publish(p: {
    revision: number;
    changes: {
      doc: string;
      path: string | null;
      lanes: Record<string, string>;
      created: boolean;
      revived: boolean;
      deleted: boolean;
      retiredFor: string | null;
      movedFrom: string | null;
    }[];
    /** S1.6 — what a clear-out removed (kernel `extra.cleared`). */
    trashCleared?: {
      entry: string;
      artboard: string;
      rev: number;
      doc?: string;
      path?: string | null;
    }[];
  }): Promise<void> {
    const store = opened?.store;
    if (!store) return;
    try {
      await publishChanges(store, p);
    } finally {
      if (p.trashCleared?.length) await clearCopies(store, p.trashCleared);
      if (
        p.trashCleared?.length ||
        p.changes.some((c) => (c.deleted && !c.retiredFor) || c.revived)
      )
        bumpTrashSeq(opts.emit);
    }
  }

  /**
   * S1.7b — the owner cleared items out (S1 Q4): this machine's own parked
   * copies of exactly those canvases go (sync/trash-clear-copies.ts). The
   * bytes compared are the canvas as the store held it when it was trashed.
   */
  async function clearCopies(
    store: NonNullable<typeof opened>['store'],
    cleared: NonNullable<Parameters<typeof publish>[0]['trashCleared']>
  ): Promise<void> {
    try {
      const bodyAt = async (doc: string, rev: number) => {
        const h = await store.laneAt(doc, 'html', Math.max(rev - 1, 0));
        return h ? ((await store.blob(h)) ?? '') : '';
      };
      const items: ParkedCanvas[] = [];
      for (const c of cleared)
        if (c.artboard === '' && c.doc && c.path)
          items.push({ path: c.path, body: await bodyAt(c.doc, c.rev) });
      if (!items.length) return;
      const paths = new Set(items.map((i) => i.path));
      const remaining: ParkedCanvas[] = [];
      if (typeof store.trash === 'function')
        for (const c of (await store.trash({})).canvases as {
          doc: string;
          path: string;
          rev: number;
        }[])
          if (paths.has(c.path)) remaining.push({ path: c.path, body: await bodyAt(c.doc, c.rev) });
      removeClearedCopies({
        designRoot: opts.designRoot,
        designRel,
        cleared: items,
        remaining,
        log: (line) => log.warn(line),
      });
    } catch (err) {
      log.warn(`[local-kernel] clear-out cleanup failed: ${(err as Error).message}`);
    }
  }

  async function publishChanges(
    store: NonNullable<typeof opened>['store'],
    p: Parameters<typeof publish>[0]
  ): Promise<void> {
    // S5.5b — a proposal made from the disk (a watched write, a run landing): nothing to write.
    if (fromDisk > 0) return;
    // What the store held before this action, per lane — the disk must still
    // say that, or it carries a byte the store never accepted.
    const before = async (doc: string, lane: LocalLane) =>
      hashOr(await store.laneAt(doc, lane, p.revision - 1));
    const diskMatches = async (rel: string, doc: string, lane: LocalLane) => {
      const v = diskLane(rel, lane);
      return v !== null && laneHash(v) === (await before(doc, lane));
    };
    for (const c of p.changes) {
      if (!c.path) continue;
      if (c.deleted || c.retiredFor) {
        if (c.retiredFor) continue; // the move's new document carries the files
        if (!(await diskMatches(c.path, c.doc, 'html'))) {
          log.warn(`[local-kernel] ${c.path} changed on disk since — not deleted`);
          continue;
        }
        for (const lane of LOCAL_LANES) {
          try {
            unlinkSync(abs(sibling(c.path, lane)));
          } catch {
            /* absent */
          }
        }
        continue;
      }
      if (c.movedFrom && existsSync(abs(c.movedFrom)) && !existsSync(abs(c.path))) {
        for (const lane of LOCAL_LANES) {
          const from = abs(sibling(c.movedFrom, lane));
          if (!existsSync(from)) continue;
          mkdirSync(path.dirname(abs(sibling(c.path, lane))), { recursive: true });
          renameSync(from, abs(sibling(c.path, lane)));
        }
      }
      // A created or revived document lands whole: a revive carries no lane
      // change (a deleted document keeps its lanes), so read them from the head.
      const lanes: Record<string, string> = { ...c.lanes };
      if (c.created || c.revived) {
        const head = (await store.heads([c.doc]))[c.doc] as
          | { lanes?: Record<string, { hash: string | null }> }
          | undefined;
        for (const lane of LOCAL_LANES) {
          const h = head?.lanes?.[lane]?.hash;
          if (lanes[lane] === undefined && h) lanes[lane] = (await store.blob(h)) ?? '';
        }
      }
      for (const [lane, value] of Object.entries(lanes)) {
        if (isExplicit(lane)) {
          if (!c.created && !c.revived)
            await publishExplicit(c.path, c.doc, lane, value, p.revision);
          continue;
        }
        if (!(LOCAL_LANES as readonly string[]).includes(lane)) continue;
        const l = lane as LocalLane;
        const rel = sibling(c.path, l);
        const current = diskLane(c.path, l);
        if (current !== null && laneHash(current) === laneHash(value)) {
          seen.set(`${c.path}|${l}`, current);
          continue;
        }
        if (!c.created && !c.revived && !(await diskMatches(c.path, c.doc, l))) {
          log.warn(`[local-kernel] ${rel} changed on disk since — left as it is`);
          continue;
        }
        writeLane(c.path, l, value);
      }
    }
  }

  /**
   * S4.7 — an accepted change of an explicit lane reaches the disk THREE-WAY:
   * what the store held before → what it holds now, replayed onto what the disk
   * holds (by element / comment id — mergeLane). Nothing the store never saw is
   * overwritten: an unrecorded sticky edit or a new comment stays.
   */
  async function publishExplicit(
    rel: string,
    doc: string,
    lane: ExplicitLane,
    value: string,
    revision: number
  ): Promise<void> {
    const store = opened?.store;
    if (!store) return;
    const h = await store.laneAt(doc, lane, revision - 1);
    const before = h ? (((await store.blob(h)) as string | null) ?? '') : '';
    const fileRel = explicitFile(rel, lane);
    const raw = readText(fileRel);
    const disk = raw === null ? '' : laneValueFromFile(lane, raw);
    if (disk === null) {
      log.warn(`[local-kernel] ${fileRel} is unreadable — left as it is`);
      return;
    }
    const m = mergeLane(lane, before, value, disk);
    if (!m.ok) {
      log.warn(`[local-kernel] ${fileRel} changed on disk since — left as it is`);
      return;
    }
    if (m.content === disk) return;
    if (m.content === '') {
      if (lane === 'comments') {
        try {
          unlinkSync(abs(fileRel));
        } catch {
          /* absent */
        }
      } else atomicWrite(abs(fileRel), serializeBoard([]));
      return;
    }
    // The bytes the studio itself writes: api.ts `saveCommentsForFile` / the canonical board.
    const text = lane === 'comments' ? JSON.stringify(JSON.parse(m.content), null, 2) : m.content;
    mkdirSync(path.dirname(abs(fileRel)), { recursive: true });
    atomicWrite(abs(fileRel), text);
  }

  /**
   * S4.7 — several lanes of one canvas as ONE action (a sticky ↔ comment
   * conversion). The studio writes the files itself (the room bridge, the
   * sidebar); this records what they became. An explicit lane the store has
   * fallen behind on (a board edit the watcher does not record) is first
   * brought up to the disk's `baseText` by an `outside` row, so the action's
   * before-content IS what the disk held — its undo takes back exactly it.
   */
  async function proposeLanes(
    slug: string,
    lanes: Array<{ lane: string; text: string; baseText: string }>,
    o: { kind: string; label: string; origin?: Record<string, unknown> }
  ): Promise<LocalOutcome> {
    await readyP;
    return serial(async () => {
      if (!opened || !kernel) return { status: 'rejected', code: 'store-locked' } as LocalOutcome;
      const store = opened.store;
      const m = await store.manifest();
      const live = (m.docs as { doc: string; path: string; retired: boolean }[]).find(
        (d) => !d.retired && d.path && canvasSlugFromRel(d.path, designRel) === slug
      );
      if (!live) return { status: 'rejected', code: 'unknown-canvas' } as LocalOutcome;
      const head = (await store.heads([live.doc]))[live.doc] as {
        lanes: Record<string, { hash: string | null }>;
      };
      const catchUp: unknown[] = [];
      const ops: unknown[] = [];
      for (const l of lanes) {
        if (!isExplicit(l.lane) && !(LOCAL_LANES as readonly string[]).includes(l.lane))
          return { status: 'rejected', code: 'invalid' } as LocalOutcome;
        const lane = l.lane as LocalLane | ExplicitLane;
        const content = laneValueFromFile(lane, l.text);
        const base = laneValueFromFile(lane, l.baseText);
        if (content === null || base === null)
          return { status: 'rejected', code: 'invalid' } as LocalOutcome;
        const headHash = hashOr(head?.lanes?.[lane]?.hash);
        if (laneHash(base) !== headHash)
          catchUp.push({ op: 'lane.replace', doc: live.doc, lane, content: base, base: headHash });
        ops.push({ op: 'lane.replace', doc: live.doc, lane, content, base: laneHash(base) });
      }
      if (catchUp.length) {
        const r = await submit(catchUp, { kind: OUTSIDE_KIND, label: null }, actor, {}, true);
        if (r.status !== 'accepted') return r;
      }
      const r = await submit(ops, { kind: o.kind, label: o.label }, actor, o.origin ?? {}, true);
      if (r.status === 'accepted') {
        for (const l of lanes) if (!isExplicit(l.lane)) seen.set(`${live.path}|${l.lane}`, l.text);
      }
      return r;
    });
  }

  /** Write one lane's value to its file (an empty side lane removes the file). */
  function writeLane(canvasRel: string, l: LocalLane, value: string): void {
    const rel = sibling(canvasRel, l);
    if (value === '') {
      if (l !== 'html') {
        try {
          unlinkSync(abs(rel));
        } catch {
          /* absent */
        }
        seen.set(`${canvasRel}|${l}`, '');
      }
      return;
    }
    const text = l === 'meta' ? mergeSharedMetaIntoLocal(readText(rel), value) : value;
    if (text === null) return;
    atomicWrite(abs(rel), text);
    seen.set(`${canvasRel}|${l}`, value);
  }

  /**
   * A discarded run's bytes leave the disk: its deltas are taken back out of what the disk holds
   * now (three-way — a person's edit made since stays). A lane that cannot be untangled is left
   * as it is, and the next watched change records it.
   */
  function unstage(l: { slug: string; lane: string; base: string; mine: string }): void {
    if (!(LOCAL_LANES as readonly string[]).includes(l.lane)) return;
    const lane = l.lane as LocalLane;
    const disk = diskLane(l.slug, lane);
    if (disk === null) return;
    let next: string | null = null;
    if (disk === l.mine) next = l.base;
    else if (lane === 'html') {
      const m = mergeSource(l.mine, l.base, disk);
      next = m.ok ? m.merged : null;
    }
    if (next === null) {
      log.warn(
        `[local-kernel] ${l.slug}: the discarded AI changes could not be taken out — left as it is`
      );
      return;
    }
    if (next !== disk) writeLane(l.slug, lane, next);
  }

  /* -------------------------------------------------------------- watcher */

  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };

  function drain(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = null;
    const batch = [...pending];
    pending.clear();
    return serial(async () => {
      await readyP;
      for (const rel of batch) {
        try {
          await syncCanvas(rel, { kind: OUTSIDE_KIND, label: null });
        } catch (err) {
          log.error(`[local-kernel] recording ${rel} failed:`, err);
        }
      }
    });
  }

  function observe(rel: string): void {
    if (closed || !lock) return;
    const canvas = canvasOfPath(rel);
    if (!canvas) return;
    pending.add(canvas);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void drain(), settleMs);
    (timer as { unref?: () => void }).unref?.();
  }

  function observeMove(fromRel: string, toRel: string): void {
    if (closed || !lock) return;
    const from = canvasOfRel(fromRel);
    const to = canvasOfRel(toRel);
    if (!from || !to || !/\.tsx$/i.test(fromRel)) return;
    pending.delete(from);
    pending.delete(to);
    void serial(async () => {
      await readyP;
      if (!opened) return;
      const live: string | null = await opened.store.docByPath(from);
      if (!live) return void (await syncCanvas(to, { kind: OUTSIDE_KIND, label: null }));
      const st = (await opened.store.heads([live]))[live];
      const r = await submit(
        [
          {
            op: 'doc.move',
            doc: live,
            generation: st?.generation,
            to: { path: to, doc: canvasSlugFromRel(to, designRel) },
          },
        ],
        { kind: OUTSIDE_KIND, label: NAME(to) }
      );
      // A move the kernel refused still lands its content as a create.
      if (r.status !== 'accepted') await syncCanvas(to, { kind: OUTSIDE_KIND, label: null });
      // Content edited in the same burst.
      await syncCanvas(to, { kind: OUTSIDE_KIND, label: null });
    });
  }

  /* -------------------------------------------------------------- reading */

  async function rowsOf(
    o: OpenedStore,
    q: {
      limit?: number;
      before?: number | null;
      entry?: string | null;
      chat?: string | null;
      kind?: string | null;
      actor?: string | null;
    }
  ): Promise<LocalHistoryRow[]> {
    const m = await o.store.manifest();
    const pathOf = new Map<string, string>(
      (m.docs as { doc: string; path: string }[]).map((d) => [d.doc, d.path])
    );
    const history = (await o.store.history({
      limit: Math.min(Math.max(q.limit ?? 50, 1), 200),
      before: q.before ?? null,
      entry: q.entry ?? null,
      chat: q.chat ?? null,
      kind: q.kind ?? null,
      actor: q.actor ?? null,
    })) as {
      revision: number;
      actionId: string;
      actor: string;
      kind: string;
      label: string | null;
      committedAt: number;
      undoes: string | string[] | null;
      origin?: Record<string, unknown> | null;
      effects: {
        doc: string | null;
        lane: string;
        beforePath: string | null;
        afterPath: string | null;
      }[];
    }[];
    return history.map((a) => {
      const { canvases, lanes } = canvasLanes(
        a.effects,
        (d) => pathOf.get(d),
        (p) => /\.tsx$/i.test(p)
      );
      const named = namedField(a.kind, a.origin);
      return {
        revision: a.revision,
        actionId: a.actionId,
        actor: a.actor,
        mine: a.actor === actor,
        kind: a.kind,
        label: a.label,
        committedAt: a.committedAt,
        undoes: a.undoes,
        canvases,
        lanes,
        ...(named ? { named } : {}),
        ...originFields(a.origin),
      };
    });
  }

  /** The document a repo-relative canvas path names: the live one, else its slug's. */
  async function docOf(o: OpenedStore, repoRel: string): Promise<string | null> {
    const rel = designRelOf(repoRel, designRel);
    if (!rel) return null;
    return (await o.store.docByPath(rel)) ?? canvasSlugFromRel(rel, designRel);
  }

  /**
   * Before answering, every observation already made is in the log — and so is every write the
   * studio NOTED whose fs event has not arrived yet (S2.20b: the write landed before its route
   * answered, so a ⌘Z the instant after it must undo it, never the edit before it).
   */
  async function settled(): Promise<void> {
    await readyP;
    if (lock && !closed) {
      for (const [k, n] of notes) {
        if (now() - n.at > WRITE_NOTE_MS) notes.delete(k);
        else pending.add(k.slice(0, k.lastIndexOf('|')));
      }
    }
    if (pending.size) await drain();
    else await serial(async () => {});
  }

  const runtime: LocalRuntime = {
    cancelAssetSweep: () => false,
    proposeLanes: (slug, lanes, o) => proposeLanes(slug, lanes, o),
    async acceptedHistory(q) {
      await settled();
      const o = opened;
      if (!o) return [];
      let entry: string | null = null;
      if (q.path) {
        const doc = await docOf(o, q.path);
        const h = doc ? (await o.store.heads([doc]))[doc] : null;
        entry = (h as { entry?: string } | undefined)?.entry ?? null;
        if (!entry) return [];
      }
      return rowsOf(o, {
        limit: q.limit,
        before: q.before,
        entry,
        chat: q.chat ?? null,
        kind: q.kind ?? null,
        actor: q.mine ? actor : null,
      });
    },
    async acceptedVersion(repoRel, revision, lane = 'html', opt) {
      if (!(LOCAL_LANES as readonly string[]).includes(lane)) return null;
      await readyP;
      const o = opened;
      if (!o) return null;
      const doc = await docOf(o, repoRel);
      if (!doc) return null;
      if (opt?.aside) {
        // The `@aside` effect of that one action (kernel opHistoryAside): its body, by hash.
        const [r] = (await o.store.revisions({ after: revision - 1, limit: 1 })) as {
          revision: number;
          effects?: { doc: string; lane: string; op: string; afterHash: string | null }[];
        }[];
        const e =
          r?.revision === revision
            ? r.effects?.find(
                (x) => x.lane === '@aside' && x.doc === doc && x.op === `aside.${lane}`
              )
            : undefined;
        return e?.afterHash ? ((await o.store.blob(e.afterHash)) as string | null) || null : null;
      }
      const hash = await o.store.laneAt(doc, lane, revision);
      return hash ? ((await o.store.blob(hash)) as string | null) || null : null;
    },
    async acceptedRestore(repoRel, revision, opt) {
      await settled();
      if (!kernel || !opened) return { status: 'rejected', code: 'store-locked' };
      const doc = await docOf(opened, repoRel);
      if (!doc) return { status: 'rejected', code: 'unknown-canvas' };
      if (opt?.lanes) {
        // The local store keeps no CSS lane (LOCAL_LANES): a splice never carries one here.
        if (
          !opt.lanes.length ||
          opt.lanes.some((l) => !(LOCAL_LANES as readonly string[]).includes(l.lane))
        )
          return { status: 'rejected', code: 'invalid' };
        const lanes = opt.lanes;
        return serial(() =>
          submit(
            lanes.map((l) => ({
              op: 'lane.replace',
              doc,
              lane: l.lane,
              content: l.content,
              baseContent: l.baseContent,
            })),
            { kind: 'restore', label: opt.label ?? `Restore ${NAME(repoRel)}` }
          )
        );
      }
      return serial(() =>
        submit([{ op: 'history.restore', revision, docs: [doc] }], {
          kind: 'history.restore',
          label: opt?.label ?? `Restore ${NAME(repoRel)} to version ${revision}`,
        })
      );
    },
    async acceptedName(repoRel, revision, name) {
      await settled();
      if (!kernel || !opened) return { status: 'rejected', code: 'store-locked' };
      const doc = await docOf(opened, repoRel);
      if (!doc) return { status: 'rejected', code: 'unknown-canvas' };
      return serial(() =>
        submit([{ op: 'history.name', doc, revision, name }], {
          kind: 'name',
          label: name ?? 'Name cleared',
        })
      );
    },
    async acceptedAside(repoRel, lane, content, label) {
      await settled();
      if (!kernel || !opened) return { status: 'rejected', code: 'store-locked' };
      // The local store keeps no CSS lane (LOCAL_LANES): nothing to set aside there.
      if (!(LOCAL_LANES as readonly string[]).includes(lane))
        return { status: 'rejected', code: 'invalid' };
      const doc = await docOf(opened, repoRel);
      if (!doc) return { status: 'rejected', code: 'unknown-canvas' };
      return serial(() =>
        submit([{ op: 'history.aside', doc, lane, content, ...(label ? { label } : {}) }], {
          kind: 'aside',
          label: label ?? 'Version not kept',
        })
      );
    },
    async acceptedUndo(raw, redo = false, o) {
      await settled();
      if (!kernel || !opened) return { status: 'rejected', code: 'store-locked' };
      const target = asTarget(raw);
      const label = undoLabel(target, redo, o?.via);
      let ids: { actionId: string } | { actionIds: string[] };
      if ('chatId' in target) {
        // "Undo this chat": this person's own `ai` actions of the chat, as ONE action.
        const rows = await rowsOf(opened, { limit: 200, chat: target.chatId, actor, kind: 'ai' });
        const found = chatActionIds(rows, target.chatId);
        if (!found.ok) return { status: 'rejected', code: found.code };
        ids = { actionIds: found.actionIds };
      } else ids = target;
      return serial(() =>
        submit([{ op: redo ? 'history.redo' : 'history.undo', ...ids }], {
          kind: redo ? 'redo' : 'undo',
          label,
        })
      );
    },
    // S1.7 — the shared Trash over the store's readers (S1-trash.md §1). A local
    // project is its owner's, so `submit` passes every cap (S1.6).
    async acceptedTrash() {
      await settled();
      const o = opened;
      if (!o || typeof o.store.trash !== 'function') return null;
      const { canvases, artboards } = await o.store.trash({});
      const live: TrashListing['live'] = {};
      for (const entry of new Set((artboards as { entry: string }[]).map((a) => a.entry))) {
        const doc = await o.store.liveDocByEntry(entry);
        const h = doc ? (await o.store.heads([doc]))[doc] : null;
        if (doc && h?.path) live[entry] = { doc, path: h.path };
      }
      return { canvases, artboards, live, you: actor };
    },
    async acceptedTrashRestore(entry) {
      await settled();
      if (!kernel || !opened) return { status: 'rejected', code: 'store-locked' };
      const o = opened;
      const [item] = (await o.store.trash({ entry })).canvases as { path: string }[];
      const r = await serial(() =>
        submit([{ op: 'trash.restore', entry }], {
          kind: 'restore',
          label: item ? `Restored “${NAME(item.path)}” from the trash` : 'Restored from the trash',
        })
      );
      if (r.status !== 'accepted') return r;
      const doc = await o.store.liveDocByEntry(entry);
      const h = doc ? (await o.store.heads([doc]))[doc] : null;
      return h?.path ? { ...r, path: h.path } : r;
    },
    async acceptedTrashClear(items) {
      await settled();
      if (!kernel || !opened) return { status: 'rejected', code: 'store-locked' };
      return serial(() =>
        submit([{ op: 'trash.clear', ...(items ? { items } : {}) }], {
          kind: 'trash.clear',
          label: 'Cleared out the trash',
        })
      );
    },
    // S1.18 — the manifest rows a stable link resolves over (history/links.ts).
    async acceptedLinkDocs() {
      await settled();
      const o = opened;
      if (!o) return null;
      const m = await o.store.manifest();
      return (m.docs as { entry: string; path: string | null; retired: boolean }[]).map((d) => ({
        entry: d.entry,
        path: d.path,
        retired: !!d.retired,
      }));
    },
    async acceptedTrashed(entry) {
      await settled();
      const o = opened;
      if (!o) return false;
      const t = (await o.store.trash({ entry })) as { canvases?: unknown[] } | null;
      return (t?.canvases?.length ?? 0) > 0;
    },
    beginAiAction(key, label, meta) {
      if (!kernel) return;
      stage.begin(key, label, meta ?? {});
    },
    proposeLane(slug, lane, text) {
      if (lock && !closed) noteLane(slug, lane, text);
      return null;
    },
    claimAiWrite(key, repoRel, hash) {
      const rel = designRelOf(repoRel, designRel) ?? String(repoRel).replace(/^\/+/, '');
      const canvas = rel ? canvasOfRel(rel) : null;
      if (canvas) stage.claim(key, canvas, hash ?? null);
    },
    async endAiAction(key, outcome) {
      if (!kernel) return null;
      // The watcher delivers the run's last tool write a beat after the tool returns.
      if (aiSettleMs > 0) await new Promise((r) => setTimeout(r, aiSettleMs));
      await settled();
      const touched = stage.summaryOf(key)?.touched;
      const r = await stage.end(key, outcome);
      return r ? aiOutcome(r, touched) : null;
    },
    async resolveAiAction(choice, runId) {
      if (!kernel) return null;
      await settled();
      const held = stage.runs().filter((r) => r.state === 'held' && (!runId || r.runId === runId));
      if (!held.length) return null;
      if (choice === 'discard') {
        const lanes = held.flatMap((r) => stage.lanesOf(r.runId));
        const canvases = stage.discard(runId);
        await serial(async () => {
          for (const l of lanes) unstage(l);
        });
        return { status: 'discarded', canvases };
      }
      const touched: Record<string, string[]> = {};
      for (const r of held)
        for (const [c, ids] of Object.entries(r.touched))
          touched[c] = [...new Set([...(touched[c] ?? []), ...ids])].sort();
      const r = await stage.publish(runId);
      return r ? aiOutcome(r, touched) : null;
    },
  };

  function aiOutcome(
    r: { status: 'accepted' | 'rejected'; code?: string; actionId?: unknown },
    touched: Record<string, string[]> | undefined
  ): AiActionOutcome {
    return {
      status: r.status,
      ...(r.code ? { code: r.code } : {}),
      ...(typeof r.actionId === 'string' ? { actionId: r.actionId } : {}),
      ...(touched && Object.keys(touched).length ? { touched } : {}),
    };
  }

  /* -------------------------------------------------------------- foreign */

  function foreignStores(): ForeignStore[] {
    let names: string[] = [];
    try {
      names = readdirSync(stateDir);
    } catch {
      return [];
    }
    const out: ForeignStore[] = [];
    for (const n of names.sort()) {
      if (!FOREIGN_STORE.test(n)) continue;
      const f = path.join(stateDir, n);
      let mach: string | null = null;
      let name: string | null = null;
      try {
        if (!statSync(f).isFile()) continue;
        const db = new Database(f, { readonly: true });
        const sql = bunSqliteAdapter(db);
        mach = storeMachine(sql);
        name = readStoreMeta(sql, 'machineName');
        db.close();
      } catch {
        continue;
      }
      if (mach) out.push({ machine: mach, name, file: f });
    }
    return out;
  }

  async function foreignHistory(
    mach: string,
    q: { limit?: number; before?: number | null } = {}
  ): Promise<LocalHistoryRow[] | null> {
    const hit = foreignStores().find((s) => s.machine === mach);
    if (!hit) return null;
    let o = foreignOpen.get(hit.file);
    if (!o) {
      o = openStore(hit.file, { readonly: true, now });
      foreignOpen.set(hit.file, o);
    }
    return (await rowsOf(o, q)).map((r) => ({ ...r, mine: false }));
  }

  start();

  return {
    file,
    actor,
    mode: () => (lock ? 'writer' : 'read-only'),
    ready: () => readyP,
    runtime,
    observe,
    observeMove,
    noteWritten,
    aiRuns: () => stage.runs(),
    flush: () => drain(),
    foreignStores,
    foreignHistory,
    store: () => {
      if (!opened) throw new Error('local store not open');
      return opened.store;
    },
    close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      if (retryTimer) clearInterval(retryTimer);
      for (const o of foreignOpen.values()) o.db.close();
      foreignOpen.clear();
      try {
        opened?.db.close();
      } catch {
        /* already closed */
      }
      opened = null;
      kernel = null;
      lock?.release();
      lock = null;
    },
  };
}

/* ------------------------------------------------------- syncControl wiring */

interface SupervisorLike {
  current(): unknown;
}

/**
 * Foundation §5 — `ctx.syncControl.current()` answers with the hub runtime when
 * one runs, and with the local home when the project has no hub. A linked
 * project never sees the local home (its history is the hub's, as today), even
 * while its runtime is down: `isLocal()` is read on every call, so a project
 * linked or unlinked at runtime switches homes with no restart.
 */
export function withLocalHome<S extends SupervisorLike>(
  supervisor: S,
  local: () => LocalHome | null,
  isLocal: () => boolean
): S {
  return new Proxy(supervisor, {
    get(target, prop, receiver) {
      if (prop === 'current') {
        return () => {
          const hub = target.current();
          if (hub) return hub;
          if (!isLocal()) return null;
          return local()?.runtime ?? null;
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

/* ------------------------------------------------------- the studio's home */

interface StudioLike {
  cfg: { linkedHub?: unknown; canvasGroups?: { path: string }[] };
  paths: { designRoot: string; designRel: string };
  bus: {
    on(event: string, fn: (payload: any) => void): unknown;
    emit?(e: string, p: unknown): void;
  };
}

/**
 * Open the local home for a studio and feed it the watcher. A project with no
 * hub — not a cloud workspace, no `linkedHub` — answers history / undo /
 * restore from its own store; a linked project is exactly as before.
 * `MAUDE_LOCAL_STORE=0` turns it off.
 */
export function attachLocalHome<S extends SupervisorLike>(
  ctx: StudioLike,
  supervisor: S,
  env: NodeJS.ProcessEnv = process.env
): { control: S; home(): LocalHome | null; close(): void } {
  const enabled = env.MAUDE_LOCAL_STORE !== '0' && env.MAUDE_WORKSPACE_MODE !== '1';
  const isLocal = () => enabled && !ctx.cfg.linkedHub;
  let home: LocalHome | null = null;
  let failed = false;
  const get = (): LocalHome | null => {
    if (!isLocal() || failed) return null;
    if (!home) {
      try {
        home = openLocalHome({
          designRoot: ctx.paths.designRoot,
          designRel: ctx.paths.designRel,
          canvasGroups: () => ctx.cfg.canvasGroups ?? null,
          ...(ctx.bus.emit ? { emit: (e, p) => ctx.bus.emit?.(e, p) } : {}),
        });
      } catch (err) {
        // Never take the studio down: the project keeps working without
        // version history, exactly as it did before the local store existed.
        failed = true;
        console.error('[local-kernel] the local store could not open:', err);
      }
    }
    return home;
  };
  ctx.bus.on('fs:any', (rel: string) => {
    if (isLocal()) get()?.observe(rel);
  });
  // S5.5b — the studio's own write (api.ts, after it landed): the person's edit, by content.
  ctx.bus.on('source-written', (p: { rel?: unknown; content?: unknown } | null) => {
    if (!isLocal() || typeof p?.rel !== 'string' || typeof p.content !== 'string') return;
    get()?.noteWritten(p.rel, p.content);
  });
  // S2.20b (U20) — a collab room projecting its board (collab/index.ts): the person's strokes.
  ctx.bus.on('annotations-projected', (p: { slug?: unknown; board?: unknown } | null) => {
    if (!isLocal() || typeof p?.slug !== 'string' || typeof p.board !== 'string') return;
    get()?.runtime.proposeLane(p.slug, 'annotations', p.board);
  });
  ctx.bus.on(
    'canvas-list-update',
    (change: { action?: string; rel?: string; fromRel?: string } | null) => {
      if (!isLocal() || change?.action !== 'moved' || !change.rel || !change.fromRel) return;
      get()?.observeMove(change.fromRel, change.rel);
    }
  );
  get();
  return {
    control: withLocalHome(supervisor, get, isLocal),
    home: () => home,
    close() {
      home?.close();
      home = null;
    },
  };
}
