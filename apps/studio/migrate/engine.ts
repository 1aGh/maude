// `maude migrate v2` — the engine (V2-1.12 §5.10, Gate 0 A17).
//
// Dry-run by default (`planMigration` reads, never writes — I1). `applyMigration`
// re-plans, refuses when the tree changed (I2), takes `_state/migrate-v2.lock`,
// snapshots every file it will modify or remove to `_history/_migrate/v2-<stamp>/`
// with `report.json` (I3), and applies all-or-nothing. Idempotent (I4: a
// project already at the target exits 10). Exact reverse (I5): a file still
// holding the bytes the forward run wrote gets its snapshot back; a file it
// created is deleted; a file it trashed is put back; everything else gets the
// steps' semantic reverse. Hub order (I7): forward flips the hub BEFORE the
// first local write; reverse unflips it AFTER the last. Removals go to
// `_trash/migrate-v2/` (I8).
//
// Save mode (p8-update-to-accepted, Michal: decision
// `maude/v2-michal-update-project-switches-legacy-to-accepted`): forward, a LINKED
// project whose hub still saves the old way (DDR-241 `legacy`) is also switched to
// accepted revisions — the same run, owner only. The switch goes LAST: after the
// format flip and after the last local write, on the epoch read again from the hub
// (the flip advanced it). A reverse run never touches the mode.
//
// Reused in-process by the studio route `POST /_api/project/migrate`
// (routes/project-format.ts) — with `viaStudio: true`, which is the only way
// past the "a studio has this project open" refusal.

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
import { projectRoleForAccount } from '../access/roles.ts';
import { readHeadLines } from '../acp/transcript-io.ts';
import { migrateAnnotationsV2 } from '../annotations/migrate-boot.ts';
import { asFormat } from '../format.ts';
import { type DsTokensEmitter, defaultDsEmitter } from './ds-registry.ts';
import { createHubFormatClient, type HubFormatClient, type HubHealth } from './hub.ts';
import { type MigrationStep, STEPS, type StepCtx, type StepResult, sha256 } from './steps.ts';

export const TARGET_FORMAT = 2;
export const MIGRATE_LOCK_REL = path.join('_state', 'migrate-v2.lock');
export const SNAPSHOT_DIR_REL = path.join('_history', '_migrate');
export const TRASH_DIR_REL = path.join('_trash', 'migrate-v2');
export const FILE_LIST_CAP = 500;

export const EXIT = { done: 0, atTarget: 10, refused: 11, error: 1, usage: 2 } as const;

/** Why a LINKED project cannot be updated from this Mac now — the app's banner line per code. */
export type LinkRefusalCode =
  | 'no-sign-in'
  | 'offline'
  /** the hub turned this Mac's credential down (401/403) — sign in again (p8-update-fails-loud) */
  | 'token-rejected'
  | 'hub-too-old'
  | 'not-owner'
  /** gate-b-sec4: the committed link was never made on this Mac (parked) — Connect first (r1-format-ds) */
  | 'link-unconfirmed'
  | SaveModeBlocker;

/** Why the hub cannot switch the save mode now (`hub-integration.mjs` setMode / its dry run). */
export type SaveModeBlocker =
  | 'store-not-durable'
  | 'browser-not-paired'
  | 'mode-forbidden'
  | 'mode-unavailable';

/** The run-level line for a blocked or failed switch (the CLI prints it; the app has its own copy). */
export const SAVE_MODE_NOTE = {
  failed: (why: string) =>
    `format updated, still saving the old way (${why}) — run Update again to switch to accepted revisions`,
  blocked: (why: SaveModeBlocker) =>
    `the team server cannot switch to accepted revisions yet (${why}) — the project keeps saving the old way`,
  importing:
    'switched to accepted revisions — the team server is still bringing changes in; nothing is lost',
} as const;

export interface MigrateOptions {
  repoRoot: string;
  designRel: string;
  direction: 'forward' | 'reverse';
  /** reverse only: also remove v2-only fields (reported in `lost`) */
  strip?: boolean;
  /** from hubs-config; null = unlinked (or no credential for the link) */
  hub?: { url: string; token: string; role: string } | null;
  /**
   * gate-b-sec4 — the committed `linkedHub` this Mac PARKED at boot (`ctx.unconfirmedHub`): the
   * studio runs solo and hands no credential for it. The dry run names that state (`link-unconfirmed`,
   * the app's Connect) instead of reading the raw claim as a link with no sign-in.
   */
  parkedHub?: string | null;
  now?: () => Date;
  /** the studio route runs the engine in-process — the one caller allowed
   *  while a studio has the project open */
  viaStudio?: boolean;
  /** seams (tests, the studio route) */
  hubClient?: HubFormatClient | null;
  liveStudio?: (designRoot: string) => boolean;
  dsEmitter?: DsTokensEmitter | null;
  steps?: readonly MigrationStep[];
  log?: (line: string) => void;
}

