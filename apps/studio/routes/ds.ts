// routes/ds.ts — the design-system routes (S10.3; contract V2-1.6 §5.12, S10 §2.4, Q15).
//
// Main origin only, privileged, never `origin: 'canvas'`. Every effect is ds/engine.ts's; this
// module judges WHO may ask and shapes the answer. The same `runDsOp` backs `maude design ds …`
// when no studio runs (ds/ds-verb.ts), so the route and the verb cannot drift (S10.3 parity).
//
// Permissions (Q15, rule 12 — whatever the UI hides, the server refuses):
//   reads (state, revision, revisions, usage, publish --dry-run)  anyone who can open the project
//   pending                                                       Can edit on the DS canvas
//   publish, outside keep|undo, pick, trash, restore              Can edit on the WHOLE project
//   canvas update|leave                                           Can edit on that canvas
//   clear (a token's tombstone)                                   the owner
// A canvas-only session (grants, no project role) sees a system only through its DS canvas
// (`<ds.path>/design-system.tsx`); every other system, and every canvas outside its grants, is
// answered exactly like one that does not exist — same status, same bytes (no existence oracle).

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Access } from '../access/scope.ts';
import { checkSystem } from '../ds/check.ts';
import {
  type DsEngine,
  DsEngineError,
  type DsState,
  type PendingComponents,
  type PendingToken,
} from '../ds/engine.ts';
import { type By, readHead } from '../ds/head.ts';
import type { DsOutsideWatcher } from '../ds/outside.ts';
import { indexRegistry, loadRegistry } from '../ds/registry.ts';
import { verifyRevision } from '../ds/revision.ts';
import { diskFs, loadSystem } from '../ds/system.ts';
import type { DsUsageIndex } from '../index/ds-usage.ts';
import type { RouteSpec } from './table.ts';

export const DS_FORMATS = {
  state: 'maude.ds-state',
  review: 'maude.ds-review',
  result: 'maude.ds-result',
  usage: 'maude.ds-usage',
  revisions: 'maude.ds-revisions',
} as const;

export type DsOp =
  | 'state'
  | 'publish'
  | 'pending'
  | 'outside'
  | 'pick'
  | 'canvas'
  | 'trash'
  | 'restore'
  | 'clear'
  | 'revision'
  | 'revisions'
  | 'usage';

export interface DsOpContext {
  engine: DsEngine;
  outside: DsOutsideWatcher | null;
  usage: DsUsageIndex | null;
  access: Access;
  /** who acts (a person, or Claude Code through the verb) */
  by: By;
  /** after an effect: the studio emits `ds:changed {system}` */
  emit?: (event: string, payload: unknown) => void;
}

export interface DsOpAnswer {
  status: number;
  body: unknown;
  /** a raw text body (the revision JSON, byte for byte) */
  text?: string;
}

const DS_CANVAS = 'design-system.tsx';
const BODY_MAX = 2 * 1024 * 1024;

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

class BadRequest extends Error {}
const bad = (m: string): never => {
  throw new BadRequest(m);
};

const str = (v: unknown, what: string, max = 512): string => {
  if (typeof v !== 'string' || !v || v.length > max) bad(`${what} is a non-empty string`);
  return v as string;
};
const optStr = (v: unknown, what: string): string | undefined =>
  v === undefined || v === null ? undefined : str(v, what);

/** The engine's own words for a system that does not exist — reused for one not seen. */
const unknownSystem = (ds: string) =>
  new DsEngineError('ds-unknown-system', `no design system named ${String(ds).slice(0, 64)}`);
/** …and for a canvas that does not exist. */
const noCanvas = () => new DsEngineError('ds-not-in-system', 'no such canvas');

const forbidden = (): DsOpAnswer => ({
  status: 403,
  body: { error: 'You can’t change this design system.', code: 'forbidden' },
});

