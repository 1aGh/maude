// The design-system engine — V2-1.6 §5.9–§5.11, S10 Q1. Every review effect of a converted system
// is ONE action, whatever planes it touches:
//
//   publish        (c) "Update N canvases"      revision R → working files → metas (one kernel
//                                                action) → head.json (head = base = R)
//   cancelPending  (c) Cancel                    the DS canvas meta (one kernel action)
//   mergePending   §5.9 propose                  the DS canvas meta, merged per token
//   keepOutside    (a) Keep                      revision K = the working files → head.json base = K
//   undoOutside    (a) Undo                      the working files rewritten from base
//   pick           (b) "Use this"                canvas: patch working → K; file: K = working;
//                                                either way the pending entry goes (kernel) + base = K
//   pickPublished  §5.7 "Published in two places" head = base = the chosen copy's head
//   canvasUpdate / canvasLeave (d)               a canvas's `dsRev` (+ its `data-ds-rev="head"`)
//   trashToken / restoreToken / clearToken (e)   publishes with every follower ticked
//
// Plane B (revisions, siblings, working files, head.json) is written by this module in the §5.6
// order, tmp + rename, head.json LAST and only through `ds/head.ts` against the pointers read.
// Plane A (canvas metas and TSX) is NEVER written here: it goes through the kernel port as one
// proposal, so an accepted publish is one Version-history entry and one ⌘Z. The head.json log
// entry records that action's id, and `ds/undo-hook.ts` moves the pointers back when the kernel
// undoes (or redoes) it.
//
// All operations of one system run one at a time (an in-process lock per system folder). Values,
// labels and value names are data (DDR-172 D8) — they are compared and written, never obeyed.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';

import { atomicWrite } from '../sync/atomic-write.ts';
import { modesOf } from './board/types.ts';
import { followedDark } from './contrast.ts';
import { canvasSystemFor } from './ds-resolver.ts';
import {
  type ComponentEdit,
  emitTokensJson,
  type GenConfig,
  generateComponentsCss,
  generateTokensCss,
  type Json,
  type ModelToken,
  normalizeModel,
  parseSystem,
  type TokenModel,
} from './generate.ts';
import {
  type By,
  HEAD_REL,
  type HeadDoc,
  type LogAction,
  type LogEntry,
  type Pointers,
  publishedInTwoPlaces,
  readHead,
  settleAsideHeads,
  writeHead,
} from './head.ts';
import { indexRegistry, loadRegistry } from './registry.ts';
import {
  type BuiltRevision,
  buildRevision,
  COMPONENTS_CSS_KEY,
  type RevisionBody,
  revisionWritePlan,
  serializeRevision,
  sha256Hex,
  verifyRevision,
} from './revision.ts';
import { type SystemConfig, systemConfigsFrom } from './system.ts';

export const DS_CANVAS = 'design-system.tsx';
export const DS_META = 'design-system.meta.json';
export const TOKENS_JSON_KEY = 'tokens.json';
export const COMPONENTS_JSON_KEY = 'components.json';
/** the kernel action kind every DS gesture commits as — a person's edit, so ⌘Z reaches it */
export const DS_ACTION_KIND = 'edit';

/* ------------------------------------------------------------------ errors */

export type EngineErrorCode =
  | 'ds-unknown-system'
  | 'ds-not-converted'
  | 'ds-head-moved'
  | 'ds-head-invalid'
  | 'ds-outside-unreviewed'
  | 'ds-conflict'
  | 'ds-two-places'
  | 'ds-library'
  | 'ds-nothing-waiting'
  | 'ds-revision-missing'
  | 'ds-revision-invalid'
  | 'ds-pending-conflict'
  | 'ds-pending-invalid'
  | 'ds-token-locked'
  | 'ds-nothing-to-push'
  | 'ds-no-canvas'
  | 'ds-not-in-system'
  | 'ds-no-outside'
  | 'ds-no-conflict'
  | 'ds-unknown-token'
  | 'ds-trash-tier1'
  | 'ds-not-trashed'
  | 'ds-kernel-unavailable'
  | 'ds-kernel-rejected'
  // S10.16a (making a system)
  | 'ds-making'
  | 'ds-not-making'
  | 'ds-exists'
  | 'ds-unknown-direction'
  | 'ds-unknown-group'
  | 'ds-nothing-made'
  | 'ds-make-invalid';

const STATUS: Partial<Record<EngineErrorCode, number>> = {
  'ds-unknown-system': 404,
  'ds-not-in-system': 404,
  'ds-unknown-token': 404,
  'ds-pending-invalid': 422,
  'ds-token-locked': 422,
  'ds-nothing-to-push': 422,
  'ds-revision-invalid': 422,
  'ds-head-invalid': 422,
  'ds-kernel-unavailable': 503,
  'ds-unknown-direction': 404,
  'ds-unknown-group': 422,
  'ds-nothing-made': 422,
  'ds-make-invalid': 422,
};

export class DsEngineError extends Error {
  readonly code: EngineErrorCode;
  readonly status: number;
  readonly detail?: Record<string, unknown>;
  constructor(code: EngineErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'DsEngineError';
    this.code = code;
    this.status = STATUS[code] ?? 409;
    if (detail) this.detail = detail;
  }
}

let roles: Set<string> | null = null;
/** the V2-1.13 registry's Tier-1 role names (they can't be trashed) */
const tier1 = (): Set<string> => {
  if (!roles) roles = new Set(indexRegistry(loadRegistry()).roles.keys());
  return roles;
};

const fail = (code: EngineErrorCode, m: string, d?: Record<string, unknown>) =>
  new DsEngineError(code, m, d);

/* ------------------------------------------------------------- the kernel */

export interface KernelOutcome {
  status: 'accepted' | 'rejected';
  code?: string;
  actionId?: string;
}

/** The Plane-A half: several canvas files proposed as ONE action (S10 Q1). */
export interface DsKernelPort {
  /** null: no home answers right now (a linked project not in accepted mode) */
  propose(
    files: { rel: string; text: string }[],
    action: { kind: string; label: string }
  ): Promise<KernelOutcome | null>;
}

/**
 * The port over `ctx.syncControl.current()`: the local home answers `proposeFiles` (S10.2), and
 * so does a linked hub's sync runtime in accepted mode (S10.3b; null outside it). A runtime
 * without it answers null, and every DS write that needs the kernel refuses
 * `ds-kernel-unavailable` rather than writing metas behind the log's back.
 */
export function kernelPortFrom(control: () => unknown): () => DsKernelPort | null {
  return () => {
    const rt = control() as
      | { proposeFiles?: (f: unknown, a: unknown) => Promise<KernelOutcome | null> }
      | null
      | undefined;
    if (!rt || typeof rt.proposeFiles !== 'function') return null;
    const fn = rt.proposeFiles.bind(rt);
    return { propose: (files, action) => fn(files, action) };
  };
}

/* ------------------------------------------------------------------- types */

export interface ThemeValues {
  [theme: string]: string;
}

export interface PendingToken {
  /** per theme: the concrete value (§5.3) */
  [theme: string]: unknown;
  valueNames?: Record<string, string>;
  darkFollows?: boolean;
  trash?: { replacement: string };
  add?: { tier?: number; type?: string; label?: string };
  by?: By;
  at?: string;
}

export interface PendingComponents {
  [component: string]: {
    [selector: string]: { [property: string]: { value: string; by?: By; at?: string } };
  };
}

export interface DsPending {
  base?: string | null;
  tokens?: Record<string, PendingToken>;
  components?: PendingComponents;
  [k: string]: unknown;
}

export interface TokenChange {
  css: string;
  label: string | null;
  before: ThemeValues | null;
  after: ThemeValues | null;
  trashed?: { replacement: string } | null;
}

export interface CanvasRow {
  /** design-root-relative */
  path: string;
  folder: string;
  state: 'follows' | 'left-out' | 'pinned';
  dsRev: string | null;
  ticked: boolean;
  reason?: string;
}