export type StepStatus = 'noop' | 'change' | 'skip' | 'refused';

export interface ReportFile {
  path: string;
  action: 'modify' | 'create' | 'remove';
  before: string | null;
  after: string | null;
}

export interface StepReport {
  id: string;
  status: StepStatus;
  files: ReportFile[];
  /** set when `files` was capped at FILE_LIST_CAP */
  filesTotal?: number;
  refusals: Array<{ path: string; reason: string }>;
  lost: Array<{ path: string; field: string; count: number }>;
  notes: string[];
}

export interface MigrateReport {
  format: 'maude.migrate-report';
  v: 1;
  migration: 'v2';
  direction: 'forward' | 'reverse';
  dryRun: boolean;
  project: {
    designRoot: string;
    formatBefore: number;
    formatAfter: number;
    treeHash: string;
    linked: null | {
      hub: string;
      role: string;
      hubFormat: number | null;
      capabilities: string[];
      /** the DDR-241 save mode the hub reported (null: it did not say — no switch is offered) */
      mode?: 'legacy' | 'transactions' | null;
      /** forward: this run also switches the project to accepted revisions */
      modeDue?: boolean;
      /** why the switch cannot run now (the format update still can) */
      modeBlocker?: SaveModeBlocker;
      /** apply: the hub took the switch */
      modeSwitched?: boolean;
      /** apply: why the switch did not happen after the format moved — `token-rejected`, `offline`,
       *  or the hub's own code (p8-update-fails-loud: the app says which, with the action that helps) */
      modeError?: string;
      /** apply: switched, and the hub is still importing the documents (T30) */
      modeImporting?: boolean;
    };
  };
  steps: StepReport[];
  /** refusals that stop the whole run before any step (format, config, lock…). A linked-hub
   *  refusal carries a `code` the app maps to its line (format.ts `olderGateState`). */
  refusals: Array<{ path: string; reason: string; code?: LinkRefusalCode }>;
  totals: { modify: number; create: number; remove: number; refused: number; lost: number };
  snapshot: string | null;
  durationMs: number;
  exitCode: number;
  /** run-level notes (a hub that refused to go back, …) */
  notes?: string[];
  /** set on the stored report of a run that failed and rolled back */
  rolledBack?: boolean;
}

// ─── the tree ────────────────────────────────────────────────────────────────

/** `**` matches zero or more segments but never one starting with `_` or `.`
 *  (runtime state stays out unless a glob names it literally, I6); `*` is
 *  one segment's worth of anything. */
