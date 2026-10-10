// Agent routes — contract V2-1.11 §5.3 (`maude design open`) and §5.4 (the hook routes). A handler
// TABLE the lead registers through the V2-2.5 route table; http.ts is not edited by lanes.
//
// Every route here is for a NON-BROWSER local client — the `maude` CLI and the design plugin's
// hooks. So each one requires (in-handler, on top of whatever the table adds):
//   - a loopback Host (no workspace-mode vouch: a cell's `x-maude-role` proves the request came
//     through the hub proxy, i.e. from a browser, which is exactly who must not call these);
//   - no `Origin` and no `Sec-Fetch-Site` header (browsers always send Sec-Fetch-Site), so a page
//     in another tab can't drive them as a confused deputy.
// MAIN ORIGIN ONLY (DDR-088): never in `CANVAS_SAFE_API`, never in the `startCanvasServer` routes
// map — test/agent-routes-origin.test.ts pins both lists.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

import {
  type AgentRuns,
  artboardSpans,
  changedArtboards,
  createAgentRuns,
  RUN_ACTORS,
  RUN_OUTCOMES,
  type RunActor,
  type RunBracket,
  type RunOutcome,
} from '../agent-runs.ts';
import { checkFile } from '../check/index.ts';
import { checkIds } from '../element-ids.ts';
import type { RouteSpec } from './table.ts';

export interface AgentRouteDeps {
  repoRoot: string;
  /** `.design` (or the configured designRoot, relative to repoRoot) */
  designRel: string;
  /** how many shells (inspector sockets) of this project are attached right now */
  shells: () => number;
  /** ctx.bus.emit — `ui-open` is relayed to the shells by ws.ts */
  emit: (event: string, payload: unknown) => void;
  /** §5.4 edit/check `read-only`: this session may not write the project (role / format gate) */
  readOnly?: () => boolean;
  /** run lifecycle side effects (beginAiAction / ai-activity until V2-1.15) */
  bracket?: RunBracket;
  /** the run registry; one is created per table when absent */
  runs?: AgentRuns;
}

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** The Host header names this machine. Pure. */
export function isLoopbackHostHeader(host: string | null): boolean {
  if (!host) return false;
  let name = host.trim().toLowerCase();
  if (name.startsWith('[')) name = name.slice(0, name.indexOf(']') + 1);
  else name = name.replace(/:\d+$/, '');
  return LOOPBACK.has(name) || /^127(\.\d{1,3}){3}$/.test(name);
}

/** null = a local non-browser client; else the refusal. */
export function localClientRefusal(req: Request): Response | null {
  if (!isLoopbackHostHeader(req.headers.get('host')))
    return json(403, { error: 'local request required', code: 'not-local' });
  if (req.headers.get('origin') || req.headers.get('sec-fetch-site'))
    return json(403, { error: 'agent routes are for the maude CLI and hooks', code: 'browser' });
  return null;
}

/** An artboard / element id: what `data-cd-id` / DCArtboard `id` use. */
export const AGENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
export const OPEN_MODES = ['edit', 'preview', 'present'] as const;
export const OPEN_SELECTS = ['all', 'none', 'annotations'] as const;
export type OpenMode = (typeof OPEN_MODES)[number];
export type OpenSelect = (typeof OPEN_SELECTS)[number];

export interface UiOpen {
  /** designRoot-relative canvas, e.g. `ui/Pricing.tsx` */
  canvas: string;
  /** the shell's tab key: designRel-prefixed (`.design/ui/Pricing.tsx`) */
  file: string;
  artboard?: string;
  element?: string;
  mode?: OpenMode;
  select?: OpenSelect;
}

/**
 * A designRoot-relative canvas path, or null. POSIX, no `..`, no absolute, no runtime (`_*`) or
 * hidden segment, `.tsx` only.
 */
export function canvasRel(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return null;
  if (raw.includes('\\') || raw.includes('\0') || raw.startsWith('/')) return null;
  const segs = raw.split('/');
  if (
    segs.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('_') || s.startsWith('.'))
  )
    return null;
  if (!raw.endsWith('.tsx')) return null;
  return raw;
}