/** Any engine / head / revision / generator refusal (all carry `ds-*` code + status). */
function errorAnswer(err: unknown): DsOpAnswer | null {
  if (err instanceof BadRequest)
    return { status: 400, body: { error: err.message, code: 'usage' } };
  const e = err as { code?: unknown; status?: unknown; message?: unknown; detail?: unknown };
  if (e && typeof e.code === 'string' && e.code.startsWith('ds-') && typeof e.status === 'number') {
    return {
      status: e.status,
      body: {
        error: String(e.message ?? e.code).slice(0, 300),
        code: e.code,
        ...(isObj(e.detail) ? { detail: e.detail } : {}),
      },
    };
  }
  return null;
}

function normRel(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 1024) return null;
  let p = raw.replace(/\\/g, '/').replace(/^\/+/, '');
  if (p.startsWith('.design/')) p = p.slice('.design/'.length);
  if (p.split('/').some((s) => s === '..' || s === '.' || s === '')) return null;
  return p;
}

export function dsCanvasOf(engine: DsEngine, ds: string): string | null {
  const s = engine.systems().find((x) => x.name === ds);
  return s ? `${s.path}/${DS_CANVAS}` : null;
}

/** May this session see system `ds` at all? */
function sees(c: DsOpContext, ds: string): boolean {
  if (c.access.role !== null) return true;
  const canvas = dsCanvasOf(c.engine, ds);
  return !!canvas && c.access.seesCanvas(canvas);
}

/** The system named, or the "no such system" refusal (also for one this session can't see). */
function systemFor(c: DsOpContext, raw: unknown): string {
  const ds = str(raw, 'ds', 64);
  if (!c.engine.systems().some((s) => s.name === ds) || !sees(c, ds)) throw unknownSystem(ds);
  return ds;
}

function labelOf(engine: DsEngine, ds: string): string | null {
  try {
    const cfg = JSON.parse(readFileSync(path.join(engine.designRoot, 'config.json'), 'utf8'));
    const e = (Array.isArray(cfg?.designSystems) ? cfg.designSystems : []).find(
      (x: unknown) => isObj(x) && x.name === ds
    );
    return isObj(e) && typeof e.label === 'string' ? e.label.slice(0, 120) : null;
  } catch {
    return null;
  }
}

function levelOf(engine: DsEngine, ds: string): { level: number | null; reasons: string[] } {
  try {
    const cfg = engine.systems().find((s) => s.name === ds);
    if (!cfg) return { level: null, reasons: [] };
    const r = checkSystem(
      loadSystem(diskFs(engine.designRoot), cfg),
      indexRegistry(loadRegistry())
    );
    return { level: r.exit, reasons: r.reasons };
  } catch {
    return { level: null, reasons: [] };
  }
}

/** One system's §2.4 `status` row, scoped to what this session may see. */
function stateRow(c: DsOpContext, ds: string) {
  const st: DsState = c.engine.state(ds);
  const review = st.outside && c.outside ? c.outside.review(ds) : null;
  // without a watcher (the in-process verb) there is no window to wait for: the file is quiet
  const outside = !st.outside
    ? null
    : c.outside
      ? review && {
          files: review.files,
          changes: review.changes,
          otherChanges: review.otherChanges,
        }
      : {
          files: st.outside.files.map((p) => ({ path: p, source: { kind: 'unknown' }, at: null })),
          changes: st.outside.changes,
          otherChanges: st.outside.otherChanges,
        };
  const visible = c.access.canvasOnly
    ? st.leftOut.canvases.filter((p) => c.access.seesCanvas(p))
    : st.leftOut.canvases;
  return {
    name: st.name,
    path: st.path,
    label: labelOf(c.engine, ds),
    converted: st.converted,
    headState: st.headState,
    head: st.head,
    base: st.base,
    drafts: st.drafts,
    ...levelOf(c.engine, ds),
    baseMissing: st.baseMissing,
    waiting: st.waiting,
    pending: st.pending,
    outside: outside ?? null,
    conflicts: outside ? st.conflicts : [],
    leftOut: { count: visible.length, canvases: visible },
    library: st.library,
    trashed: st.trashed,
    publishedInTwoPlaces: st.publishedInTwoPlaces,
  };
}

function reviewBody(c: DsOpContext, ds: string) {
  const r = c.engine.review(ds);
  const canvases = c.access.canvasOnly
    ? r.canvases.filter((x) => c.access.seesCanvas(x.path))
    : r.canvases;
  return { ...r, canvases };
}