export function matchGlob(glob: string, rel: string): boolean {
  const g = glob.split('/');
  const p = rel.split('/');
  const walk = (gi: number, pi: number): boolean => {
    if (gi === g.length) return pi === p.length;
    const seg = g[gi] as string;
    if (seg === '**') {
      if (walk(gi + 1, pi)) return true;
      for (let k = pi; k < p.length - 1; k++) {
        const s = p[k] as string;
        if (s.startsWith('_') || s.startsWith('.')) return false;
        if (walk(gi + 1, k + 1)) return true;
      }
      return false;
    }
    if (pi >= p.length) return false;
    const re = new RegExp(`^${seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
    return re.test(p[pi] as string) && walk(gi + 1, pi + 1);
  };
  return walk(0, 0);
}

const NEVER_DIRS = new Set(['.git', 'node_modules']);

/** Every file under the design root a scope could name: `_`-dirs only when a
 *  glob names them literally (`_chat/…`). */
function walk(designRoot: string, literalUnderscoreDirs: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const visit = (abs: string, rel: string, depth: number) => {
    if (depth > 12) return;
    let names: string[];
    try {
      names = readdirSync(abs);
    } catch {
      return;
    }
    for (const n of names.sort()) {
      const a = path.join(abs, n);
      const r = rel ? `${rel}/${n}` : n;
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(a);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (NEVER_DIRS.has(n) || n.startsWith('.')) continue;
        if (n.startsWith('_') && !(depth === 0 && literalUnderscoreDirs.has(n))) continue;
        visit(a, r, depth + 1);
      } else if (st.isFile()) out.push(r);
    }
  };
  visit(designRoot, '', 0);
  return out;
}

interface Tree {
  designRoot: string;
  abs(rel: string): string;
  read(rel: string): Uint8Array | null;
  files: string[];
  /** every input read, rel → sha256 (the TOCTOU guard's input) */
  inputs: Map<string, string>;
}

function openTree(repoRoot: string, designRel: string, steps: readonly MigrationStep[]): Tree {
  const designRoot = path.join(repoRoot, designRel);
  const literal = new Set(
    steps
      .flatMap((s) => s.scope)
      .map((g) => g.split('/')[0] as string)
      .filter((s) => s.startsWith('_'))
  );
  literal.add('_chat'); // chats.canvas lists the transcripts too
  const files = walk(designRoot, literal);
  const inputs = new Map<string, string>();
  const tree: Tree = {
    designRoot,
    abs: (rel) => path.join(designRoot, ...rel.split('/')),
    read(rel) {
      try {
        const b = new Uint8Array(readFileSync(tree.abs(rel)));
        inputs.set(rel, sha256(b));
        return b;
      } catch {
        inputs.set(rel, 'absent');
        return null;
      }
    },
    files,
    inputs,
  };
  return tree;
}

function treeHashOf(inputs: ReadonlyMap<string, string>): string {
  const h = createHash('sha256');
  for (const k of [...inputs.keys()].sort()) h.update(`${k}\0${inputs.get(k)}\n`);
  return `sha256:${h.digest('hex')}`;
}

// ─── the prior forward run (exact reverse, I5) ───────────────────────────────

interface PriorForward {
  dir: string; // design-root-relative snapshot dir
  report: MigrateReport;
}

function findPriorForward(designRoot: string): PriorForward | null {
  const base = path.join(designRoot, SNAPSHOT_DIR_REL);
  let names: string[] = [];
  try {
    names = readdirSync(base)
      .filter((n) => n.startsWith('v2-'))
      .sort()
      .reverse();
  } catch {
    return null;
  }
  for (const n of names) {
    try {
      const report = JSON.parse(
        readFileSync(path.join(base, n, 'report.json'), 'utf8')
      ) as MigrateReport;
      if (report.format !== 'maude.migrate-report' || report.rolledBack) continue;
      if (report.direction === 'reverse' && !report.dryRun) return null; // already reversed since
      if (report.direction === 'forward' && !report.dryRun)
        return { dir: path.join(SNAPSHOT_DIR_REL, n), report };
    } catch {
      /* not a run of ours */
    }
  }
  return null;
}

// ─── write ops ───────────────────────────────────────────────────────────────

type Op =
  | { kind: 'write'; rel: string; bytes: Uint8Array; action: 'modify' | 'create' }
  | { kind: 'trash'; rel: string }
  | { kind: 'delete'; rel: string } // a file this migrator created, unedited
  | { kind: 'untrash'; rel: string; from: string }; // put a trashed file back

interface Plan {
  report: MigrateReport;
  ops: Op[];
  prerequisite: boolean;
  hub: { client: HubFormatClient; epoch?: number } | null;
}

function liveStudioDefault(designRoot: string): boolean {
  try {
    const info = JSON.parse(readFileSync(path.join(designRoot, '_server.json'), 'utf8')) as {
      pid?: unknown;
    };
    if (typeof info.pid !== 'number' || info.pid === process.pid) return false;
    process.kill(info.pid, 0);
    return true;
  } catch {
    return false;
  }
}

const emptyTotals = () => ({ modify: 0, create: 0, remove: 0, refused: 0, lost: 0 });

async function plan(opts: MigrateOptions, dryRun: boolean): Promise<Plan> {
  const t0 = performance.now();
  const now = opts.now?.() ?? new Date();
  const steps = opts.steps ?? STEPS;
  const tree = openTree(opts.repoRoot, opts.designRel, steps);
  const report: MigrateReport = {
    format: 'maude.migrate-report',
    v: 1,
    migration: 'v2',
    direction: opts.direction,
    dryRun,
    project: {
      designRoot: opts.designRel,
      formatBefore: 1,
      formatAfter: 1,
      treeHash: '',
      linked: null,
    },
    steps: [],
    refusals: [],
    totals: emptyTotals(),
    snapshot: null,
    durationMs: 0,
    exitCode: EXIT.done,
  };
  const out: Plan = { report, ops: [], prerequisite: false, hub: null };
  const finish = () => {
    report.project.treeHash = treeHashOf(tree.inputs);
    report.totals.refused =
      report.refusals.length + report.steps.reduce((n, s) => n + s.refusals.length, 0);
    report.totals.lost = report.steps.reduce(
      (n, s) => n + s.lost.reduce((m, l) => m + l.count, 0),
      0
    );
    report.exitCode =
      report.totals.refused > 0
        ? EXIT.refused
        : report.steps.every((s) => s.status === 'noop' || s.status === 'skip') &&
            report.project.linked?.modeDue !== true
          ? EXIT.atTarget
          : EXIT.done;
    report.durationMs = Math.round(performance.now() - t0);
    return out;
  };
  const refuse = (reason: string, p = '', code?: LinkRefusalCode) => {
    report.refusals.push({ path: p, reason, ...(code ? { code } : {}) });
    return finish();
  };

  // ── global gates ──
  const cfgBytes = tree.read('config.json');
  if (!cfgBytes) return refuse('config.json is missing', 'config.json');
  let config: Record<string, unknown>;
  try {
    const v = JSON.parse(new TextDecoder().decode(cfgBytes)) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    config = v as Record<string, unknown>;
  } catch {
    return refuse('config.json is not JSON', 'config.json');
  }
  const local = asFormat(config.formatVersion);
  const linkUrl = (config.linkedHub as { url?: unknown } | undefined)?.url;
  let hubFormat: number | null = null;
  if (typeof linkUrl === 'string' && linkUrl) {
    const client =
      opts.hubClient !== undefined
        ? opts.hubClient
        : opts.hub
          ? createHubFormatClient(opts.hub)
          : null;
    const role = opts.hub?.role ?? 'unknown';
    report.project.linked = { hub: linkUrl, role, hubFormat: null, capabilities: [] };
    if (opts.parkedHub && normLinkUrl(opts.parkedHub) === normLinkUrl(linkUrl))
      return refuse(
        'this project says it syncs with a team server, but that link was not made on this Mac — connect it first',
        '',
        'link-unconfirmed'
      );
    if (!client)
      return refuse(
        'this project is linked, and this Mac has no sign-in for its team server',
        '',
        'no-sign-in'
      );
    const health = await client.health();
    if (!health.ok)
      return refuse(
        'the team server cannot be reached — updating the project needs it',
        '',
        'offline'
      );
    hubFormat = health.formatVersion;
    report.project.linked = { hub: linkUrl, role, hubFormat, capabilities: health.capabilities };
    if (!health.capabilities.includes('format-v2'))
      return refuse(
        'the team server needs an update before this project can move to Maude 2',
        '',
        'hub-too-old'
      );
    // The hub's own bar (v2-2.18-format-owner-bar): an owner of the whole project — a hub
    // `admin` is the owner there (access/roles.ts projectRoleForAccount).
    if (projectRoleForAccount(role) !== 'owner')
      return refuse("only the project's owner can update it for Maude 2", '', 'not-owner');
    out.hub = { client, ...(typeof health.epoch === 'number' ? { epoch: health.epoch } : {}) };
    const saveMode = await planSaveMode(client, health, opts.direction);
    // `/health` is unauthenticated; the mode read is the first call that carries the credential.
    // A hub that turns it down would refuse the format flip too — say so BEFORE anything is
    // touched, with the code the app turns into "Sign in again" (p8-update-fails-loud).
    if (saveMode === 'token-rejected') {
      report.project.formatBefore = report.project.formatAfter = Math.max(local, hubFormat ?? 1);
      return refuse(
        "the team server turned down this Mac's sign-in — sign in again to update the project",
        '',
        'token-rejected'
      );
    }
    report.project.linked = { ...report.project.linked, ...saveMode };
  }
  const before = Math.max(local, hubFormat ?? 1);
  report.project.formatBefore = before;
  report.project.formatAfter = before;
  if (before > TARGET_FORMAT)
    return refuse(`this project uses format ${before}, newer than this build`);
  if (opts.direction === 'reverse' && before !== TARGET_FORMAT)
    return refuse('this project is not at format 2, so there is nothing to reverse');
  if (!dryRun) {
    // A dry run only reads, so a studio that has the project open is fine;
    // an apply would write under it.
    if (!opts.viaStudio && (opts.liveStudio ?? liveStudioDefault)(tree.designRoot))
      return refuse('Close the project in Maude, or use Update project in the app');
    // a lock another run holds is a refusal, not a wait
    const lock = path.join(tree.designRoot, MIGRATE_LOCK_REL);
    if (existsSync(lock)) {
      try {
        const pid = Number(readFileSync(lock, 'utf8').split('\n')[0]);
        if (pid && pid !== process.pid) {
          process.kill(pid, 0);
          return refuse('another migration of this project is running');
        }
      } catch {
        /* a dead holder — apply takes it over */
      }
    }
  }

  // ── steps ──
  const ctx: StepCtx = {
    designRoot: tree.designRoot,
    now,
    direction: opts.direction,
    config,
    list: (glob) => tree.files.filter((f) => matchGlob(glob, f)),
    read: (rel) => tree.read(rel),
    readHead: (rel, maxBytes = 256 * 1024) => {
      const { lines } = readHeadLines(tree.abs(rel), maxBytes);
      tree.inputs.set(`${rel}#head`, sha256(lines.join('\n')));
      return lines;
    },
    ds: opts.dsEmitter !== undefined ? opts.dsEmitter : defaultDsEmitter(),
  };
  const prior = opts.direction === 'reverse' ? findPriorForward(tree.designRoot) : null;
  const claimed = new Set<string>();

  for (const step of steps) {
    const files = new Map<string, Uint8Array>();
    for (const rel of new Set(
      step.scope.flatMap((g) => (g === 'config.json' ? ['config.json'] : ctx.list(g)))
    )) {
      const b = tree.read(rel);
      if (b) files.set(rel, b);
    }
    let res: StepResult;
    try {
      res =
        opts.direction === 'forward'
          ? step.forward(files, ctx)
          : step.reverse(files, ctx, { strip: !!opts.strip });
    } catch (err) {
      res = {
        writes: new Map(),
        refusals: [{ path: '', reason: `step failed: ${(err as Error).message}` }],
        lost: [],
        notes: [],
      };
    }
    const sr: StepReport = {
      id: step.id,
      status: 'noop',
      files: [],
      refusals: res.refusals,
      lost: res.lost,
      notes: res.notes,
    };

    if (opts.direction === 'reverse' && prior) {
      // I5 — exact reverse for what the forward run recorded under this step.
      for (const f of prior.report.steps.find((s) => s.id === step.id)?.files ?? []) {
        if (claimed.has(f.path)) continue;
        if (f.before === null && f.after === null) continue; // a prerequisite — never reversed
        const cur = tree.read(f.path);
        const curHash = cur ? sha256(cur) : null;
        if (f.action === 'modify' && curHash === f.after) {
          const snap = tree.read(`${prior.dir.split(path.sep).join('/')}/${f.path}`);
          if (snap) {
            res.writes.set(f.path, snap);
            claimed.add(f.path);
          }
        } else if (f.action === 'create' && curHash === f.after) {
          res.writes.delete(f.path);
          out.ops.push({ kind: 'delete', rel: f.path });
          sr.files.push({ path: f.path, action: 'remove', before: curHash, after: null });
          claimed.add(f.path);
        } else if (f.action === 'remove' && !cur) {
          const from = `${TRASH_DIR_REL.split(path.sep).join('/')}/${f.path}`;
          if (existsSync(tree.abs(from))) {
            out.ops.push({ kind: 'untrash', rel: f.path, from });
            sr.files.push({ path: f.path, action: 'create', before: null, after: f.before });
            claimed.add(f.path);
          }
        } else if (f.action !== 'remove') {
          sr.notes.push(`${f.path} changed since the update — reversed by content, not restored`);
        } else {
          sr.notes.push(
            `${f.path} exists again — the copy the update set aside stays in the trash`
          );
        }
      }
    }

    for (const [rel, b] of res.writes) {
      const cur = tree.read(rel);
      if (b === null) {
        if (!cur) continue;
        out.ops.push({ kind: 'trash', rel });
        sr.files.push({ path: rel, action: 'remove', before: sha256(cur), after: null });
        continue;
      }
      if (cur && sha256(cur) === sha256(b)) continue;
      const action = cur ? 'modify' : 'create';
      out.ops.push({ kind: 'write', rel, bytes: b, action });
      sr.files.push({ path: rel, action, before: cur ? sha256(cur) : null, after: sha256(b) });
    }
    for (const p of res.prerequisite ?? []) {
      out.prerequisite = true;
      sr.files.push({ path: p.path, action: p.action, before: null, after: null });
      sr.notes.push(`${p.path}: ${p.note}`);
    }
    sr.status = res.refusals.length
      ? 'refused'
      : res.skip
        ? 'skip'
        : sr.files.length
          ? 'change'
          : 'noop';
    if (res.skip) sr.notes.push(`skipped — ${res.skip}`);
    for (const f of sr.files) report.totals[f.action] += 1;
    report.steps.push(sr);
  }
  // The hub is part of the marker: a link whose server still has to move
  // (first link of a format-2 project, M12; a reverse that crashed between
  // its last local write and the unflip, I7) is a change even when no local
  // byte is.
  const markerStep = report.steps.find((s) => s.id === 'project.marker');
  const hubTarget = opts.direction === 'forward' ? TARGET_FORMAT : 1;
  if (markerStep && out.hub && hubFormat !== hubTarget && markerStep.status === 'noop') {
    markerStep.status = 'change';
    markerStep.notes.push(`the team server moves to format ${hubTarget}`);
  }
  const refused = report.steps.some((s) => s.status === 'refused');
  if (!refused) report.project.formatAfter = opts.direction === 'forward' ? TARGET_FORMAT : 1;
  // A blocked switch: refused when it was the only thing left to do (a format-2 project that
  // still saves the old way); otherwise the format update goes ahead and the report says so.
  const blocker = report.project.linked?.modeBlocker;
  if (blocker) {
    const formatWork = report.steps.some((s) => s.status !== 'noop' && s.status !== 'skip');
    if (!formatWork) return refuse(SAVE_MODE_NOTE.blocked(blocker), '', blocker);
    report.notes = [...(report.notes ?? []), SAVE_MODE_NOTE.blocked(blocker)];
  }
  return finish();
}

