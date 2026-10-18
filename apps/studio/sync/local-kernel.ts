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
import { laneHash } from '../../hub/src/project-transactions/lanes.mjs';
import { createStoreCore } from '../../hub/src/project-transactions/store-core.mjs';
import { canvasSlugFromRel } from '../canvas-slug.ts';
import { bumpTrashSeq, type TrashListing } from '../history/trash.ts';
import { atomicWrite } from './atomic-write.ts';
import { validateCanvasPath } from './canvas-path.ts';
import { laneValueFromFile, mergeSharedMetaIntoLocal } from './codec.ts';
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
/** A foreign machine's store, kept read-only (C1). */
export const FOREIGN_STORE = /^project-store\.([A-Za-z0-9_-]{1,64})\.sqlite$/;
const SQLITE_SIDECARS = ['', '-wal', '-shm'] as const;

/** The lanes a local canvas carries. Comments stay per machine (`_comments/`). */
export const LOCAL_LANES = ['html', 'meta', 'annotations'] as const;
type LocalLane = (typeof LOCAL_LANES)[number];

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

/** The `ctx.syncControl.current()` surface a local project answers through. */
export interface LocalRuntime {
  cancelAssetSweep(): boolean;
  acceptedHistory(q: {
    limit?: number;
    before?: number | null;
    path?: string | null;
    chat?: string | null;
    kind?: string | null;
    mine?: boolean;
  }): Promise<LocalHistoryRow[]>;
  acceptedVersion(repoRel: string, revision: number): Promise<string | null>;
  acceptedRestore(repoRel: string, revision: number): Promise<LocalOutcome>;
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
    origin: Record<string, unknown> = {}
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
    // S1.6 — a local project is its owner's (S1 Q4): every per-op cap holds,
    // `trash.clear` (`delete`) included, which the kernel refuses without `can`.
    const { body } = await kernel.submit(bytes, { actor: as, can: () => true });
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
  const sibling = (rel: string, lane: LocalLane) =>
    lane === 'html'
      ? rel
      : rel.replace(/\.tsx$/i, lane === 'meta' ? '.meta.json' : '.annotations.json');
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
      if (!live) return null;
      const st = (await store.heads([live]))[live];
      return submit(
        [{ op: 'doc.delete', doc: live, generation: st?.generation }],
        { ...action, label: action.label ?? NAME(rel) },
        as
      );
    }
    if (!inGroups(rel)) return null;
    const values: Partial<Record<LocalLane, string>> = {};
    for (const lane of LOCAL_LANES) {
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
    const ops: unknown[] = [];
    for (const lane of LOCAL_LANES) {
      const v = values[lane];
      if (v === undefined) continue;
      const headHash = hashOr(head?.lanes?.[lane]?.hash);
      if (laneHash(v) === headHash) continue;
      ops.push({ op: 'lane.replace', doc: live, lane, content: v, base: headHash });
    }
    if (!ops.length) return null;
    return submit(ops, { ...action, label: action.label ?? NAME(rel) }, as);
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
        if (!(LOCAL_LANES as readonly string[]).includes(lane)) continue;
        const l = lane as LocalLane;
        const rel = sibling(c.path, l);
        const current = diskLane(c.path, l);
        if (current !== null && laneHash(current) === laneHash(value)) continue;
        if (!c.created && !c.revived && !(await diskMatches(c.path, c.doc, l))) {
          log.warn(`[local-kernel] ${rel} changed on disk since — left as it is`);
          continue;
        }
        if (value === '') {
          if (l !== 'html') {
            try {
              unlinkSync(abs(rel));
            } catch {
              /* absent */
            }
          }
          continue;
        }
        const text = l === 'meta' ? mergeSharedMetaIntoLocal(readText(rel), value) : value;
        if (text === null) continue;
        atomicWrite(abs(rel), text);
      }
    }
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
    const canvas = canvasOfRel(rel);
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
      effects: { doc: string | null; beforePath: string | null; afterPath: string | null }[];
    }[];
    return history.map((a) => {
      const canvases = new Set<string>();
      for (const e of a.effects) {
        const p = e.afterPath ?? (e.doc ? pathOf.get(e.doc) : null) ?? e.beforePath;
        if (p && /\.tsx$/i.test(p)) canvases.add(p);
      }
      return {
        revision: a.revision,
        actionId: a.actionId,
        actor: a.actor,
        mine: a.actor === actor,
        kind: a.kind,
        label: a.label,
        committedAt: a.committedAt,
        undoes: a.undoes,
        canvases: [...canvases].sort(),
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

  /** Before answering, every observation already made is in the log. */
  async function settled(): Promise<void> {
    await readyP;
    if (pending.size) await drain();
    else await serial(async () => {});
  }

  const runtime: LocalRuntime = {
    cancelAssetSweep: () => false,
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
    async acceptedVersion(repoRel, revision) {
      await readyP;
      const o = opened;
      if (!o) return null;
      const doc = await docOf(o, repoRel);
      if (!doc) return null;
      const hash = await o.store.laneAt(doc, 'html', revision);
      return hash ? ((await o.store.blob(hash)) as string | null) || null : null;
    },
    async acceptedRestore(repoRel, revision) {
      await settled();
      if (!kernel || !opened) return { status: 'rejected', code: 'store-locked' };
      const doc = await docOf(opened, repoRel);
      if (!doc) return { status: 'rejected', code: 'unknown-canvas' };
      return serial(() =>
        submit([{ op: 'history.restore', revision, docs: [doc] }], {
          kind: 'history.restore',
          label: `Restore ${NAME(repoRel)} to version ${revision}`,
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
  };

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