export interface Conflict {
  css: string;
  label: string | null;
  canvas: ThemeValues;
  file: ThemeValues;
}

export interface DsState {
  name: string;
  path: string;
  converted: boolean;
  headState: 'ok' | 'absent' | 'invalid' | 'unreadable';
  head: string | null;
  base: string | null;
  drafts: HeadDoc['drafts'];
  library: Record<string, unknown> | null;
  /** base revision unavailable here (not delivered yet, or invalid) */
  baseMissing: boolean;
  outside: {
    files: string[];
    changes: TokenChange[];
    otherChanges: { path: string; count: number }[];
  } | null;
  pending: DsPending;
  waiting: TokenChange[];
  conflicts: Conflict[];
  leftOut: { count: number; canvases: string[] };
  trashed: {
    kind: 'token';
    system: string;
    css: string;
    label: string | null;
    replacement: string;
    at: string | null;
    by: By | null;
  }[];
  publishedInTwoPlaces: ReturnType<typeof publishedInTwoPlaces>;
}

export interface DsResult {
  action: string;
  rev: string | null;
  actionId: string | null;
}

export interface PublishResult extends DsResult {
  updated: number;
  leftOut: number;
  summary: string;
}

export interface EngineOptions {
  /** absolute design root */
  designRoot: string;
  kernel: DsKernelPort | null | (() => DsKernelPort | null);
  now?: () => number;
  log?: Pick<Console, 'warn' | 'error'>;
}