const result = (r: { action: string; rev: string | null; actionId: string | null }) => ({
  format: DS_FORMATS.result,
  v: 1,
  action: r.action,
  rev: r.rev,
  actionId: r.actionId,
});

function changed(c: DsOpContext, ds: string) {
  c.outside?.invalidate(ds);
  c.emit?.('ds:changed', { system: ds });
}

/** The revisions list — log order (newest first), with what still points at each. */
function revisionsOf(c: DsOpContext, ds: string) {
  const s = c.engine.systems().find((x) => x.name === ds);
  if (!s) throw unknownSystem(ds);
  const abs = path.join(c.engine.designRoot, s.path);
  const h = readHead(abs);
  const log = h.state === 'ok' ? h.doc.log : [];
  const refs = new Map<string, string[]>();
  const add = (id: string | null | undefined, who: string) => {
    if (!id) return;
    refs.set(id, [...(refs.get(id) ?? []), who]);
  };
  if (h.state === 'ok') {
    add(h.doc.head, 'head');
    if (h.doc.base !== h.doc.head) add(h.doc.base, 'base');
    for (const d of h.doc.drafts) add(d.rev, 'draft');
  }
  for (const canvas of c.engine.canvasesOf(ds)) {
    if (c.access.canvasOnly && !c.access.seesCanvas(canvas)) continue;
    try {
      const meta = JSON.parse(
        readFileSync(
          path.join(c.engine.designRoot, canvas.replace(/\.tsx$/i, '.meta.json')),
          'utf8'
        )
      );
      if (typeof meta?.dsRev === 'string') add(meta.dsRev, canvas);
    } catch {
      /* no meta */
    }
  }
  let ids: string[] = [];
  try {
    ids = readdirSync(path.join(abs, 'revisions'))
      .map((f) => /^([0-9a-f]{64})\.json$/.exec(f)?.[1])
      .filter((x): x is string => !!x);
  } catch {
    ids = [];
  }
  const seen = new Set<string>();
  const rows: {
    id: string;
    at: string | null;
    by: By | null;
    summary: string | null;
    referencedBy: string[];
  }[] = [];
  for (const e of log) {
    if (seen.has(e.rev)) continue;
    seen.add(e.rev);
    rows.push({
      id: e.rev,
      at: e.at ?? null,
      by: e.by ?? null,
      summary: typeof e.summary === 'string' ? e.summary : null,
      referencedBy: refs.get(e.rev) ?? [],
    });
  }
  for (const id of ids.sort())
    if (!seen.has(id))
      rows.push({ id, at: null, by: null, summary: null, referencedBy: refs.get(id) ?? [] });
  return { format: DS_FORMATS.revisions, v: 1, system: ds, revisions: rows };
}