/** A hub address as a link compares it: trailing slashes are the same hub. */
const normLinkUrl = (u: string) => u.trim().replace(/\/+$/, '');

type LinkedReport = NonNullable<MigrateReport['project']['linked']>;

/** 401/403 from an authenticated hub route: the credential, not the hub, is the problem. */
const isAuthRefusal = (status: number) => status === 401 || status === 403;

/** A hub refusal → the code the app words (token-rejected · offline · the hub's own code). */
function hubFailureCode(r: { status: number; code?: string }): string {
  if (isAuthRefusal(r.status)) return 'token-rejected';
  if (r.status === 0) return 'offline';
  return r.code ?? String(r.status);
}

/**
 * Read the hub's save mode; forward on a `legacy` project, mark the switch due — or name what
 * blocks it, from `/health` (`coordinator.durable`) and the hub's own dry run (its `blockers`).
 * A hub that does not answer the mode route runs no coordinator: no switch is offered.
 */
async function planSaveMode(
  client: HubFormatClient,
  health: HubHealth,
  direction: MigrateOptions['direction']
): Promise<Partial<LinkedReport> | 'token-rejected'> {
  const m = await client.mode();
  if (!m.ok && isAuthRefusal(m.status)) return 'token-rejected';
  if (!m.ok) return { mode: null, modeSwitched: false };
  const base = { mode: m.mode, modeSwitched: false } as const;
  // `--reverse` keeps accepted revisions (Michal): the mode is reported, never planned.
  if (direction !== 'forward' || m.mode !== 'legacy') return base;
  if (health.coordinator && !health.coordinator.durable)
    return { ...base, modeBlocker: 'store-not-durable' };
  const dry = await client.setMode('transactions', m.epoch, { dryRun: true });
  if (!dry.ok)
    return { ...base, modeBlocker: dry.status === 403 ? 'mode-forbidden' : 'mode-unavailable' };
  if (dry.blockers.includes('browser-not-paired'))
    return { ...base, modeBlocker: 'browser-not-paired' };
  return { ...base, modeDue: true };
}