/* ----------------------------------------------------------------- helpers */

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const CSS_NAME_RE = /^--[A-Za-z0-9_-]{1,128}$/;
const DISPLAY_RE = /^\P{Cc}{0,64}$/u;
const VALUE_MAX = 2000;
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp};{}]/u;
const STRIP_HEAD_PIN = /\s+data-ds-rev=(?:"head"|'head'|\{\s*["']head["']\s*\})/g;

function setOwn(o: Record<string, unknown>, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

/** One lock per system folder, shared by every engine in this process. */
const locks = new Map<string, Promise<unknown>>();
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}

function readText(abs: string): string | null {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function readJsonObj(abs: string): Record<string, unknown> | null {
  const t = readText(abs);
  if (t === null) return null;
  try {
    const v = JSON.parse(t);
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

const metaText = (o: Record<string, unknown>) => `${JSON.stringify(o, null, 2)}\n`;
const metaRelOf = (canvasRel: string) => canvasRel.replace(/\.tsx$/i, '.meta.json');

function sameValues(a: ThemeValues | null, b: ThemeValues | null): boolean {
  const ka = Object.keys(a ?? {}).sort();
  const kb = Object.keys(b ?? {}).sort();
  if (ka.join('\0') !== kb.join('\0')) return false;
  return ka.every((k) => (a as ThemeValues)[k] === (b as ThemeValues)[k]);
}

const labelOf = (t: ModelToken | undefined): string | null =>
  t && typeof t.data.label === 'string' ? t.data.label : null;

const trashOf = (t: ModelToken | undefined): { replacement: string } | null => {
  const tr = t?.data.trashed;
  return isObj(tr) && typeof tr.replacement === 'string' ? { replacement: tr.replacement } : null;
};

/** The token-level diff a → b (both normalised), per theme; trash state counts as a change. */
export function tokenDiff(a: TokenModel | null, b: TokenModel | null): TokenChange[] {
  const A = a ? normalizeModel(a).tokens : {};
  const B = b ? normalizeModel(b).tokens : {};
  const out: TokenChange[] = [];
  for (const css of [...new Set([...Object.keys(A), ...Object.keys(B)])].sort()) {
    const before = A[css]?.values ?? null;
    const after = B[css]?.values ?? null;
    const ta = trashOf(A[css]);
    const tb = trashOf(B[css]);
    if (sameValues(before, after) && (ta?.replacement ?? null) === (tb?.replacement ?? null))
      continue;
    out.push({
      css,
      label: labelOf(B[css]) ?? labelOf(A[css]),
      before,
      after,
      ...(ta || tb ? { trashed: tb } : {}),
    });
  }
  return out;
}

function themeValuesOf(entry: PendingToken, themes: string[]): ThemeValues {
  const out: ThemeValues = {};
  for (const t of themes) if (typeof entry[t] === 'string') out[t] = (entry[t] as string).trim();
  return out;
}

function summaryOf(changes: TokenChange[], comps: number): string {
  const n = changes.length + comps;
  if (n === 1 && changes.length === 1) {
    const c = changes[0];
    const name = c.label ?? c.css;
    if (c.trashed) return `${name} → the trash`.slice(0, 200);
    const after = c.after ? Object.values(c.after)[0] : null;
    return `${name} → ${after ?? 'removed'}`.slice(0, 200);
  }
  return n === 1 ? '1 change' : `${n} changes`;
}

/* ------------------------------------------------------------------ engine */

export function createDsEngine(opts: EngineOptions) {
  const designRoot = path.resolve(opts.designRoot);
  const now = opts.now ?? Date.now;
  const log = opts.log ?? console;
  const kernelNow = (): DsKernelPort | null =>
    typeof opts.kernel === 'function' ? opts.kernel() : opts.kernel;
  const iso = () => new Date(now()).toISOString();

  function config(): Record<string, unknown> {
    return readJsonObj(path.join(designRoot, 'config.json')) ?? {};
  }

  function systems(): SystemConfig[] {
    return systemConfigsFrom(config());
  }

  function system(ds: string): SystemConfig {
    const s = systems().find((x) => x.name === ds);
    if (!s) throw fail('ds-unknown-system', `no design system named ${String(ds).slice(0, 64)}`);
    return s;
  }

  const dsAbs = (s: SystemConfig) => path.join(designRoot, s.path);
  const tokensKey = (s: SystemConfig) => path.posix.relative(s.path, s.tokensCssRel);
  const workingKeys = (s: SystemConfig) => [
    tokensKey(s),
    TOKENS_JSON_KEY,
    COMPONENTS_JSON_KEY,
    COMPONENTS_CSS_KEY,
  ];
  const genConfig = (s: SystemConfig): GenConfig => ({
    name: s.name,
    rootClass: s.rootClass,
    themes: s.themes,
    defaultTheme: s.themeDefault,
    colorSpace: s.colorSpace,
  });

  function working(s: SystemConfig): Record<string, string> {
    const out: Record<string, string> = {};
    for (const k of workingKeys(s)) {
      const t = readText(path.join(dsAbs(s), k));
      if (t !== null) setOwn(out, k, t);
    }
    return out;
  }

  /** A verified revision's body; null when it has not arrived; throws when invalid. */
  function loadRevision(s: SystemConfig, id: string | null): RevisionBody | null {
    if (!id) return null;
    const t = readText(path.join(dsAbs(s), 'revisions', `${id}.json`));
    if (t === null) return null;
    const v = verifyRevision(id, t);
    if (!v.ok) {
      if (v.reason === 'unreadable') return null;
      throw fail('ds-revision-invalid', `revision ${id.slice(0, 12)} is invalid (${v.detail})`);
    }
    return v.body;
  }

  const filesOf = (b: RevisionBody | null): Record<string, string> => {
    const out: Record<string, string> = {};
    if (b) for (const [k, f] of Object.entries(b.files)) setOwn(out, k, f.text);
    return out;
  };

  function modelOf(s: SystemConfig, files: Record<string, string> | null): TokenModel | null {
    if (!files) return null;
    return parseSystem({
      config: genConfig(s),
      tokensCss: files[tokensKey(s)] ?? null,
      tokensJson: files[TOKENS_JSON_KEY] ?? null,
    });
  }

  const dsCanvasRel = (s: SystemConfig) => `${s.path}/${DS_CANVAS}`;
  const dsMetaRel = (s: SystemConfig) => `${s.path}/${DS_META}`;

  function dsMeta(s: SystemConfig): Record<string, unknown> {
    return readJsonObj(path.join(designRoot, dsMetaRel(s))) ?? {};
  }

  function pendingOf(s: SystemConfig): DsPending {
    const p = dsMeta(s).dsPending;
    return isObj(p) ? (structuredClone(p) as DsPending) : {};
  }

  const hasPending = (p: DsPending) =>
    Object.keys(p.tokens ?? {}).length > 0 || Object.keys(p.components ?? {}).length > 0;

  /* --------------------------------------------------------- the canvases */

  function canvasRoots(): string[] {
    const groups = Array.isArray(config().canvasGroups)
      ? (config().canvasGroups as unknown[])
          .map((g) =>
            isObj(g) && typeof g.path === 'string' ? g.path.replace(/^\/+|\/+$/g, '') : ''
          )
          .filter(Boolean)
      : [];
    if (groups.length) return [...new Set(groups)];
    try {
      return readdirSync(designRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
        .map((d) => d.name);
    } catch {
      return [];
    }
  }

  /** Every canvas (design-root-relative) that renders under `s`, the system's own files excluded. */
  function canvasesOf(s: SystemConfig): string[] {
    const out = new Set<string>();
    const walk = (rel: string, depth: number) => {
      if (depth > 8) return;
      let entries: import('node:fs').Dirent[];
      try {
        entries = readdirSync(path.join(designRoot, rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('_') || e.name.startsWith('.') || e.name === 'node_modules') continue;
        const r = `${rel}/${e.name}`;
        if (e.isDirectory()) walk(r, depth + 1);
        else if (e.isFile() && /\.tsx$/i.test(e.name)) {
          if (r === `${s.path}/${DS_CANVAS}` || r.startsWith(`${s.path}/`)) continue;
          if (canvasSystemFor(designRoot, path.join(designRoot, r))?.name === s.name) out.add(r);
        }
      }
    };
    for (const g of canvasRoots()) walk(g, 1);
    return [...out].sort();
  }

  function canvasRows(s: SystemConfig): CanvasRow[] {
    return canvasesOf(s).map((rel) => {
      const meta = readJsonObj(path.join(designRoot, metaRelOf(rel))) ?? {};
      const dsRev = typeof meta.dsRev === 'string' ? meta.dsRev : null;
      const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      if (meta.dsPinned === true || meta.opt_out_scope === 'full')
        return { path: rel, folder, state: 'pinned', dsRev, ticked: false, reason: 'pinned' };
      // any dsRev = left out by a person ("Keep this version"): unticked by default, even while
      // it still equals head; the update dot (§5.10 leftOut) shows only once head moves on
      if (dsRev) return { path: rel, folder, state: 'left-out', dsRev, ticked: false };
      return { path: rel, folder, state: 'follows', dsRev, ticked: true };
    });
  }

  /* -------------------------------------------------------------- state */

  interface Loaded {
    s: SystemConfig;
    abs: string;
    head: HeadDoc;
    baseBody: RevisionBody;
    headBody: RevisionBody | null;
    work: Record<string, string>;
    baseModel: TokenModel;
    workModel: TokenModel;
    outsideFiles: string[];
    pending: DsPending;
  }

  /**
   * S12.16 (S10) — a folder (unconverted) system has no review: files are the API (V2-1.18). The
   * refusal names the token file to edit and the verb that refreshes its manifest.
   */
  function folderSystemWords(s: SystemConfig): string {
    const css = `${path.basename(designRoot)}/${s.tokensCssRel}`;
    return `${s.name} is a folder system (not converted), so it has no review to propose to: change its tokens by editing ${css} directly, then run \`maude design ds-check ${s.name} --emit\` to refresh its tokens.json (never edit tokens.json by hand)`;
  }

  function load(ds: string): Loaded {
    const s = system(ds);
    const abs = dsAbs(s);
    const h = readHead(abs);
    if (h.state === 'absent') throw fail('ds-not-converted', folderSystemWords(s));
    if (h.state !== 'ok')
      throw fail('ds-head-invalid', `${ds}: head.json is ${h.state} (${h.detail})`);
    // S10.16a: a system still being made has no revision to review, publish or keep (head = base = null)
    if (h.doc.head === null && h.doc.base === null)
      throw fail('ds-making', `${ds} is still being made — finish it first`);
    const baseBody = loadRevision(s, h.doc.base);
    if (!baseBody)
      throw fail('ds-revision-missing', `${ds}: the base revision has not arrived on this Mac yet`);
    const headBody = h.doc.head === h.doc.base ? baseBody : loadRevision(s, h.doc.head);
    const work = working(s);
    const baseFiles = filesOf(baseBody);
    const outsideFiles = [...new Set([...Object.keys(baseFiles), ...Object.keys(work)])]
      .filter((k) => workingKeys(s).includes(k))
      .filter((k) => baseFiles[k] !== work[k])
      .sort();
    return {
      s,
      abs,
      head: h.doc,
      baseBody,
      headBody,
      work,
      baseModel: modelOf(s, baseFiles) as TokenModel,
      workModel: modelOf(s, work) as TokenModel,
      outsideFiles,
      pending: pendingOf(s),
    };
  }

  function outsideOf(L: Loaded): DsState['outside'] {
    if (!L.outsideFiles.length) return null;
    const changes = tokenDiff(L.baseModel, L.workModel);
    const baseFiles = filesOf(L.baseBody);
    const tk = tokensKey(L.s);
    const otherChanges: { path: string; count: number }[] = [];
    for (const f of L.outsideFiles) {
      // a byte change that moved no token (a comment, a new rule) is never silent
      if (f === tk || f === TOKENS_JSON_KEY) {
        if (!changes.length) otherChanges.push({ path: f, count: 1 });
      } else otherChanges.push({ path: f, count: baseFiles[f] === undefined ? 1 : 1 });
    }
    return { files: L.outsideFiles, changes, otherChanges };
  }

  function conflictsOf(L: Loaded): { conflicts: Conflict[]; equal: string[] } {
    const conflicts: Conflict[] = [];
    const equal: string[] = [];
    if (!L.outsideFiles.length) return { conflicts, equal };
    const changed = new Map(tokenDiff(L.baseModel, L.workModel).map((c) => [c.css, c]));
    for (const [css, entry] of Object.entries(L.pending.tokens ?? {})) {
      const c = changed.get(css);
      if (!c) continue;
      const mine = themeValuesOf(entry, L.s.themes);
      const file: ThemeValues = {};
      for (const t of Object.keys(mine)) {
        const v = normalizeModel(L.workModel).tokens[css]?.values[t];
        if (v !== undefined) file[t] = v;
      }
      if (Object.keys(mine).length && sameValues(mine, file) && !entry.trash) equal.push(css);
      else
        conflicts.push({
          css,
          label: c.label,
          canvas: mine,
          file: normalizeModel(L.workModel).tokens[css]?.values ?? {},
        });
    }
    return { conflicts, equal };
  }

  function trashedOf(s: SystemConfig, model: TokenModel | null): DsState['trashed'] {
    if (!model) return [];
    const out: DsState['trashed'] = [];
    for (const t of Object.values(model.tokens)) {
      const tr = t.data.trashed;
      if (!isObj(tr) || typeof tr.replacement !== 'string') continue;
      out.push({
        kind: 'token',
        system: s.name,
        css: t.css,
        label: labelOf(t),
        replacement: tr.replacement,
        at: typeof tr.at === 'string' ? tr.at : null,
        by: isObj(tr.by) ? (tr.by as unknown as By) : null,
      });
    }
    return out;
  }

  /** §5.10 derived states — computed, never stored. */
  function state(ds: string): DsState {
    const s = system(ds);
    const abs = dsAbs(s);
    const h = readHead(abs);
    const blank: DsState = {
      name: s.name,
      path: s.path,
      converted: h.state !== 'absent',
      headState: h.state,
      head: null,
      base: null,
      drafts: [],
      library: null,
      baseMissing: false,
      outside: null,
      pending: pendingOf(s),
      waiting: [],
      conflicts: [],
      leftOut: { count: 0, canvases: [] },
      trashed: [],
      publishedInTwoPlaces: null,
    };
    if (h.state !== 'ok') return blank;
    const rows = canvasRows(s);
    const leftOut = rows.filter((r) => r.dsRev && r.dsRev !== h.doc.head);
    const common = {
      ...blank,
      head: h.doc.head,
      base: h.doc.base,
      drafts: h.doc.drafts,
      library: h.doc.library,
      leftOut: { count: leftOut.length, canvases: leftOut.map((r) => r.path) },
      publishedInTwoPlaces: publishedInTwoPlaces(abs),
    };
    let L: Loaded;
    try {
      L = load(ds);
    } catch (err) {
      if (err instanceof DsEngineError && err.code === 'ds-making') return common;
      if (
        err instanceof DsEngineError &&
        (err.code === 'ds-revision-missing' || err.code === 'ds-revision-invalid')
      )
        return { ...common, baseMissing: true };
      throw err;
    }
    const headModel = L.headBody ? modelOf(s, filesOf(L.headBody)) : null;
    const waiting = tokenDiff(headModel, L.baseModel);
    const seen = new Set(waiting.map((c) => c.css));
    for (const [css, entry] of Object.entries(L.pending.tokens ?? {})) {
      if (seen.has(css)) continue;
      const before = normalizeModel(L.baseModel).tokens[css]?.values ?? null;
      waiting.push({
        css,
        label: labelOf(L.baseModel.tokens[css]) ?? entry.add?.label ?? null,
        before,
        after: entry.trash ? before : themeValuesOf(entry, s.themes),
        ...(entry.trash ? { trashed: { replacement: entry.trash.replacement } } : {}),
      });
    }
    return {
      ...common,
      outside: outsideOf(L),
      waiting,
      conflicts: conflictsOf(L).conflicts,
      trashed: trashedOf(s, L.baseModel),
    };
  }

  /* -------------------------------------------------------- Plane B writes */

  /** Revision + siblings (+ the working files when `materialise`) in the §5.6 order. */
  function writeRevision(L: Pick<Loaded, 's' | 'abs'>, rev: BuiltRevision, materialise: boolean) {
    const read = (rel: string) => readText(path.join(L.abs, rel));
    const plan = revisionWritePlan(read, rev, materialise ? filesOf(rev.body) : {}, tokensKey(L.s));
    const before: Record<string, string | null> = {};
    for (const w of plan) {
      const abs = path.join(L.abs, w.path);
      if (!w.path.startsWith('revisions/')) before[w.path] = read(w.path);
      mkdirSync(path.dirname(abs), { recursive: true });
      atomicWrite(abs, w.text);
    }
    return before;
  }

  /** Put working files back to `prior` — only those still holding what this engine wrote. */
  function restoreWorking(
    L: Pick<Loaded, 'abs'>,
    wrote: Record<string, string>,
    prior: Record<string, string | null>
  ) {
    for (const [k, was] of Object.entries(prior)) {
      const abs = path.join(L.abs, k);
      if (readText(abs) !== wrote[k]) continue;
      if (was === null)
        unlinkSync(abs); // a file this engine just created
      else atomicWrite(abs, was);
    }
  }

  function buildFrom(s: SystemConfig, files: Record<string, string>): BuiltRevision {
    return buildRevision(s.name, files);
  }

  /* ---------------------------------------------------------- the kernel */

  async function propose(
    files: { rel: string; text: string }[],
    label: string
  ): Promise<string | null> {
    if (!files.length) return null;
    const k = kernelNow();
    if (!k)
      throw fail(
        'ds-kernel-unavailable',
        'no project home answers right now — nothing was changed'
      );
    const r = await k.propose(files, { kind: DS_ACTION_KIND, label: label.slice(0, 200) });
    if (!r)
      throw fail(
        'ds-kernel-unavailable',
        'no project home answers right now — nothing was changed'
      );
    if (r.status !== 'accepted')
      throw fail('ds-kernel-rejected', `the project refused the change (${r.code ?? 'rejected'})`, {
        kernel: r.code ?? null,
      });
    return r.actionId ?? null;
  }

  function withPending(s: SystemConfig, next: DsPending): { rel: string; text: string } {
    const meta = dsMeta(s);
    const clean: DsPending = { ...next };
    if (clean.tokens && !Object.keys(clean.tokens).length) delete clean.tokens;
    if (clean.components && !Object.keys(clean.components).length) delete clean.components;
    const empty = !clean.tokens && !clean.components;
    if (empty) delete meta.dsPending;
    else {
      if (!clean.base) delete clean.base;
      meta.dsPending = clean;
    }
    return { rel: dsMetaRel(s), text: metaText(meta) };
  }

  function writeLog(
    L: Pick<Loaded, 'abs' | 'head'>,
    pointers: Pointers,
    entry: Omit<LogEntry, 'at' | 'was' | 'is'>
  ) {
    const was: Pointers = { head: L.head.head, base: L.head.base };
    const next: HeadDoc = {
      ...L.head,
      head: pointers.head,
      base: pointers.base,
      log: [{ ...entry, at: iso(), was, is: pointers } as LogEntry, ...L.head.log],
    };
    writeHead(L.abs, next, was);
  }

  /* ------------------------------------------------------------- publish */

  function applyPending(
    L: Loaded,
    pending: DsPending,
    by: By
  ): { model: TokenModel; edits: ComponentEdit[] } {
    const model = structuredClone(L.baseModel);
    const at = iso();
    for (const [css, entry] of Object.entries(pending.tokens ?? {})) {
      if (!CSS_NAME_RE.test(css))
        throw fail('ds-pending-invalid', `not a token name: ${css.slice(0, 80)}`);
      const cur = model.tokens[css];
      if (entry.trash) {
        if (!cur) throw fail('ds-unknown-token', `${css} is not in the system`);
        const values =
          normalizeModel({ ...model, tokens: { [css]: cur } }).tokens[css]?.values ?? {};
        setOwn(cur.data, 'trashed', {
          replacement: entry.trash.replacement,
          at: entry.at ?? at,
          by: (entry.by ?? by) as unknown as Json,
          previous: values as unknown as Json,
        });
        continue;
      }
      const values = themeValuesOf(entry, L.s.themes);
      const tok: ModelToken = cur ?? { css, values: {}, data: {}, extra: {} };
      if (!cur) {
        if (!entry.add)
          throw fail('ds-unknown-token', `${css} is not in the system (add it first)`);
        if (typeof entry.add.label === 'string') setOwn(tok.data, 'label', entry.add.label);
        setOwn(model.tokens, css, tok);
      }
      if (tok.data.locked === true) throw fail('ds-pending-invalid', `${css} is locked`);
      // a value on a trashed token takes it out of the trash: Restore puts `previous` back, Clear
      // out writes `var(<replacement>)` itself (the alias line stays) — §5.11 e
      if (isObj(tok.data.trashed)) delete tok.data.trashed;
      for (const [t, v] of Object.entries(values)) setOwn(tok.values, t, v);
      if (isObj(entry.valueNames)) {
        const vn = isObj(tok.data.valueNames) ? (tok.data.valueNames as Record<string, Json>) : {};
        for (const [t, n] of Object.entries(entry.valueNames))
          if (typeof n === 'string') setOwn(vn, t, n);
        setOwn(tok.data, 'valueNames', vn);
      }
      if (typeof entry.darkFollows === 'boolean')
        setOwn(tok.data, 'darkFollows', entry.darkFollows);
    }
    const edits: ComponentEdit[] = [];
    for (const sels of Object.values(pending.components ?? {}))
      for (const [selector, props] of Object.entries(sels ?? {}))
        for (const [property, e] of Object.entries(props ?? {}))
          if (isObj(e) && typeof e.value === 'string')
            edits.push({ selector, property, value: e.value });
    return { model, edits };
  }

  /** R = snapshot(generate(base files, all waiting changes)) — built, not written. */
  function generateFrom(L: Loaded, pending: DsPending, by: By): BuiltRevision {
    const base = filesOf(L.baseBody);
    // nothing to apply → R is base itself (G2: an empty publish writes nothing new)
    if (!hasPending(pending)) return buildFrom(L.s, base);
    const { model, edits } = applyPending(L, pending, by);
    const tk = tokensKey(L.s);
    const files: Record<string, string> = { ...base };
    setOwn(files, tk, generateTokensCss(base[tk] ?? null, model, genConfig(L.s)));
    setOwn(files, TOKENS_JSON_KEY, emitTokensJson(model));
    if (edits.length || base[COMPONENTS_CSS_KEY] !== undefined)
      setOwn(
        files,
        COMPONENTS_CSS_KEY,
        generateComponentsCss(base[COMPONENTS_CSS_KEY] ?? '', edits)
      );
    return buildFrom(L.s, files);
  }

  function preconditions(L: Loaded, expectHead: string | null | undefined) {
    if (L.head.library) throw fail('ds-library', 'a linked library is view only here');
    if (expectHead !== undefined && expectHead !== L.head.head)
      throw fail('ds-head-moved', 'the system was published since this review opened', {
        head: L.head.head,
      });
    // a conflict is an outside change that also touches a pending token: the more specific refusal
    if (conflictsOf(L).conflicts.length)
      throw fail('ds-conflict', 'a change waits for a pick first');
    if (L.outsideFiles.length)
      throw fail(
        'ds-outside-unreviewed',
        'the system files changed outside the app — review that first',
        {
          files: L.outsideFiles,
        }
      );
    if (publishedInTwoPlaces(L.abs))
      throw fail('ds-two-places', 'the system was published in two places — pick one first');
  }

  /** The §5.11 c review body with its defaults (followers ticked, left-out and pinned unticked). */
  function review(ds: string) {
    const L = load(ds);
    const pendingR =
      hasPending(L.pending) || L.head.head !== L.head.base
        ? generateFrom(L, L.pending, { kind: 'person' })
        : null;
    const headModel = L.headBody ? modelOf(L.s, filesOf(L.headBody)) : null;
    const changes = pendingR ? tokenDiff(headModel, modelOf(L.s, filesOf(pendingR.body))) : [];
    return {
      system: L.s.name,
      expectHead: L.head.head,
      changes,
      canvases: canvasRows(L.s),
    };
  }

  interface PublishInput {
    expectHead: string | null;
    /** overrides of the default ticks, by design-root-relative path */
    canvases?: { path: string; ticked: boolean }[];
    by: By;
  }

  async function publishLocked(ds: string, inp: PublishInput): Promise<PublishResult> {
    const L = load(ds);
    preconditions(L, inp.expectHead);
    const pending = L.pending;
    const rev = generateFrom(L, pending, inp.by);
    if (rev.id === L.head.head) throw fail('ds-nothing-waiting', 'nothing waits to be published');
    const oldHead = L.head.head;
    const headModel = L.headBody ? modelOf(L.s, filesOf(L.headBody)) : null;
    const changes = tokenDiff(headModel, modelOf(L.s, filesOf(rev.body)));
    const compCount = Object.values(pending.components ?? {}).reduce(
      (n, sels) =>
        n + Object.values(sels ?? {}).reduce((m, p) => m + Object.keys(p ?? {}).length, 0),
      0
    );
    const summary = summaryOf(changes, compCount);
    // the ticks: defaults, then the review's overrides
    const over = new Map((inp.canvases ?? []).map((c) => [c.path, c.ticked === true]));
    const rows = canvasRows(L.s).map((r) =>
      over.has(r.path) ? { ...r, ticked: over.get(r.path) as boolean } : r
    );
    const files: { rel: string; text: string }[] = [];
    for (const r of rows) {
      const metaAbs = path.join(designRoot, metaRelOf(r.path));
      const meta = readJsonObj(metaAbs) ?? {};
      if (r.ticked && typeof meta.dsRev === 'string') {
        delete meta.dsRev;
        delete meta.dsKept; // a Keep (p8-dead-reasons) goes with the pin
        files.push({ rel: metaRelOf(r.path), text: metaText(meta) });
        const src = readText(path.join(designRoot, r.path));
        if (src !== null && STRIP_HEAD_PIN.test(src))
          files.push({ rel: r.path, text: src.replace(STRIP_HEAD_PIN, '') });
        STRIP_HEAD_PIN.lastIndex = 0;
      } else if (!r.ticked && typeof meta.dsRev !== 'string' && oldHead) {
        setOwn(meta, 'dsRev', oldHead);
        files.push({ rel: metaRelOf(r.path), text: metaText(meta) });
      }
    }
    if (hasPending(L.pending)) files.push(withPending(L.s, {}));
    // 1–2: R + siblings, then the working files
    const wrote = filesOf(rev.body);
    const prior = writeRevision(L, rev, true);
    // 3–4: metas + pending, one kernel action
    let actionId: string | null;
    try {
      actionId = await propose(files, summary);
    } catch (err) {
      restoreWorking(L, wrote, prior);
      throw err;
    }
    // 5: head.json last
    const updated = rows.filter((r) => r.ticked).length;
    const leftOut = rows.length - updated;
    writeLog(
      L,
      { head: rev.id, base: rev.id },
      {
        rev: rev.id,
        parent: oldHead,
        action: 'publish',
        by: inp.by,
        summary,
        updated,
        leftOut,
        actionId,
      }
    );
    return { action: 'publish', rev: rev.id, actionId, updated, leftOut, summary };
  }

  function publish(ds: string, inp: PublishInput): Promise<PublishResult> {
    // A linked project whose home cannot be reached (offline, or not in accepted mode) cannot take the
    // one publish action: refuse up front, before the lock and before any revision is written, in the
    // person's words (decision v2-lead-ds-publish-offline-refuses). A local project's home always answers.
    if (!kernelNow())
      return Promise.reject(
        fail(
          'ds-kernel-unavailable',
          "No project home answers right now — publish when you're back online."
        )
      );
    return withLock(dsAbs(system(ds)), () => publishLocked(ds, inp));
  }

  /* ------------------------------------------------------------- pending */

  interface PendingInput {
    tokens?: Record<string, PendingToken | null>;
    components?: PendingComponents;
    by: By;
    /** per token: the `at` of the entry the editor read (null = none); a mismatch refuses */
    expect?: Record<string, string | null>;
  }

  function checkEntry(s: SystemConfig, css: string, e: PendingToken) {
    if (!CSS_NAME_RE.test(css))
      throw fail('ds-pending-invalid', `not a token name: ${css.slice(0, 80)}`);
    if (!isObj(e)) throw fail('ds-pending-invalid', `${css}: not an entry`);
    for (const t of s.themes) {
      const v = e[t];
      if (v === undefined) continue;
      if (typeof v !== 'string' || !v.trim() || v.length > VALUE_MAX || UNSAFE.test(v))
        throw fail('ds-pending-invalid', `${css} (${t}): not a value`);
    }
    if (e.valueNames !== undefined) {
      if (!isObj(e.valueNames)) throw fail('ds-pending-invalid', `${css}: valueNames`);
      for (const n of Object.values(e.valueNames))
        if (typeof n !== 'string' || !DISPLAY_RE.test(n))
          throw fail('ds-pending-invalid', `${css}: a value name`);
    }
    if (
      e.add?.label !== undefined &&
      !(typeof e.add.label === 'string' && DISPLAY_RE.test(e.add.label))
    )
      throw fail('ds-pending-invalid', `${css}: a label`);
  }

  /**
   * S10.21b — Dark follows, here (decision v2-S10.21-dark-follows-in-engine): an entry that moves Light on a token whose
   * Dark follows gets the followed Dark, so an agent's Light-only file lands what the token editor sends. Mirrors
   * `ds/edges.ts` `entryFor` and `token-write.js` `buildEntry`: the pair "as it is now" is the waiting value over the
   * working file's, Dark falling back to Light; a Dark the entry names wins; `darkFollows: true` alone re-follows from
   * the Light on screen; and `darkFollows` is kept only when it differs from the file.
   */
  function followIn(L: Loaded, css: string, have: PendingToken | undefined, entry: PendingToken) {
    const { light, dark } = modesOf(L.s.themes, L.s.themeDefault);
    if (!dark || entry.trash) return;
    const file = L.workModel.tokens[css] ?? L.baseModel.tokens[css];
    const fileFollows = file?.data?.darkFollows !== false;
    const wait = have && !have.trash ? have : undefined;
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const now = (t: string) => str(wait?.[t]) ?? file?.values?.[t] ?? file?.values?.[light];
    const said =
      typeof entry.darkFollows === 'boolean'
        ? entry.darkFollows
        : typeof wait?.darkFollows === 'boolean'
          ? wait.darkFollows
          : fileFollows;
    const d = followedDark({
      follows: said,
      nextLight: str(entry[light]) ?? (entry.darkFollows === true ? now(light) : undefined),
      ownDark: str(entry[dark]),
      prev: { light: now(light), dark: now(dark) },
    });
    if (d) entry[dark] = d;
    if (entry.darkFollows === fileFollows) delete entry.darkFollows;
  }

  async function mergePendingLocked(ds: string, inp: PendingInput): Promise<DsResult> {
    const L = load(ds);
    if (L.head.library) throw fail('ds-library', 'a linked library is view only here');
    if (!existsSync(path.join(designRoot, dsCanvasRel(L.s))))
      throw fail('ds-no-canvas', `${ds} has no Design system canvas`);
    const next: DsPending = structuredClone(L.pending);
    next.tokens = next.tokens ?? {};
    const at = iso();
    const baseTokens = normalizeModel(L.baseModel).tokens;
    for (const [css, e] of Object.entries(inp.tokens ?? {})) {
      const have = next.tokens[css];
      const expected = inp.expect?.[css];
      if (have && expected !== (have.at ?? null))
        throw fail('ds-pending-conflict', `${css} was changed by someone else — read it again`, {
          css,
        });
      if (e === null) {
        delete next.tokens[css];
        continue;
      }
      checkEntry(L.s, css, e);
      if (!baseTokens[css] && !e.add) throw fail('ds-unknown-token', `${css} is not in the system`);
      // a frozen brand value (V2-1.6 §5.3 `locked`): the editor refuses until it is unlocked — here,
      // before a pending entry exists that the publish would then refuse (S10.7)
      if (L.baseModel.tokens[css]?.data.locked === true)
        throw fail('ds-token-locked', `${css} is a locked brand colour — unlock it first`, { css });
      if (e.trash) {
        const repl = e.trash.replacement;
        if (tier1().has(css))
          throw fail('ds-trash-tier1', `${css} is a Tier-1 role and can't go to the trash`);
        if (trashOf(L.baseModel.tokens[css]))
          throw fail('ds-pending-invalid', `${css} is already in the trash`);
        if (
          typeof repl !== 'string' ||
          !CSS_NAME_RE.test(repl) ||
          repl === css ||
          !baseTokens[repl] ||
          trashOf(L.baseModel.tokens[repl])
        )
          throw fail('ds-pending-invalid', `${String(repl).slice(0, 80)} can't replace ${css}`);
      }
      // the followed Dark goes in before `by`/`at`, where the page's own entry carries it
      const entry: PendingToken = { ...e };
      followIn(L, css, have, entry);
      entry.by = inp.by;
      entry.at = at;
      const values = themeValuesOf(entry, L.s.themes);
      // an entry equal to base's value is dropped (§5.9)
      if (
        !entry.add &&
        !entry.trash &&
        baseTokens[css] &&
        !trashOf(L.baseModel.tokens[css]) &&
        Object.keys(values).length &&
        Object.entries(values).every(([t, v]) => baseTokens[css].values[t] === v) &&
        entry.valueNames === undefined
      ) {
        delete next.tokens[css];
        continue;
      }
      setOwn(next.tokens, css, entry);
    }
    for (const [comp, sels] of Object.entries(inp.components ?? {})) {
      if (!isObj(sels)) throw fail('ds-pending-invalid', `${comp}: not a component entry`);
      next.components = next.components ?? {};
      next.components[comp] = next.components[comp] ?? {};
      const c = next.components[comp];
      for (const [sel, props] of Object.entries(sels))
        for (const [prop, e] of Object.entries(props ?? {})) {
          if (
            !isObj(e) ||
            typeof e.value !== 'string' ||
            e.value.length > VALUE_MAX ||
            UNSAFE.test(e.value)
          )
            throw fail('ds-pending-invalid', `${comp} ${sel} ${prop}: not a value`);
          c[sel] = c[sel] ?? {};
          setOwn(c[sel], prop, { value: e.value, by: inp.by, at });
        }
    }
    if (!next.base) next.base = L.head.base;
    const file = withPending(L.s, next);
    const cur = readText(path.join(designRoot, dsMetaRel(L.s)));
    const actionId = cur === file.text ? null : await propose([file], 'Design system change');
    return { action: 'pending', rev: null, actionId };
  }

  function mergePending(ds: string, inp: PendingInput): Promise<DsResult> {
    return withLock(dsAbs(system(ds)), () => mergePendingLocked(ds, inp));
  }

  /** Cancel: the pending entries the review covered go ("Cancel puts the swatch back"). */
  function cancelPending(ds: string, inp: { by: By; tokens?: string[] }): Promise<DsResult> {
    return withLock(dsAbs(system(ds)), async () => {
      const L = load(ds);
      if (!hasPending(L.pending)) return { action: 'cancel', rev: null, actionId: null };
      const next: DsPending = structuredClone(L.pending);
      if (inp.tokens) for (const css of inp.tokens) delete next.tokens?.[css];
      else {
        delete next.tokens;
        delete next.components;
      }
      const actionId = await propose([withPending(L.s, next)], 'Cancel design system changes');
      return { action: 'cancel', rev: null, actionId };
    });
  }

  /* ------------------------------------------------------- outside (a) */

  function keepOutside(ds: string, inp: { by: By }): Promise<DsResult> {
    return withLock(dsAbs(system(ds)), async () => {
      const L = load(ds);
      if (L.head.library) throw fail('ds-library', 'a linked library is view only here');
      if (!L.outsideFiles.length) throw fail('ds-no-outside', 'no outside change waits');
      const { conflicts, equal } = conflictsOf(L);
      if (conflicts.length) throw fail('ds-conflict', 'a change waits for a pick first');
      const K = buildFrom(L.s, L.work);
      writeRevision(L, K, false);
      // equal values auto-resolve: the entry is dropped with the keep (§5.10)
      let actionId: string | null = null;
      if (equal.length) {
        const next = structuredClone(L.pending);
        for (const css of equal) delete next.tokens?.[css];
        actionId = await propose([withPending(L.s, next)], 'Keep the outside change');
      }
      writeLog(
        L,
        { head: L.head.head, base: K.id },
        {
          rev: K.id,
          parent: L.head.base,
          action: 'keep',
          by: inp.by,
          summary: summaryOf(tokenDiff(L.baseModel, L.workModel), 0),
          actionId,
        }
      );
      return { action: 'keep', rev: K.id, actionId };
    });
  }

  function undoOutside(ds: string, inp: { by: By }): Promise<DsResult> {
    void inp;
    return withLock(dsAbs(system(ds)), async () => {
      const L = load(ds);
      // a linked library's outside edit offers ONLY Undo (V2-1.6 §5.14): the library's values come back
      if (!L.outsideFiles.length) throw fail('ds-no-outside', 'no outside change waits');
      const base = filesOf(L.baseBody);
      for (const k of L.outsideFiles) {
        const abs = path.join(L.abs, k);
        if (base[k] !== undefined) atomicWrite(abs, base[k]);
        else if (existsSync(abs)) {
          // a file the base never had: moved aside, never deleted
          const dir = path.join(designRoot, '_trash', 'ds-outside', L.s.name);
          mkdirSync(dir, { recursive: true });
          renameSync(abs, path.join(dir, `${now()}-${path.basename(k)}`));
        }
      }
      return { action: 'undo', rev: null, actionId: null };
    });
  }

  /* ------------------------------------------------------- conflict (b) */

  function pick(
    ds: string,
    inp: { css: string; use: 'canvas' | 'file'; by: By }
  ): Promise<DsResult> {
    return withLock(dsAbs(system(ds)), async () => {
      const L = load(ds);
      if (L.head.library) throw fail('ds-library', 'a linked library is view only here');
      const c = conflictsOf(L).conflicts.find((x) => x.css === inp.css);
      if (!c) throw fail('ds-no-conflict', `${inp.css} has no conflict to pick`);
      let K: BuiltRevision;
      if (inp.use === 'canvas') {
        // patch the working files to the pending value (§5.5), from the working files
        const entry = (L.pending.tokens ?? {})[inp.css];
        const model = structuredClone(L.workModel);
        const tok = model.tokens[inp.css] ?? { css: inp.css, values: {}, data: {}, extra: {} };
        for (const [t, v] of Object.entries(themeValuesOf(entry, L.s.themes)))
          setOwn(tok.values, t, v);
        setOwn(model.tokens, inp.css, tok);
        const files = { ...L.work };
        const tk = tokensKey(L.s);
        setOwn(files, tk, generateTokensCss(L.work[tk] ?? null, model, genConfig(L.s)));
        setOwn(files, TOKENS_JSON_KEY, emitTokensJson(model));
        K = buildFrom(L.s, files);
      } else K = buildFrom(L.s, L.work);
      const wrote = filesOf(K.body);
      const prior = writeRevision(L, K, inp.use === 'canvas');
      const next = structuredClone(L.pending);
      delete next.tokens?.[inp.css];
      let actionId: string | null;
      try {
        actionId = await propose(
          [withPending(L.s, next)],
          `${c.label ?? c.css}: use the ${inp.use === 'canvas' ? 'canvas' : 'file'} value`
        );
      } catch (err) {
        restoreWorking(L, wrote, prior);
        throw err;
      }
      writeLog(
        L,
        { head: L.head.head, base: K.id },
        {
          rev: K.id,
          parent: L.head.base,
          action: 'pick',
          by: inp.by,
          summary:
            `${c.label ?? c.css}: ${inp.use === 'canvas' ? 'the canvas value' : 'the file value'}`.slice(
              0,
              200
            ),
          actionId,
        }
      );
      return { action: 'pick', rev: K.id, actionId };
    });
  }

  /** "Published in two places" → "Use this": a publish whose expectHead is the surviving head. */
  function pickPublished(ds: string, inp: { head: string; by: By }): Promise<DsResult> {
    return withLock(dsAbs(system(ds)), async () => {
      const s = system(ds);
      const abs = dsAbs(s);
      const places = publishedInTwoPlaces(abs);
      if (!places) throw fail('ds-no-conflict', 'the system is published in one place');
      const chosen = places.find((p) => p.head === inp.head);
      if (!chosen) throw fail('ds-no-conflict', 'that head is not one of the two');
      const h = readHead(abs);
      if (h.state !== 'ok') throw fail('ds-head-invalid', 'head.json is not readable');
      const body = loadRevision(s, inp.head);
      if (!body) throw fail('ds-revision-missing', 'that revision has not arrived on this Mac yet');
      // nothing is lost: the other copy's log entries join this one's
      const logs = [
        h.doc.log,
        ...places.filter((p) => p.file).map((p) => asideLog(abs, p.file as string)),
      ];
      const seen = new Set<string>();
      const merged = logs
        .flat()
        .filter((e) => {
          const k = `${e.rev}\0${e.action}\0${e.at}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      const L = { s, abs, head: { ...h.doc, log: merged } };
      if (inp.head !== h.doc.head)
        writeRevision(L, { id: inp.head, body, bytes: serializeRevision(body) }, true);
      writeLog(
        L,
        { head: inp.head, base: inp.head },
        {
          rev: inp.head,
          parent: h.doc.head,
          action: 'publish',
          by: inp.by,
          summary: 'Published in two places: one kept',
          actionId: null,
        }
      );
      settleAsideHeads(designRoot, abs, s.name);
      return { action: 'pick', rev: inp.head, actionId: null };
    });
  }

  function asideLog(abs: string, file: string): LogEntry[] {
    const t = readText(path.join(abs, file));
    if (!t) return [];
    try {
      const d = JSON.parse(t);
      return isObj(d) && Array.isArray(d.log) ? (d.log as LogEntry[]) : [];
    } catch {
      return [];
    }
  }

  /* ------------------------------------------------- canvas update / leave (d) */

  function canvasSystem(canvasRel: string): SystemConfig {
    const rel = canvasRel.replace(/\\/g, '/').replace(/^\/+/, '');
    if (
      !/\.tsx$/i.test(rel) ||
      rel.split('/').some((c) => c === '..' || c.startsWith('_') || c.startsWith('.'))
    )
      throw fail('ds-not-in-system', 'not a canvas');
    const abs = path.join(designRoot, rel);
    if (!existsSync(abs) || !statSync(abs).isFile())
      throw fail('ds-not-in-system', 'no such canvas');
    const s = canvasSystemFor(designRoot, abs);
    if (!s || rel.startsWith(`${s.path}/`))
      throw fail('ds-not-in-system', 'this canvas follows no converted system');
    return s;
  }

  function canvasUpdate(canvasRel: string, inp: { by: By }): Promise<DsResult> {
    void inp;
    const s = canvasSystem(canvasRel);
    return withLock(dsAbs(s), async () => {
      const h = readHead(dsAbs(s));
      if (h.state !== 'ok') throw fail('ds-not-converted', `${s.name} is not converted`);
      const rel = canvasRel.replace(/^\/+/, '');
      const meta = readJsonObj(path.join(designRoot, metaRelOf(rel))) ?? {};
      const files: { rel: string; text: string }[] = [];
      // p8-dead-reasons — the update a person declined with Keep goes with the pin it was about
      if (typeof meta.dsRev === 'string' || meta.dsKept !== undefined) {
        delete meta.dsRev;
        delete meta.dsKept;
        files.push({ rel: metaRelOf(rel), text: metaText(meta) });
      }
      const src = readText(path.join(designRoot, rel));
      if (src !== null && src.replace(STRIP_HEAD_PIN, '') !== src)
        files.push({ rel, text: src.replace(STRIP_HEAD_PIN, '') });
      const actionId = await propose(files, 'Update to the design system');
      return { action: 'canvas-update', rev: h.doc.head, actionId };
    });
  }

  function canvasLeave(canvasRel: string, inp: { by: By }): Promise<DsResult> {
    void inp;
    const s = canvasSystem(canvasRel);
    return withLock(dsAbs(s), async () => {
      const h = readHead(dsAbs(s));
      if (h.state !== 'ok' || !h.doc.head)
        throw fail('ds-not-converted', `${s.name} is not converted`);
      const rel = canvasRel.replace(/^\/+/, '');
      const meta = readJsonObj(path.join(designRoot, metaRelOf(rel))) ?? {};
      if (meta.dsRev === h.doc.head)
        return { action: 'canvas-leave', rev: h.doc.head, actionId: null };
      // p8-dead-reasons — "Keep this version" on a canvas already left out: it STAYS on its version (dsRev is
      // not moved to head) and remembers the head it declined (`dsKept`, versioned, so peers see it), so the
      // update card stays away until the system moves on again; Update (canvasUpdate) still works and clears both
      if (typeof meta.dsRev === 'string' && meta.dsRev) {
        if (meta.dsKept === h.doc.head)
          return { action: 'canvas-leave', rev: meta.dsRev as string, actionId: null };
        setOwn(meta, 'dsKept', h.doc.head);
        const keptId = await propose(
          [{ rel: metaRelOf(rel), text: metaText(meta) }],
          'Keep this version of the design system'
        );
        return { action: 'canvas-leave', rev: meta.dsRev as string, actionId: keptId };
      }
      setOwn(meta, 'dsRev', h.doc.head);
      const actionId = await propose(
        [{ rel: metaRelOf(rel), text: metaText(meta) }],
        'Keep this version of the design system'
      );
      return { action: 'canvas-leave', rev: h.doc.head, actionId };
    });
  }

  /* ------------------------------------------------------------ trash (e) */

  /** refuse before writing a pending entry the publish would then refuse */
  function expectHeadNow(ds: string, expectHead: string | null) {
    const h = readHead(dsAbs(system(ds)));
    if (h.state === 'ok' && h.doc.head !== expectHead)
      throw fail('ds-head-moved', 'the system was published since');
  }

  function tokenOf(ds: string, css: string) {
    const L = load(ds);
    const t = L.baseModel.tokens[css];
    if (!t) throw fail('ds-unknown-token', `${css} is not in the system`);
    return { L, t };
  }

  /**
   * A token to the trash (§5.11 e): a pending `trash` entry, then a publish with every follower
   * ticked (the defaults — a canvas a person left out stays out). Two actions, like every swatch
   * edit + "Update N canvases": ⌘Z takes the publish back first, then the entry.
   */
  async function trashToken(
    ds: string,
    inp: { css: string; replacement: string; expectHead: string | null; by: By }
  ): Promise<PublishResult> {
    expectHeadNow(ds, inp.expectHead);
    await mergePending(ds, {
      tokens: { [inp.css]: { trash: { replacement: inp.replacement } } },
      by: inp.by,
    });
    return publish(ds, { expectHead: inp.expectHead, by: inp.by });
  }

  /** Restore: a publish that puts `previous` back. */
  async function restoreToken(
    ds: string,
    inp: { css: string; expectHead: string | null; by: By }
  ): Promise<PublishResult> {
    const { L, t } = tokenOf(ds, inp.css);
    if (L.head.head !== inp.expectHead)
      throw fail('ds-head-moved', 'the system was published since');
    const tr = t.data.trashed;
    if (!isObj(tr)) throw fail('ds-not-trashed', `${inp.css} is not in the trash`);
    const prev = isObj(tr.previous) ? (tr.previous as Record<string, unknown>) : {};
    const entry: PendingToken = {};
    for (const [th, v] of Object.entries(prev)) if (typeof v === 'string') entry[th] = v;
    if (!Object.keys(entry).length)
      throw fail('ds-not-trashed', `${inp.css} has no previous value`);
    await mergePending(ds, { tokens: { [inp.css]: entry }, by: inp.by });
    return publish(ds, { expectHead: inp.expectHead, by: inp.by });
  }

  /**
   * Clear out (owner — the route checks): the tombstone record goes, the alias line
   * `--name: var(--replacement)` stays (the usage index may still show a reference).
   */
  async function clearToken(
    ds: string,
    inp: { css: string; expectHead: string | null; by: By }
  ): Promise<PublishResult> {
    const { L, t } = tokenOf(ds, inp.css);
    if (L.head.head !== inp.expectHead)
      throw fail('ds-head-moved', 'the system was published since');
    const tr = t.data.trashed;
    if (!isObj(tr) || typeof tr.replacement !== 'string')
      throw fail('ds-not-trashed', `${inp.css} is not in the trash`);
    const entry: PendingToken = {};
    for (const th of Object.keys(t.values)) entry[th] = `var(${tr.replacement})`;
    await mergePending(ds, { tokens: { [inp.css]: entry }, by: inp.by });
    return publish(ds, { expectHead: inp.expectHead, by: inp.by });
  }

  /* ---------------------------------------------------------- undo hook */

  /**
   * The head.json half of an accepted kernel undo / redo (S10 Q1): `ids` are what it undid (a redo
   * names the undo it re-applies). For each, the newest log entry recorded with that action id is
   * reverted — pointers back to `was`, working files re-materialised from that base — and a
   * `restore` entry records `byAction`. Only when nothing moved since (`is` still holds) and the
   * working files are still base's; otherwise that system is reported in `skipped`.
   */
  async function revertActions(ids: string[], byAction: string, redo: boolean) {
    const skipped: { doc: string; reason: string }[] = [];
    const reverted: { system: string; rev: string | null }[] = [];
    if (!ids.length) return { skipped, reverted };
    const want = new Set(ids);
    for (const s of systems()) {
      const abs = dsAbs(s);
      if (readHead(abs).state !== 'ok') continue;
      await withLock(abs, async () => {
        const h = readHead(abs);
        if (h.state !== 'ok') return;
        // newest first; each id reverts its newest entry only
        const todo: LogEntry[] = [];
        const done = new Set<string>();
        for (const e of h.doc.log)
          if (e.actionId && want.has(e.actionId) && !done.has(e.actionId)) {
            done.add(e.actionId);
            todo.push(e);
          }
        let doc = h.doc;
        for (const e of todo) {
          const where = `${s.path}/${HEAD_REL}`;
          if (!e.was || !e.is) {
            skipped.push({ doc: where, reason: 'ds-not-undoable' });
            continue;
          }
          if (doc.head !== e.is.head || doc.base !== e.is.base) {
            skipped.push({ doc: where, reason: 'ds-head-moved' });
            continue;
          }
          const curBase = loadRevision(s, e.is.base);
          const target = e.was.base ? loadRevision(s, e.was.base) : null;
          if (!curBase || (e.was.base && !target)) {
            skipped.push({ doc: where, reason: 'ds-revision-missing' });
            continue;
          }
          const work = working(s);
          const cur = filesOf(curBase);
          const dirty = [...new Set([...Object.keys(cur), ...Object.keys(work)])].some(
            (k) => cur[k] !== work[k]
          );
          if (dirty) {
            skipped.push({ doc: where, reason: 'ds-outside-unreviewed' });
            continue;
          }
          if (target) {
            const want2 = filesOf(target);
            for (const [k, t] of Object.entries(want2))
              if (work[k] !== t) atomicWrite(path.join(abs, k), t);
            // a working file the target never had (tokens.json a first publish emitted): its bytes
            // are the current base's, kept in that revision — so removing it loses nothing
            for (const k of Object.keys(work))
              if (want2[k] === undefined) unlinkSync(path.join(abs, k));
          }
          const original = String(e.summary ?? e.action).replace(/^(Undo|Redo): /, '');
          const entry: LogEntry = {
            rev: e.was.head ?? e.was.base ?? e.rev,
            parent: e.is.head,
            action: 'restore' as LogAction,
            at: iso(),
            by: e.by,
            summary: `${redo ? 'Redo' : 'Undo'}: ${original}`.slice(0, 200),
            actionId: byAction,
            was: { ...e.is },
            is: { ...e.was },
          };
          const next: HeadDoc = {
            ...doc,
            head: e.was.head,
            base: e.was.base,
            log: [entry, ...doc.log],
          };
          writeHead(abs, next, { head: doc.head, base: doc.base });
          const again = readHead(abs);
          if (again.state === 'ok') doc = again.doc;
          reverted.push({ system: s.name, rev: e.was.head });
        }
      });
    }
    if (skipped.length)
      log.warn?.(`[ds] undo left ${skipped.length} design-system change(s) in place`);
    return { skipped, reverted };
  }

  return {
    designRoot,
    /** the Plane-A port now (null = no home answers) and the clock — `ds/make.ts` reuses both */
    kernel: kernelNow,
    now,
    systems,
    state,
    review,
    publish,
    mergePending,
    cancelPending,
    keepOutside,
    undoOutside,
    pick,
    pickPublished,
    canvasUpdate,
    canvasLeave,
    trashToken,
    restoreToken,
    clearToken,
    revertActions,
    canvasesOf: (ds: string) => canvasesOf(system(ds)),
    /** the working files' sha256s, for diagnostics and the outside watcher (S10.3) */
    workingHashes: (ds: string) =>
      Object.fromEntries(Object.entries(working(system(ds))).map(([k, t]) => [k, sha256Hex(t)])),
  };
}

export type DsEngine = ReturnType<typeof createDsEngine>;