/** One DS operation — the route's handler and the in-process verb both run exactly this. */
export async function runDsOp(
  op: DsOp,
  input: Record<string, unknown>,
  c: DsOpContext
): Promise<DsOpAnswer> {
  try {
    switch (op) {
      case 'state': {
        const names = c.engine
          .systems()
          .map((s) => s.name)
          .filter((n) => sees(c, n));
        if (input.ds !== undefined && input.ds !== null && input.ds !== '') {
          const ds = systemFor(c, input.ds);
          return {
            status: 200,
            body: { format: DS_FORMATS.state, v: 1, systems: [stateRow(c, ds)] },
          };
        }
        return {
          status: 200,
          body: { format: DS_FORMATS.state, v: 1, systems: names.map((n) => stateRow(c, n)) },
        };
      }
      case 'revision': {
        const ds = systemFor(c, input.ds);
        const rev = str(input.rev, 'rev', 64);
        if (!/^[0-9a-f]{64}$/.test(rev)) bad('rev is a revision id (64 lowercase hex)');
        const s = c.engine.systems().find((x) => x.name === ds);
        let text: string | null = null;
        try {
          text = readFileSync(
            path.join(c.engine.designRoot, s?.path ?? '', 'revisions', `${rev}.json`),
            'utf8'
          );
        } catch {
          text = null;
        }
        if (text === null)
          throw new DsEngineError('ds-revision-missing', 'that revision is not on this Mac');
        const v = verifyRevision(rev, text);
        if (!v.ok)
          throw new DsEngineError('ds-revision-invalid', `revision ${rev.slice(0, 12)} is invalid`);
        return { status: 200, body: null, text };
      }
      case 'revisions':
        return { status: 200, body: revisionsOf(c, systemFor(c, input.ds)) };
      case 'usage': {
        const ds = systemFor(c, input.ds);
        if (!c.usage)
          return {
            status: 503,
            body: { error: 'The usage index is not running.', code: 'ds-usage-unavailable' },
          };
        const css = optStr(input.css, 'css');
        const component = optStr(input.component, 'component');
        const q = c.usage.query(ds, {
          ...(css ? { css } : {}),
          ...(component ? { component } : {}),
        });
        const canvases = c.access.canvasOnly
          ? q.canvases.filter((x) => c.access.seesCanvas(x.rel))
          : q.canvases;
        const places = canvases.reduce((n, x) => n + x.places, 0);
        return {
          status: 200,
          body: {
            format: DS_FORMATS.usage,
            v: 1,
            ...q,
            ...(c.access.canvasOnly ? { places: css || component ? places : canvases.length } : {}),
            canvases,
          },
        };
      }
      case 'publish': {
        const ds = systemFor(c, input.ds);
        const review = reviewBody(c, ds);
        if (input.dryRun === true)
          return {
            status: 200,
            body: { format: DS_FORMATS.review, v: 1, ...review, result: null },
          };
        if (!c.access.can('edit', null)) return forbidden();
        if (!('expectHead' in input)) bad('expectHead is the head the review was read at');
        const expectHead =
          input.expectHead === null ? null : str(input.expectHead, 'expectHead', 64);
        const over: { path: string; ticked: boolean }[] = [];
        if (input.canvases !== undefined) {
          if (!Array.isArray(input.canvases)) bad('canvases is a list of {path, ticked}');
          for (const x of input.canvases as unknown[]) {
            const p = isObj(x) ? normRel(x.path) : null;
            if (!p || typeof (x as { ticked?: unknown }).ticked !== 'boolean')
              bad('canvases is a list of {path, ticked}');
            over.push({ path: p as string, ticked: (x as { ticked: boolean }).ticked });
          }
        }
        if (input.leaveOut !== undefined) {
          if (!Array.isArray(input.leaveOut)) bad('leaveOut is a list of canvas paths');
          for (const raw of input.leaveOut as unknown[]) {
            const p = normRel(raw);
            if (!p) bad('leaveOut is a list of canvas paths');
            over.push({ path: p as string, ticked: false });
          }
        }
        const r = await c.engine.publish(ds, { expectHead, canvases: over, by: c.by });
        changed(c, ds);
        return {
          status: 200,
          body: {
            format: DS_FORMATS.review,
            v: 1,
            ...review,
            result: { rev: r.rev, updated: r.updated, leftOut: r.leftOut, actionId: r.actionId },
          },
        };
      }
      case 'pending': {
        const ds = systemFor(c, input.ds);
        if (!c.access.can('edit', dsCanvasOf(c.engine, ds))) return forbidden();
        if (input.cancel !== undefined) {
          const tokens =
            input.cancel === true
              ? undefined
              : Array.isArray(input.cancel) && input.cancel.every((t) => typeof t === 'string')
                ? (input.cancel as string[])
                : bad('cancel is true or a list of token names');
          const r = await c.engine.cancelPending(ds, { by: c.by, ...(tokens ? { tokens } : {}) });
          changed(c, ds);
          return { status: 200, body: result(r) };
        }
        if (input.tokens !== undefined && !isObj(input.tokens)) bad('tokens is an object');
        if (input.components !== undefined && !isObj(input.components))
          bad('components is an object');
        if (input.expect !== undefined && !isObj(input.expect)) bad('expect is an object');
        // an import proposes as itself (S10 §2.2); every other `by` is the session's
        const by: By =
          isObj(input.by) && input.by.kind === 'import' && typeof input.by.name === 'string'
            ? { kind: 'import', name: input.by.name.slice(0, 64) }
            : c.by;
        const r = await c.engine.mergePending(ds, {
          ...(input.tokens ? { tokens: input.tokens as Record<string, PendingToken | null> } : {}),
          ...(input.components ? { components: input.components as PendingComponents } : {}),
          ...(input.expect ? { expect: input.expect as Record<string, string | null> } : {}),
          by,
        });
        changed(c, ds);
        return { status: 200, body: result(r) };
      }
      case 'outside': {
        const ds = systemFor(c, input.ds);
        if (!c.access.can('edit', null)) return forbidden();
        if (input.action !== 'keep' && input.action !== 'undo') bad('action is keep | undo');
        const r =
          input.action === 'keep'
            ? await c.engine.keepOutside(ds, { by: c.by })
            : await c.engine.undoOutside(ds, { by: c.by });
        changed(c, ds);
        return { status: 200, body: result(r) };
      }
      case 'pick': {
        const ds = systemFor(c, input.ds);
        if (!c.access.can('edit', null)) return forbidden();
        if (input.head !== undefined) {
          const head = str(input.head, 'head', 64);
          const r = await c.engine.pickPublished(ds, { head, by: c.by });
          changed(c, ds);
          return { status: 200, body: result(r) };
        }
        const css = str(input.css, 'css', 130);
        if (input.use !== 'canvas' && input.use !== 'file') bad('use is canvas | file');
        const r = await c.engine.pick(ds, { css, use: input.use as 'canvas' | 'file', by: c.by });
        changed(c, ds);
        return { status: 200, body: result(r) };
      }
      case 'canvas': {
        const canvas = normRel(input.canvas);
        if (!canvas) bad('canvas is a design-root-relative .tsx path');
        if (c.access.canvasOnly && !c.access.seesCanvas(canvas as string)) throw noCanvas();
        if (input.action !== 'update' && input.action !== 'leave') bad('action is update | leave');
        if (!c.access.can('edit', canvas)) return forbidden();
        const r =
          input.action === 'update'
            ? await c.engine.canvasUpdate(canvas as string, { by: c.by })
            : await c.engine.canvasLeave(canvas as string, { by: c.by });
        c.emit?.('ds:changed', { canvas });
        return { status: 200, body: result(r) };
      }
      case 'trash':
      case 'restore':
      case 'clear': {
        const ds = systemFor(c, input.ds);
        const allowed = op === 'clear' ? c.access.role === 'owner' : c.access.can('edit', null);
        if (!allowed) return forbidden();
        const css = str(input.css, 'css', 130);
        const expectHead =
          'expectHead' in input
            ? input.expectHead === null
              ? null
              : str(input.expectHead, 'expectHead', 64)
            : c.engine.state(ds).head;
        const r =
          op === 'trash'
            ? await c.engine.trashToken(ds, {
                css,
                replacement: str(input.replacement, 'replacement', 130),
                expectHead,
                by: c.by,
              })
            : op === 'restore'
              ? await c.engine.restoreToken(ds, { css, expectHead, by: c.by })
              : await c.engine.clearToken(ds, { css, expectHead, by: c.by });
        changed(c, ds);
        return { status: 200, body: result(r) };
      }
    }
  } catch (err) {
    const a = errorAnswer(err);
    if (a) return a;
    throw err;
  }
  return { status: 404, body: { error: 'unknown operation', code: 'usage' } };
}