/**
 * The switch itself — after every local write. The epoch is read AGAIN here: the format flip
 * advanced it, and the hub refuses a stale one (409 `epoch-stale`); a stale answer is re-read
 * once (another writer moved it in between). Never throws: the format update already landed,
 * so a failure is a note that says so, and the next Update finds the mode still `legacy`.
 */
async function switchSaveMode(
  client: HubFormatClient,
  linked: LinkedReport,
  notes: string[],
  log: (line: string) => void
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const m = await client.mode();
    if (!m.ok) {
      linked.modeError = hubFailureCode(m);
      notes.push(SAVE_MODE_NOTE.failed(m.code ?? String(m.status)));
      return;
    }
    if (m.mode === 'transactions') {
      // switched already — by another owner, or a switch whose answer we did not get
      linked.modeSwitched = true;
      if (m.importPending) {
        linked.modeImporting = true;
        notes.push(SAVE_MODE_NOTE.importing);
      }
      return;
    }
    const r = await client.setMode('transactions', m.epoch);
    if (r.ok) {
      linked.modeSwitched = true;
      log(`[migrate] the team server now saves with accepted revisions (epoch ${r.epoch})`);
      if (r.importPending) {
        // T30: the switch is persisted and peers are fenced; the import resumes on the hub
        // until it lands. Switched — not a failure.
        linked.modeImporting = true;
        notes.push(SAVE_MODE_NOTE.importing);
      }
      return;
    }
    if (r.code === 'epoch-stale' && attempt === 0) continue;
    linked.modeError = hubFailureCode(r);
    notes.push(SAVE_MODE_NOTE.failed(r.code ?? String(r.status)));
    return;
  }
}