/** Validate a `POST /_api/ui/open` body. Pure. */
export function parseUiOpen(
  body: unknown,
  designRel: string
): { ok: true; open: UiOpen } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return { ok: false, error: 'body must be a JSON object' };
  const b = body as Record<string, unknown>;
  const known = new Set(['canvas', 'artboard', 'element', 'mode', 'select']);
  const extra = Object.keys(b).filter((k) => !known.has(k));
  if (extra.length) return { ok: false, error: `unknown field ${extra[0]}` };
  const canvas = canvasRel(b.canvas);
  if (!canvas) return { ok: false, error: 'canvas is a .tsx path inside the design root' };
  const open: UiOpen = { canvas, file: path.posix.join(designRel, canvas) };
  for (const k of ['artboard', 'element'] as const) {
    if (b[k] === undefined) continue;
    if (typeof b[k] !== 'string' || !AGENT_ID_RE.test(b[k] as string))
      return { ok: false, error: `${k} is an id ([A-Za-z0-9_.:-], ≤ 128)` };
    open[k] = b[k] as string;
  }
  if (b.mode !== undefined) {
    if (!OPEN_MODES.includes(b.mode as OpenMode))
      return { ok: false, error: `mode is ${OPEN_MODES.join(' | ')}` };
    open.mode = b.mode as OpenMode;
  }
  if (b.select !== undefined) {
    if (!OPEN_SELECTS.includes(b.select as OpenSelect))
      return { ok: false, error: `select is ${OPEN_SELECTS.join(' | ')}` };
    if (open.element) return { ok: false, error: 'select and an @element are exclusive' };
    open.select = b.select as OpenSelect;
  }
  return { ok: true, open };
}

function insideDesignRoot(deps: AgentRouteDeps, rel: string): boolean {
  const designRoot = path.join(deps.repoRoot, deps.designRel);
  const abs = path.join(designRoot, rel);
  if (!existsSync(abs)) return false;
  try {
    const real = realpathSync(abs);
    const base = realpathSync(designRoot);
    return real.startsWith(base + path.sep);
  } catch {
    return false;
  }
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

// ── §5.4 hook routes ─────────────────────────────────────────────────────────────────────────

/** Claude Code's session_id / tool_use_id / prompt id: a safe single path segment. */
export const HOOK_KEY_RE = /^[A-Za-z0-9_-]{1,128}$/;
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] as const;
/** a run snapshot the hook wrote: `_runs/<session>/{snap|base}/<name>` */
const SNAPSHOT_RE = /^_runs\/[A-Za-z0-9_-]{1,128}\/(?:snap|base)\/[A-Za-z0-9_.-]{1,160}$/;
const CANVAS_RE = /\.(?:tsx|jsx)$/;
const NONE = { decision: 'none' } as const;

/** A designRoot-relative POSIX file path (any kind), or null. No `..`, absolute, or hidden segment. */
export function designPathRel(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return null;
  if (raw.includes('\\') || raw.includes('\0') || raw.startsWith('/')) return null;
  const segs = raw.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'))) return null;
  return raw;
}

const isRuntimeRel = (rel: string) => rel.startsWith('_');
const whoName = (a: RunActor) => (a === 'maude-chat' ? 'the Maude chat' : 'a Claude Code session');

/** The bytes of a designRoot file (realpath-contained), or null when absent / outside. */
function readDesignFile(deps: AgentRouteDeps, rel: string): string | null {
  const designRoot = path.join(deps.repoRoot, deps.designRel);
  try {
    const real = realpathSync(path.join(designRoot, rel));
    if (!real.startsWith(realpathSync(designRoot) + path.sep)) return null;
    return readFileSync(real, 'utf8');
  } catch {
    return null;
  }
}

/** What the tool will write, from the current bytes + the hook's `edit`. null = can't tell. */
function applyToolEdit(before: string | null, edit: unknown): string | null {
  if (!edit || typeof edit !== 'object') return null;
  const e = edit as { old?: unknown; new?: unknown; replaceAll?: unknown; content?: unknown };
  if (typeof e.content === 'string') return e.content;
  if (before === null || typeof e.old !== 'string' || typeof e.new !== 'string') return null;
  if (!e.old || !before.includes(e.old)) return null;
  const next = e.new;
  return e.replaceAll === true ? before.split(e.old).join(next) : before.replace(e.old, () => next);
}