/* ------------------------------------------------------------------ routes */

export interface DsRouteDeps {
  engine: () => DsEngine | null;
  outside?: () => DsOutsideWatcher | null;
  usage?: () => DsUsageIndex | null;
  /** the session's access (http.ts `accessOf`) */
  access: (req: Request) => Access;
  /** the person acting (a cell's vouched member, else this machine's git identity) */
  person: (req: Request) => Promise<{ name: string }>;
  emit?: (event: string, payload: unknown) => void;
}

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function bodyOf(req: Request): Promise<Record<string, unknown> | null> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > BODY_MAX) return null;
  try {
    const text = await req.text();
    if (text.length > BODY_MAX) return null;
    const v = text ? JSON.parse(text) : {};
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

/** The `by` of a request: Claude Code when the verb says so (it only ever LOWERS trust), else the person. */
async function byOf(deps: DsRouteDeps, req: Request): Promise<By> {
  if (req.headers.get('x-maude-by') === 'agent') return { kind: 'agent', name: 'Claude Code' };
  const p = await deps.person(req).catch(() => ({ name: '' }));
  return p.name ? { kind: 'person', name: p.name.slice(0, 64) } : { kind: 'person' };
}

// Literal `method`/`path` pairs: the writer-registry, hub-manifest and CSRF scrapers read them.
const TABLE: ReadonlyArray<{ method: 'GET' | 'POST'; path: string; op: DsOp }> = [
  { method: 'GET', path: '/_api/ds/state', op: 'state' },
  { method: 'GET', path: '/_api/ds/revision', op: 'revision' },
  { method: 'GET', path: '/_api/ds/revisions', op: 'revisions' },
  { method: 'GET', path: '/_api/ds/usage', op: 'usage' },
  { method: 'POST', path: '/_api/ds/publish', op: 'publish' },
  { method: 'POST', path: '/_api/ds/pending', op: 'pending' },
  { method: 'POST', path: '/_api/ds/outside', op: 'outside' },
  { method: 'POST', path: '/_api/ds/pick', op: 'pick' },
  { method: 'POST', path: '/_api/ds/canvas', op: 'canvas' },
  { method: 'POST', path: '/_api/ds/trash', op: 'trash' },
  { method: 'POST', path: '/_api/ds/restore', op: 'restore' },
  { method: 'POST', path: '/_api/ds/clear', op: 'clear' },
];

export function createDsRoutes(deps: DsRouteDeps): RouteSpec[] {
  const ctx = async (req: Request): Promise<DsOpContext | null> => {
    const engine = deps.engine();
    if (!engine) return null;
    return {
      engine,
      outside: deps.outside?.() ?? null,
      usage: deps.usage?.() ?? null,
      access: deps.access(req),
      by: await byOf(deps, req),
      ...(deps.emit ? { emit: deps.emit } : {}),
    };
  };
  const answer = (a: DsOpAnswer) =>
    a.text !== undefined
      ? new Response(a.text, {
          status: a.status,
          headers: { 'content-type': 'application/json', 'Cache-Control': 'no-store' },
        })
      : json(a.status, a.body);
  const unavailable = () =>
    json(503, { error: 'Design systems are not available here.', code: 'ds-unavailable' });

  const gets: RouteSpec[] = TABLE.filter((t) => t.method === 'GET').map(({ path: p, op }) => ({
    method: 'GET',
    path: p,
    origin: 'main',
    readOnly: 'allowed',
    async handle(req) {
      const c = await ctx(req);
      if (!c) return unavailable();
      const q = new URL(req.url).searchParams;
      const input: Record<string, unknown> = {};
      for (const k of ['ds', 'rev', 'css', 'component']) {
        const v = q.get(k);
        if (v !== null) input[k] = v;
      }
      return answer(await runDsOp(op, input, c));
    },
  }));
  const posts: RouteSpec[] = TABLE.filter((t) => t.method === 'POST').map(({ path: p, op }) => ({
    method: 'POST',
    path: p,
    origin: 'main',
    readOnly: 'refused',
    // The local gate judges a canvas-scoped session on THIS target, never on a body key: the DS
    // canvas for `pending`, the canvas for `canvas`, and nothing (project-level) for the rest.
    async target(req) {
      if (op !== 'pending' && op !== 'canvas') return undefined;
      const b = await bodyOf(req.clone());
      if (!b) return null;
      if (op === 'canvas') return normRel(b.canvas);
      const engine = deps.engine();
      return engine && typeof b.ds === 'string' ? dsCanvasOf(engine, b.ds) : null;
    },
    async handle(req) {
      const c = await ctx(req);
      if (!c) return unavailable();
      const b = await bodyOf(req);
      if (!b) return json(400, { error: 'The body is a JSON object.', code: 'usage' });
      return answer(await runDsOp(op, b, c));
    },
  }));
  return [...gets, ...posts];
}