/** The printed report: file lists capped at FILE_LIST_CAP per step, with the
 *  count. The snapshot's own `report.json` keeps every file (exact reverse). */
export function capReport(report: MigrateReport): MigrateReport {
  return {
    ...report,
    steps: report.steps.map((s) =>
      s.files.length > FILE_LIST_CAP
        ? { ...s, files: s.files.slice(0, FILE_LIST_CAP), filesTotal: s.files.length }
        : s
    ),
  };
}

/** Read-only — the dry-run (I1). Returns the FULL report (`capReport` for output). */
export async function planMigration(opts: MigrateOptions): Promise<MigrateReport> {
  return (await plan(opts, true)).report;
}

function stampOf(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.(\d{3})Z$/, '$1Z');
}

/**
 * Apply. Re-plans against the tree as it is now and refuses (exit 11, nothing
 * written) when its tree hash differs from `dryRunPlan.project.treeHash`.
 */
export async function applyMigration(
  opts: MigrateOptions,
  dryRunPlan: MigrateReport
): Promise<MigrateReport> {
  const t0 = performance.now();
  const p = await plan(opts, false);
  const { report } = p;
  if (report.exitCode === EXIT.refused) return report;
  if (report.project.treeHash !== dryRunPlan.project.treeHash) {
    report.refusals.push({
      path: '',
      reason: 'the project changed since the dry run — run it again',
    });
    report.totals.refused += 1;
    report.exitCode = EXIT.refused;
    return report;
  }
  if (report.exitCode === EXIT.atTarget) return report;

  const designRoot = path.join(opts.repoRoot, opts.designRel);
  const abs = (rel: string) => path.join(designRoot, ...rel.split('/'));
  const log = opts.log ?? (() => {});
  const now = opts.now?.() ?? new Date();

  // I3 — the lock, then the snapshot BEFORE the first write.
  const lockAbs = path.join(designRoot, MIGRATE_LOCK_REL);
  mkdirSync(path.dirname(lockAbs), { recursive: true });
  rmSync(lockAbs, { force: true }); // plan() refused a LIVE holder; this one is dead
  writeFileSync(lockAbs, `${process.pid}\n${now.toISOString()}\n`, { flag: 'wx' });
  const release = () => rmSync(lockAbs, { force: true });

  try {
    let snapRel = path.join(SNAPSHOT_DIR_REL, `v2-${stampOf(now)}`);
    for (let n = 2; existsSync(path.join(designRoot, snapRel)); n++)
      snapRel = path.join(SNAPSHOT_DIR_REL, `v2-${stampOf(now)}-${n}`);
    const snapAbs = path.join(designRoot, snapRel);
    const snapped = new Map<string, Uint8Array>();
    try {
      mkdirSync(snapAbs, { recursive: true });
      for (const op of p.ops) {
        if (op.kind === 'untrash') continue;
        if (op.kind === 'write' && op.action === 'create') continue;
        const b = new Uint8Array(readFileSync(abs(op.rel)));
        snapped.set(op.rel, b);
        const to = path.join(snapAbs, ...op.rel.split('/'));
        mkdirSync(path.dirname(to), { recursive: true });
        writeFileSync(to, b);
      }
      report.snapshot = snapRel.split(path.sep).join('/');
      writeFileSync(path.join(snapAbs, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    } catch (err) {
      // Fail closed (DDR-102 §3): no snapshot, no run.
      report.refusals.push({
        path: '',
        reason: `could not snapshot the project: ${(err as Error).message}`,
      });
      report.totals.refused += 1;
      report.exitCode = EXIT.refused;
      report.snapshot = null;
      rmSync(snapAbs, { recursive: true, force: true });
      return report;
    }

    // I7 — forward: the hub flips BEFORE the first local write. `flipped` holds the epoch the
    // flip answered with: a local failure below puts the hub back (p8-v1-drop), so a teammate
    // never sees a format-2 project whose files on this Mac stayed format 1.
    let flipped: { from: 1; epoch: number } | null = null;
    const unflip = async () => {
      if (!flipped || !p.hub) return;
      const back = await p.hub.client.setFormat(flipped.from, flipped.epoch).catch(() => null);
      if (back?.ok)
        log(`[migrate] a local write failed — the team server is back at format ${flipped.from}`);
      else
        log(
          '[migrate] a local write failed and the team server did not go back — run Update again to finish'
        );
    };
    if (
      opts.direction === 'forward' &&
      p.hub &&
      (report.project.linked?.hubFormat ?? 1) !== TARGET_FORMAT
    ) {
      const r = await p.hub.client.setFormat(TARGET_FORMAT, p.hub.epoch);
      if (!r.ok) {
        const code = hubFailureCode(r);
        report.refusals.push({
          path: '',
          reason: `the team server refused the update (${r.code ?? r.status})`,
          ...(code === 'token-rejected' || code === 'offline'
            ? { code: code as LinkRefusalCode }
            : {}),
        });
        report.totals.refused += 1;
        report.exitCode = EXIT.refused;
        report.snapshot = null;
        rmSync(snapAbs, { recursive: true, force: true }); // nothing was written
        return report;
      }
      log(`[migrate] the team server now says format ${TARGET_FORMAT} (epoch ${r.epoch})`);
      flipped = { from: 1, epoch: r.epoch };
    }

    // Stage, then apply all-or-nothing.
    const done: Op[] = [];
    try {
      // The DDR-242 prerequisite (legacy boards) — its own originals-kept rules.
      if (p.prerequisite && opts.direction === 'forward') migrateAnnotationsV2({ designRoot, log });
      const staged = new Map<string, string>();
      for (const op of p.ops) {
        if (op.kind !== 'write') continue;
        const tmp = `${abs(op.rel)}.migrate-v2.tmp`;
        mkdirSync(path.dirname(tmp), { recursive: true });
        writeFileSync(tmp, op.bytes);
        staged.set(op.rel, tmp);
      }
      for (const op of p.ops) {
        if (op.kind === 'write') renameSync(staged.get(op.rel) as string, abs(op.rel));
        else if (op.kind === 'trash') {
          let to = path.join(designRoot, TRASH_DIR_REL, ...op.rel.split('/'));
          if (existsSync(to)) to = `${to}.${stampOf(now)}`;
          mkdirSync(path.dirname(to), { recursive: true });
          renameSync(abs(op.rel), to);
        } else if (op.kind === 'delete') rmSync(abs(op.rel), { force: true });
        else {
          mkdirSync(path.dirname(abs(op.rel)), { recursive: true });
          renameSync(path.join(designRoot, ...op.from.split('/')), abs(op.rel));
        }
        done.push(op);
      }
    } catch (err) {
      // Roll back what landed, from the snapshot.
      for (const op of done.reverse()) {
        try {
          if (op.kind === 'untrash')
            renameSync(abs(op.rel), path.join(designRoot, ...op.from.split('/')));
          else if (op.kind === 'write' && op.action === 'create')
            rmSync(abs(op.rel), { force: true });
          else {
            const b = snapped.get(op.rel);
            if (b) writeFileSync(abs(op.rel), b);
          }
        } catch {
          /* best effort; the snapshot stays on disk */
        }
      }
      for (const op of p.ops)
        if (op.kind === 'write') rmSync(`${abs(op.rel)}.migrate-v2.tmp`, { force: true });
      try {
        writeFileSync(
          path.join(snapAbs, 'report.json'),
          `${JSON.stringify({ ...report, rolledBack: true, exitCode: EXIT.error }, null, 2)}\n`
        );
      } catch {
        /* the snapshot copies are what matter */
      }
      await unflip();
      throw err;
    }

    // I7 — reverse: the hub unflips AFTER the last local write.
    if (opts.direction === 'reverse' && p.hub && (report.project.linked?.hubFormat ?? 1) !== 1) {
      const r = await p.hub.client.setFormat(1, p.hub.epoch);
      if (!r.ok) {
        report.notes = [
          `the team server refused to go back (${r.code ?? r.status}) — run --reverse again`,
        ];
        report.exitCode = EXIT.error;
        writeFileSync(path.join(snapAbs, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
        return report;
      }
    }
    // The save mode — LAST (forward only): after the hub flip and after every local write, so a
    // local failure above (rolled back, thrown) never leaves a project switched but not updated.
    const linked = report.project.linked;
    if (opts.direction === 'forward' && p.hub && linked?.modeDue) {
      const notes = report.notes ?? [];
      await switchSaveMode(p.hub.client, linked, notes, log);
      if (notes.length) report.notes = notes;
    }
    report.durationMs = Math.round(performance.now() - t0);
    writeFileSync(path.join(snapAbs, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    release();
  }
}