type Body = Record<string, unknown>;
const bad = (error: string) => json(400, { error, code: 'usage' });
async function hookBody(req: Request): Promise<Body | Response> {
  const refused = localClientRefusal(req);
  if (refused) return refused;
  const b = await readJson(req);
  if (!b || typeof b !== 'object' || Array.isArray(b)) return bad('body must be a JSON object');
  return b as Body;
}
const key = (b: Body, k: string) =>
  typeof b[k] === 'string' && HOOK_KEY_RE.test(b[k] as string) ? (b[k] as string) : null;

function hookRouteSpecs(deps: AgentRouteDeps): RouteSpec[] {
  const runs = deps.runs ?? createAgentRuns(deps.bracket);
  // `{ path }` literal so the writer-registry scrape (test/sync-writer-registry.test.ts) sees each route
  const spec = ({ path: p }: { path: string }, handle: (b: Body) => Response): RouteSpec => ({
    method: 'POST',
    path: p,
    origin: 'main',
    // the run bracket must work in a read-only session too; edit/check answers `read-only` itself
    readOnly: 'allowed',
    async handle(req) {
      const b = await hookBody(req);
      return b instanceof Response ? b : handle(b);
    },
  });
  return [
    spec({ path: '/_api/agent/run/begin' }, (b) => {
      const session = key(b, 'session');
      if (!session) return bad('session is a hook key ([A-Za-z0-9_-], ≤ 128)');
      if (b.promptId !== undefined && !key(b, 'promptId')) return bad('promptId is a hook key');
      if (!RUN_ACTORS.includes(b.actor as RunActor))
        return bad(`actor is ${RUN_ACTORS.join(' | ')}`);
      if (b.label !== undefined && (typeof b.label !== 'string' || b.label.length > 80))
        return bad('label is a string ≤ 80');
      const r = runs.begin({
        session,
        promptId: b.promptId as string | undefined,
        actor: b.actor as RunActor,
        label: b.label as string | undefined,
      });
      return json(200, { run: r.run, state: r.state });
    }),
    spec({ path: '/_api/agent/edit/check' }, (b) => {
      const session = key(b, 'session');
      const toolUseId = key(b, 'toolUseId');
      const rel = designPathRel(b.path);
      if (!session || !toolUseId) return bad('session and toolUseId are hook keys');
      if (!EDIT_TOOLS.includes(b.tool as (typeof EDIT_TOOLS)[number]))
        return bad(`tool is ${EDIT_TOOLS.join(' | ')}`);
      if (!rel) return bad('path is a file inside the design root');
      if (deps.readOnly?.())
        return json(200, {
          decision: 'deny',
          code: 'read-only',
          reason:
            'read-only: this project is open view-only here, so nothing in it can be edited. Ask its owner for edit access, or describe the change instead.',
        });
      if (!CANVAS_RE.test(rel) || isRuntimeRel(rel)) return json(200, NONE);
      const before = readDesignFile(deps, rel);
      const after = applyToolEdit(before, b.edit);
      // an edit we can't replay (MultiEdit, old text not found) on an existing canvas reaches the file
      const reach =
        after !== null
          ? changedArtboards(before, after)
          : before !== null
            ? { scope: 'file' as const, artboards: [] }
            : null;
      if (!reach) return json(200, NONE);
      const target = reach.scope === 'file' ? ('*' as const) : reach.artboards;
      if (target !== '*' && target.length === 0) return json(200, NONE);
      const c = runs.conflict(session, rel, target);
      if (c)
        return json(200, {
          decision: 'deny',
          code: 'artboard-busy',
          who: whoName(c.who),
          artboards: [c.artboard],
          reason:
            `artboard-busy: ${c.artboard} is busy — ${whoName(c.who)} is changing it` +
            `${c.label ? ` ("${c.label}")` : ''}` +
            `${reach.scope === 'file' ? ` (this change reaches every artboard of ${rel})` : ''}. ` +
            `Work on the other artboards without touching code they share; ${c.artboard} is free again when that run ends. ` +
            `Or duplicate the ${c.artboard} DCArtboard beside it with a new id and edit the copy.`,
        });
      runs.claim(session, rel, target);
      return json(200, NONE);
    }),
    spec({ path: '/_api/agent/check' }, (b) => {
      const rel = designPathRel(b.path);
      if (!rel) return bad('path is a file inside the design root');
      if (b.tier !== 'fast' && b.tier !== 'stop') return bad('tier is fast | stop');
      if (
        b.snapshot !== undefined &&
        (typeof b.snapshot !== 'string' || !SNAPSHOT_RE.test(b.snapshot))
      )
        return bad('snapshot is a run snapshot under _runs/');
      const text = readDesignFile(deps, rel);
      if (text === null) return json(404, { error: `no file ${rel}`, code: 'not-found' });
      const against = typeof b.snapshot === 'string' ? readDesignFile(deps, b.snapshot) : null;
      const r = checkFile(rel, text, { against, tier: b.tier, strict: true });
      if (r.ok) return json(200, { ok: true });
      return json(200, {
        ok: false,
        errors: r.errors.map((e) => ({ code: e.code, where: e.where, what: e.what, fix: e.fix })),
      });
    }),
    spec({ path: '/_api/agent/edit/touched' }, (b) => {
      const session = key(b, 'session');
      const toolUseId = key(b, 'toolUseId');
      if (!session || !toolUseId) return bad('session and toolUseId are hook keys');
      if (b.via !== 'tool' && b.via !== 'bash') return bad('via is tool | bash');
      const empty = { artboards: [] as string[], lostIds: [] as string[], trashed: [] as string[] };
      // via:'bash' binds a `maude design` write verb's writes to the run — lands with post-bash.
      if (b.via === 'bash') return json(200, empty);
      const rel = designPathRel(b.path);
      if (!rel) return bad('path is a file inside the design root');
      if (isRuntimeRel(rel)) return json(200, empty);
      let artboards: string[] = [];
      let lostIds: string[] = [];
      if (CANVAS_RE.test(rel)) {
        const after = readDesignFile(deps, rel) ?? '';
        const snap = `_runs/${session}/snap/${toolUseId}`;
        const before = readDesignFile(deps, snap);
        const isNew = before === null && readDesignFile(deps, `${snap}.new`) !== null;
        if (before === null && !isNew) artboards = (artboardSpans(after) ?? []).map((s) => s.id);
        else artboards = changedArtboards(before, after).artboards;
        if (before !== null) lostIds = checkIds(after, { against: before, path: rel }).lostIds;
      }
      runs.touch(session, rel, artboards);
      return json(200, { ...empty, artboards, lostIds });
    }),
    spec({ path: '/_api/agent/run/end' }, (b) => {
      const session = key(b, 'session');
      if (!session) return bad('session is a hook key');
      if (!RUN_OUTCOMES.includes(b.outcome as RunOutcome))
        return bad(`outcome is ${RUN_OUTCOMES.join(' | ')}`);
      const r = runs.end(session, b.outcome as RunOutcome);
      // undoStep / version (V2-1.5) land with the run model; an unknown session is a no-op
      return json(200, r ? { run: r.run, state: r.state } : {});
    }),
  ];
}

export function agentRouteSpecs(deps: AgentRouteDeps): RouteSpec[] {
  return [
    ...hookRouteSpecs(deps),
    {
      // §5.3 `maude design open` — show a canvas / artboard / element / mode in the user's window.
      // Effect none: it moves the user's view, never a file — so a read-only session may call it.
      method: 'POST',
      path: '/_api/ui/open',
      origin: 'main',
      readOnly: 'allowed',
      async handle(req) {
        const refused = localClientRefusal(req);
        if (refused) return refused;
        const parsed = parseUiOpen(await readJson(req), deps.designRel);
        if (!parsed.ok) return json(400, { error: parsed.error, code: 'usage' });
        if (!insideDesignRoot(deps, parsed.open.canvas))
          return json(404, { error: `no canvas ${parsed.open.canvas}`, code: 'not-found' });
        const shells = deps.shells();
        if (shells === 0)
          return json(409, { error: 'No Maude window is showing this project', code: 'no-window' });
        deps.emit('ui-open', parsed.open);
        return json(200, { ok: true, shells, open: parsed.open });
      },
    },
  ];
}
