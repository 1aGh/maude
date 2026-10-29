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

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseSync } from 'oxc-parser';
import { designWritesSince } from '../../../cli/lib/bash-guard.mjs';
import { cleanText, fileText } from '../../../cli/lib/finding-text.mjs';
import {
  type AgentRuns,
  artboardSpans,
  changedArtboards,
  changedElements,
  createAgentRuns,
  elementsOutsideScope,
  RUN_ACTORS,
  RUN_OUTCOMES,
  type RunActor,
  type RunBracket,
  type RunConflict,
  type RunOutcome,
  type RunScope,
} from '../agent-runs.ts';
import type { RunRecord } from '../ai/run-lifecycle.ts';
import type { RunRegistry } from '../ai/runs.ts';
import { claimedSince } from '../ai/write-claim.ts';
import { artboardIdsOfSource, checkFile, checkIntroduced, type Finding } from '../check/index.ts';
import { checkIds, walkIdElements } from '../element-ids.ts';
import type { RouteSpec } from './table.ts';

/** A person's hold on an element (A10: the awareness `holding` field, foreign and local). */
export interface PersonHold {
  /** designRoot-relative canvas */
  canvas: string;
  /** the held element's `data-cd-id` */
  element: string;
  /** the person's display name, as the awareness carries it (untrusted peer text) */
  name: string;
}

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
  /**
   * V2-1.15 §4 #13 — the people holding an element right now (awareness `holding`, S2.18). An
   * AI write on one is denied `soft-locked`. Absent = nobody holds anything.
   */
  personHolds?: (canvas?: string) => PersonHold[];
  /** A member's display name for a lease home `actor` (the project's members), else null. */
  memberName?: (actor: string) => string | null;
  /**
   * p8-a1-claims — claim the bytes a disk-writing verb is about to write for `chat`'s LIVE run
   * (ai/write-claim.ts). `rel` is design-root-relative. null = no live run of that chat: nothing claimed.
   */
  claimWrites?: (
    chat: string,
    writes: Array<{ rel: string; content: string }>
  ) => { runId: string } | null;
}

/** POST /_api/agent/write/claim — at most this many files per call, this many bytes in all. */
export const CLAIM_MAX_FILES = 32;
export const CLAIM_MAX_BYTES = 16 * 1024 * 1024;
/** The canvas lanes a claim may name: a canvas source, its sidecar, its board. */
const CLAIM_LANE_RE = /\.(?:tsx|meta\.json|annotations\.json)$/i;

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
/** S12.8 (D11) — `maude design open --panel <id>`: the panels and sheets the UI opens from a menu. */
export const OPEN_PANELS = [
  'trash',
  'design-system',
  'layers-panel',
  'layers',
  'inspector',
  'settings',
  'shortcuts',
  'whats-new',
] as const;
export type OpenMode = (typeof OPEN_MODES)[number];
export type OpenSelect = (typeof OPEN_SELECTS)[number];
export type OpenPanel = (typeof OPEN_PANELS)[number];

export interface UiOpen {
  /** designRoot-relative canvas, e.g. `ui/Pricing.tsx` (absent for a `panel` open) */
  canvas?: string;
  /** the shell's tab key: designRel-prefixed (`.design/ui/Pricing.tsx`) */
  file?: string;
  /** S12.8 — a panel, with no canvas */
  panel?: OpenPanel;
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
  const known = new Set(['canvas', 'artboard', 'element', 'mode', 'select', 'panel']);
  const extra = Object.keys(b).filter((k) => !known.has(k));
  if (extra.length) return { ok: false, error: `unknown field ${extra[0]}` };
  if (b.panel !== undefined) {
    // a panel is its own target: it moves the user's view to a sheet, so no canvas goes with it
    if (!OPEN_PANELS.includes(b.panel as OpenPanel))
      return { ok: false, error: `panel is ${OPEN_PANELS.join(' | ')}` };
    if (Object.keys(b).length > 1) return { ok: false, error: 'a panel takes no other field' };
    return { ok: true, open: { panel: b.panel as OpenPanel } };
  }
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
/** edit/touched {via:'bash'}: a `since` older than this is refused (a planted 0 would bind every file). */
export const BASH_WINDOW_MS = 15 * 60 * 1000;

/** A designRoot-relative POSIX file path (any kind), or null. No `..`, absolute, or hidden segment. */
export function designPathRel(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return null;
  if (raw.includes('\\') || raw.includes('\0') || raw.startsWith('/')) return null;
  const segs = raw.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'))) return null;
  return raw;
}

const isRuntimeRel = (rel: string) => rel.startsWith('_');

/** A run/begin `scope` → RunScope, or null when it is malformed. Pure. */
export function parseRunScope(raw: unknown): RunScope | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as { canvas?: unknown; artboards?: unknown };
  const canvas = canvasRel(r.canvas);
  if (!canvas) return null;
  if (r.artboards === undefined) return { canvas, artboards: [] };
  if (
    !Array.isArray(r.artboards) ||
    r.artboards.length > 64 ||
    !r.artboards.every((a) => typeof a === 'string' && AGENT_ID_RE.test(a))
  )
    return null;
  return { canvas, artboards: [...new Set(r.artboards as string[])] };
}
const whoName = (a: RunActor) => (a === 'maude-chat' ? 'the Maude chat' : 'a Claude Code session');
/** A person's name as a reason names it: plain when it is a plain name, else cleaned + quoted. */
const PLAIN_NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,59}$/u;
const nameText = (n: string) => (PLAIN_NAME_RE.test(n) ? n : fileText(n, 60));

// Phase 2 gate F3: a deny reason reaches the model as a PreToolUse reason, with harness authority,
// and a cloned / linked canvas plants the artboard ids and element labels it names. So a reason is
// built only from values that are either within a strict charset (an id by AGENT_ID_RE, a plain
// path) or cleaned + capped + JSON-quoted (cli/lib/finding-text.mjs, the check findings' rules).
const SAFE_REL_RE = /^[A-Za-z0-9 _./()-]{1,200}$/;
/** An artboard / element id as a reason names it. */
const idText = (id: unknown) =>
  typeof id === 'string' && AGENT_ID_RE.test(id) ? id : fileText(id);
/** A designRoot-relative path as a reason names it. */
const relText = (rel: unknown) =>
  typeof rel === 'string' && SAFE_REL_RE.test(rel) ? rel : fileText(rel, 200);
const idsText = (ids: string[]) =>
  `${ids.slice(0, 6).map(idText).join(', ')}${ids.length > 6 ? ` (+${ids.length - 6})` : ''}`;
/** Artboard ids a claim or a response may carry: the id rule only. */
const validIds = (ids: string[]) => ids.filter((a) => AGENT_ID_RE.test(a));
/** The longest reason the studio sends (the hook cleans and caps again). */
const REASON_MAX = 800;
const reasonOf = (s: string) => cleanText(s, REASON_MAX);

/**
 * V2-1.15 §5.4 — who holds the artboard, as a deny reason names it. Never the holder's label,
 * prompt or chat: only whose AI it is. A member is named by `memberName`, else "another person".
 */
function holderText(c: RunConflict, memberName?: (actor: string) => string | null): string {
  if (c.mine)
    return c.who === 'maude-chat' ? 'your AI in another chat' : 'your AI in another session';
  const n = c.actor ? (memberName?.(c.actor) ?? null) : null;
  return n ? `${nameText(n)}'s AI` : "another person's AI";
}

function busyReason(
  c: RunConflict,
  rel: string,
  wholeFile: boolean,
  o: { holder: string; inChat: boolean }
): string {
  const all = c.artboard === '*';
  const ab = all ? 'every artboard' : idText(c.artboard);
  const head = `artboard-busy: ${all ? `${relText(rel)} is` : `${ab} is`} busy — ${o.holder} is changing it${wholeFile ? ` (this change reaches every artboard of ${relText(rel)})` : ''}. `;
  const back = o.inChat
    ? `Work on the other artboards without touching code they share; ${all ? 'the canvas' : ab} comes back to this chat when it is free. `
    : `Work on the other artboards without touching code they share; ${all ? 'the canvas' : ab} is free again when that run ends (\`maude design runs list\` shows the runs). `;
  return (
    head +
    back +
    (all
      ? 'Or wait for that run to end.'
      : `Or duplicate the ${ab} DCArtboard beside it with a new id and edit the copy.`)
  );
}

function leaseLostReason(lost: RunRecord, rel: string, inChat: boolean): string {
  const scoped = lost.scope && lost.scope.artboards !== '*' ? lost.scope.artboards : [];
  const ids = validIds(scoped.length ? scoped : (lost.touched[rel] ?? []));
  const what = ids.length ? idsText(ids) : relText(rel);
  return inChat
    ? `lease-lost: this chat lost its turn on ${what} while this Mac was asleep, and another AI changed it meanwhile. Stop editing; the person decides whether to keep going.`
    : `lease-lost: this session lost its turn on ${what} while this Mac was asleep, and another AI changed it meanwhile. Stop editing for this prompt; \`maude design runs list\` shows who holds it now.`;
}

/** The import declarations of a module + the rest of it (whitespace between imports dropped). */
function importsAndRest(src: string): { imps: string[]; rest: string } | null {
  const parsed = parseSync('canvas.tsx', src, { sourceType: 'module', lang: 'tsx' });
  if (parsed.errors.length) return null;
  const imps: string[] = [];
  const parts: string[] = [];
  let pos = 0;
  for (const n of parsed.program.body as Array<{ type: string; start: number; end: number }>) {
    if (n.type !== 'ImportDeclaration') continue;
    parts.push(src.slice(pos, n.start));
    imps.push(src.slice(n.start, n.end).replace(/\s+/g, ' ').trim());
    pos = n.end;
  }
  parts.push(src.slice(pos));
  const kept = parts.map((x, i) => (i === parts.length - 1 ? x.trimStart() : x.trim()));
  return { imps, rest: kept.filter((x, i) => x || i === kept.length - 1).join('\u0000') };
}

/**
 * V2-1.15 §4 #9 — "an import-only addition needs no lease": `after` is `before` plus import
 * declarations, nothing else changed. Pure.
 */
export function importOnlyAddition(before: string, after: string): boolean {
  if (before === after) return false;
  const a = importsAndRest(before);
  const b = importsAndRest(after);
  if (!a || !b || a.rest !== b.rest || b.imps.length <= a.imps.length) return false;
  const left = [...b.imps];
  for (const imp of a.imps) {
    const at = left.indexOf(imp);
    if (at < 0) return false;
    left.splice(at, 1);
  }
  return true;
}

/** The [from, to) range of `before` that turning it into `after` rewrites. Pure. */
function changedRange(before: string, after: string): { from: number; to: number } {
  let p = 0;
  const max = Math.min(before.length, after.length);
  while (p < max && before.charCodeAt(p) === after.charCodeAt(p)) p++;
  let s = 0;
  while (
    s < max - p &&
    before.charCodeAt(before.length - 1 - s) === after.charCodeAt(after.length - 1 - s)
  )
    s++;
  return { from: p, to: before.length - s };
}

/**
 * The held elements an edit reaches: an element is reached when the rewritten range of `before`
 * overlaps it (an insertion: falls strictly inside it). `after` null = can't tell → every hold.
 */
function heldReached(before: string, after: string | null, held: PersonHold[]): PersonHold[] {
  if (!held.length) return [];
  if (after === null) return held;
  const walk = walkIdElements(before);
  if (!walk.ok) return held;
  const { from, to } = changedRange(before, after);
  const out: PersonHold[] = [];
  for (const h of held) {
    const hit = walk.elements.some(
      (e) =>
        e.id === h.element &&
        (from === to ? e.start < from && from < e.end : e.start < to && from < e.end)
    );
    if (hit) out.push(h);
  }
  return out;
}

// ── 409 held-by-ai — the data feed for S2's person-edit routes (V2-1.15 §4 #13) ────────────────

export interface AiHold {
  run: string;
  /** a run of this Mac's person (Stop is in the AI chat) — else a member's */
  mine: boolean;
  artboard: string;
  element: string;
}

/**
 * The live AI run that holds `element` of `canvas` (designRoot-relative), or null. An AI hold
 * is a running run's `objects` plus its scope elements; a waiting run holds nothing. A person's
 * hold is never here: between people a hold is advisory (DDR-120).
 */
export function heldByAi(registry: RunRegistry, canvas: string, element: string): AiHold | null {
  const key = registry.canvasKey(canvas);
  const on = (c: string) => c === key || c === canvas;
  for (const r of registry.live()) {
    if (r.state === 'waiting') continue;
    const refs = [...r.objects, ...(r.scope?.elements ?? [])];
    const o = refs.find((x) => on(x.canvas) && x.element === element);
    if (o) return { run: r.runId, mine: true, artboard: o.artboard, element };
  }
  for (const r of registry.view().others) {
    if (r.state === 'waiting') continue;
    const o = r.objects.find((x) => on(x.canvas) && x.element === element);
    if (o) return { run: r.runId, mine: false, artboard: o.artboard, element };
  }
  return null;
}

/**
 * The backstop S2.18 puts in front of a person's edit route (`/_api/edit-*`, `edit-op`): 409
 * `held-by-ai` when a live AI run holds the element, else null. `canvas` is the route body's
 * (`.design/…` or designRoot-relative), `element` its `id`. The message names only the element.
 */
export function heldByAiRefusal(
  registry: RunRegistry,
  designRel: string,
  canvas: unknown,
  element: unknown
): Response | null {
  if (typeof canvas !== 'string' || typeof element !== 'string' || !element) return null;
  const prefix = `${designRel.replace(/\/+$/, '')}/`;
  const rel = canvas.startsWith(prefix) ? canvas.slice(prefix.length) : canvas;
  const hold = heldByAi(registry, rel, element);
  if (!hold) return null;
  const el = AGENT_ID_RE.test(element) ? element : 'This element';
  const message = `${el} is AI's until it's done${hold.mine ? ' · Stop in the AI chat' : ''}`;
  return json(409, {
    ok: false,
    code: 'held-by-ai',
    message,
    error: message,
    artboard: hold.artboard,
  });
}

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
/** `chat` (MAUDE_CHAT_ID, sent by `maude design hook`): absent → null, malformed → undefined. */
const chatOf = (b: Body): string | null | undefined =>
  b.chat === undefined ? null : (key(b, 'chat') ?? undefined);
const BAD_CHAT = 'chat is a hook key ([A-Za-z0-9_-], ≤ 128)';

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
  /**
   * C17: park every DCArtboard block `before` had and `after` lost in the trash, with its
   * position — `_trash/<stamp>__<canvas>__<artboard>/` holds `<artboard>.artboard.tsx` (the block,
   * verbatim) + `_trash-manifest.json` {kind:'artboard', canvas, artboard, position, by:'ai'}.
   * Runtime state (DDR-115), never synced. Returns the parked ids; never throws.
   */
  function parkRemovedArtboards(rel: string, before: string, after: string, session: string) {
    const was = artboardSpans(before);
    const now = artboardSpans(after);
    if (!was || !now) return [];
    const left = new Set(now.map((s) => s.id));
    const removed = was.filter((s) => !left.has(s.id));
    if (!removed.length) return [];
    const designRoot = path.join(deps.repoRoot, deps.designRel);
    let layout: Array<{ id?: unknown; x?: unknown; y?: unknown }> = [];
    try {
      const meta = JSON.parse(
        readDesignFile(deps, rel.replace(/\.(?:tsx|jsx)$/, '.meta.json')) ?? '{}'
      );
      if (Array.isArray(meta?.layout?.artboards)) layout = meta.layout.artboards;
    } catch {
      /* no position */
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const slug = rel.replace(/\.(?:tsx|jsx)$/, '').replace(/[^A-Za-z0-9_.-]/g, '__');
    const parked: string[] = [];
    for (const s of removed) {
      const safeId = s.id.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64) || 'artboard';
      const at = layout.find((a) => a?.id === s.id);
      const position =
        at && typeof at.x === 'number' && typeof at.y === 'number' ? { x: at.x, y: at.y } : null;
      try {
        const dir = path.join(designRoot, '_trash', `${stamp}__${slug}__${safeId}`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, `${safeId}.artboard.tsx`), before.slice(s.start, s.end));
        writeFileSync(
          path.join(dir, '_trash-manifest.json'),
          `${JSON.stringify(
            {
              kind: 'artboard',
              canvas: rel,
              artboard: s.id,
              position,
              deletedAt: new Date().toISOString(),
              by: 'ai',
              session,
            },
            null,
            2
          )}\n`
        );
        parked.push(s.id);
      } catch {
        /* parking is best effort: the snapshot still holds the bytes */
      }
    }
    return parked;
  }

  /** Artboards + lost ids of one changed canvas, from a snapshot when there is one. */
  function canvasChange(
    rel: string,
    snapRel: string | null,
    session = ''
  ): {
    artboards: string[];
    lostIds: string[];
    trashed: string[];
    elements: Array<{ artboard: string; element: string }>;
  } {
    const after = readDesignFile(deps, rel) ?? '';
    const before = snapRel ? readDesignFile(deps, snapRel) : null;
    const isNew =
      snapRel !== null && before === null && readDesignFile(deps, `${snapRel}.new`) !== null;
    if (before === null && !isNew)
      return {
        artboards: (artboardSpans(after) ?? []).map((s) => s.id),
        lostIds: [],
        trashed: [],
        elements: [],
      };
    return {
      artboards: changedArtboards(before, after).artboards,
      // S5.5b — the elements it changed: the run holds them (409 held-by-ai) until it ends
      elements: changedElements(before, after),
      lostIds: before !== null ? checkIds(after, { against: before, path: rel }).lostIds : [],
      trashed: before !== null ? parkRemovedArtboards(rel, before, after, session) : [],
    };
  }

  /**
   * §5.4 post-bash: bind the versioned files a `maude design` write verb changed in this tool
   * call's window (mtime ≥ `since`, which pre-bash recorded) to the session's run — else to the
   * single open AI run on the project, else to no run (the artboards are still reported).
   */
  function bindBashWrites(
    session: string,
    toolUseId: string,
    since: unknown,
    chat: string | null,
    /**
     * p8-a1-claims — the call's only writers were claiming `maude design` verbs: bind only the files
     * this chat's verbs claimed since the call began, never whatever else changed meanwhile (a person's
     * own save). Absent = the S7 interpreter fallback (a python heredoc cannot claim).
     */
    claimedOnly = false
  ) {
    const out = { artboards: [] as string[], lostIds: [] as string[], trashed: [] as string[] };
    const now = Date.now();
    if (
      typeof since !== 'number' ||
      !Number.isFinite(since) ||
      since > now ||
      now - since > BASH_WINDOW_MS
    )
      return out;
    const run = runs.get(session, chat) ?? runs.soleOpen();
    const designRoot = path.join(deps.repoRoot, deps.designRel);
    const mark = readDesignFile(deps, `_runs/${session}/bash/${toolUseId}.json`);
    let snaps: Record<string, unknown> = {};
    try {
      const m = mark ? JSON.parse(mark) : null;
      if (m && typeof m.snaps === 'object' && m.snaps) snaps = m.snaps;
    } catch {
      /* no snapshots: every artboard of a changed canvas */
    }
    const mine = claimedOnly && chat ? claimedSince(chat, since) : null;
    for (const rel of designWritesSince(designRoot, since)) {
      if (mine && !mine.has(rel)) continue;
      let artboards: string[] = [];
      let elements: Array<{ artboard: string; element: string }> = [];
      if (CANVAS_RE.test(rel)) {
        const name = snaps[rel];
        const snap =
          typeof name === 'string' && /^[A-Za-z0-9_.-]{1,160}$/.test(name)
            ? `_runs/${session}/snap/${name}`
            : null;
        const c = canvasChange(rel, snap, session);
        artboards = c.artboards;
        elements = c.elements;
        out.lostIds.push(...c.lostIds);
        out.trashed.push(...c.trashed);
      }
      for (const a of artboards) if (!out.artboards.includes(a)) out.artboards.push(a);
      if (run) runs.touch(run.session || session, rel, artboards, chat, elements);
    }
    return out;
  }

  return [
    spec({ path: '/_api/agent/run/begin' }, (b) => {
      const session = key(b, 'session');
      if (!session) return bad('session is a hook key ([A-Za-z0-9_-], ≤ 128)');
      const chat = chatOf(b);
      if (chat === undefined) return bad(BAD_CHAT);
      if (b.promptId !== undefined && !key(b, 'promptId')) return bad('promptId is a hook key');
      if (!RUN_ACTORS.includes(b.actor as RunActor))
        return bad(`actor is ${RUN_ACTORS.join(' | ')}`);
      if (b.label !== undefined && (typeof b.label !== 'string' || b.label.length > 80))
        return bad('label is a string ≤ 80');
      const scope = b.scope === undefined ? undefined : parseRunScope(b.scope);
      if (scope === null)
        return bad('scope is {canvas: a .tsx in the design root, artboards?: id[] ≤ 64}');
      const r = runs.begin({
        session,
        promptId: b.promptId as string | undefined,
        actor: b.actor as RunActor,
        label: b.label as string | undefined,
        ...(scope ? { scope } : {}),
        // V2-1.15 §5.4 / H5: a Maude chat's hook binds to that chat's `starting` run
        ...(chat ? { chat } : {}),
      });
      return json(200, { run: r.run, state: r.state });
    }),
    spec({ path: '/_api/agent/edit/check' }, (b) => {
      const session = key(b, 'session');
      const toolUseId = key(b, 'toolUseId');
      const rel = designPathRel(b.path);
      if (!session || !toolUseId) return bad('session and toolUseId are hook keys');
      const chat = chatOf(b);
      if (chat === undefined) return bad(BAD_CHAT);
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
      // §5.9.4 / §5.6: this turn's run lost its leases — nothing more of the turn is written
      const gone = runs.lost(session, chat);
      if (gone)
        return json(200, {
          decision: 'deny',
          code: 'lease-lost',
          artboards: validIds(
            gone.scope && gone.scope.artboards !== '*' ? gone.scope.artboards : []
          ),
          reason: reasonOf(leaseLostReason(gone, rel, !!chat || gone.origin === 'maude-chat')),
        });
      const before = readDesignFile(deps, rel);
      const after = applyToolEdit(before, b.edit);
      // V2-1.15 §4 #9: an import-only addition needs no lease (and is inside every scope)
      if (before !== null && after !== null && importOnlyAddition(before, after))
        return json(200, NONE);
      // an edit we can't replay (MultiEdit, old text not found) on an existing canvas reaches the file
      const reach =
        after !== null
          ? changedArtboards(before, after)
          : before !== null
            ? { scope: 'file' as const, artboards: [] }
            : null;
      if (!reach) return json(200, NONE);
      // an artboard whose id is not an id can't be named in a claim: the change claims the canvas
      const target =
        reach.scope === 'file' || validIds(reach.artboards).length < reach.artboards.length
          ? ('*' as const)
          : reach.artboards;
      const self = runs.get(session, chat);
      // G-AI-6: a ⌘/ selection-scoped run changes only its selection
      const sc = self?.scope;
      if (sc) {
        const offCanvas = rel !== sc.canvas;
        const allowed = sc.artboards.length ? sc.artboards : null;
        const outside = offCanvas
          ? reach.artboards
          : allowed
            ? reach.artboards.filter((a) => !allowed.includes(a))
            : [];
        if (offCanvas || outside.length || (target === '*' && allowed))
          return json(200, {
            decision: 'deny',
            code: 'out-of-scope',
            artboards: validIds(outside),
            reason: reasonOf(
              `out-of-scope: this chat is about ${relText(sc.canvas)}${allowed ? ` › ${idsText(allowed)}` : ''} (the selection it started from) — ` +
                `${offCanvas ? `${relText(rel)} is outside it` : `this change reaches ${outside.length ? idsText(outside) : 'code every artboard shares'}`}. ` +
                'Change only what is in the selection, or ask the person to widen it.'
            ),
          });
      }
      // S2.19: a ⌘/ ask on a selection changes only those elements (and what is inside them)
      if (sc?.elements?.length && after !== null) {
        const outside = elementsOutsideScope(before, after, sc.elements);
        if (outside.length)
          return json(200, {
            decision: 'deny',
            code: 'out-of-scope',
            artboards: [],
            reason: reasonOf(
              `out-of-scope: this chat is about ${sc.elements.length === 1 ? 'one element' : `${sc.elements.length} elements`} of ${relText(sc.canvas)} (the selection it started from) — ` +
                `this change reaches ${idsText(outside.map((o) => o.element))}. ` +
                'Change only what is in the selection, or ask the person to widen it.'
            ),
          });
      }
      // A10 / V2-2.19: a locked element (data-cd-locked) is the person's — never the AI's
      if (before !== null && after !== null) {
        const locked = checkIds(after, { against: before, path: rel }).findings.filter(
          (f) => f.code === 'locked-changed'
        );
        if (locked.length) {
          const f = locked[0];
          const where = f.element.artboard ? ` in ${idText(f.element.artboard)}` : '';
          return json(200, {
            decision: 'deny',
            code: 'soft-locked',
            artboards: validIds([
              ...new Set(locked.map((x) => x.element.artboard).filter((a): a is string => !!a)),
            ]),
            // f.what is element-ids' own sentence; every file-derived fragment in it (the label,
            // a component tag name, a bad id, data-cd-* values) is cleaned and quoted there
            // (`nameOf` / `roleOf` / `idAttr`), and the whole reason is cleaned + capped here
            reason: reasonOf(
              `soft-locked: ${f.id !== undefined ? idText(f.id) : fileText(f.element.label)}${where} is locked — ${cleanText(f.what, 300)} ${cleanText(f.fix, 200)} Change the rest without touching it.`
            ),
          });
        }
      }
      // V2-1.15 §4 #13: an element a person is editing right now (awareness `holding`)
      if (before !== null) {
        let holds: PersonHold[] = [];
        try {
          holds = (deps.personHolds?.(rel) ?? []).filter((h) => h?.canvas === rel);
        } catch {
          holds = [];
        }
        const hit = heldReached(before, after, holds)[0];
        if (hit) {
          const who = nameText(String(hit.name ?? ''));
          return json(200, {
            decision: 'deny',
            code: 'soft-locked',
            artboards: [],
            reason: reasonOf(
              `soft-locked: ${who} is editing ${idText(hit.element)}. Leave it until ${who} moves on — change the rest without touching it.`
            ),
          });
        }
      }
      if (target !== '*' && target.length === 0) return json(200, NONE);
      const c = runs.conflict(session, rel, target, chat);
      if (c) {
        runs.noteBusy(session, rel, c.artboard, chat);
        return json(200, {
          decision: 'deny',
          code: 'artboard-busy',
          who: whoName(c.who),
          artboards: validIds([c.artboard]),
          reason: reasonOf(
            busyReason(c, rel, reach.scope === 'file' || target === '*', {
              holder: holderText(c, deps.memberName),
              inChat: !!sc && (!!chat || self?.actor === 'maude-chat'),
            })
          ),
        });
      }
      runs.claim(session, rel, target, chat);
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
      // S3.5 — a sidecar's Present ids are checked against its canvas's artboards.
      const srcRel = rel.endsWith('.meta.json') ? rel.replace(/\.meta\.json$/, '.tsx') : null;
      const src = srcRel ? readDesignFile(deps, srcRel) : null;
      const artboards = srcRel && src !== null ? artboardIdsOfSource(srcRel, src) : null;
      const opts = { against, tier: b.tier, strict: true, artboards } as const;
      // `introduced: true` (the hook's gates): errors = only what the write added against the
      // snapshot, `existing` = what the file already had (Michal 2026-10-29). A new file → all.
      const r =
        b.introduced === true
          ? checkIntroduced(rel, text, opts)
          : { ...checkFile(rel, text, opts), existing: [] };
      const shown = (list: readonly Finding[]) =>
        list.map((e) => ({ code: e.code, where: e.where, what: e.what, fix: e.fix }));
      const existing = r.existing.length ? { existing: shown(r.existing) } : {};
      if (r.ok) return json(200, { ok: true, ...existing });
      return json(200, { ok: false, errors: shown(r.errors), ...existing });
    }),
    spec({ path: '/_api/agent/edit/touched' }, (b) => {
      const session = key(b, 'session');
      const toolUseId = key(b, 'toolUseId');
      if (!session || !toolUseId) return bad('session and toolUseId are hook keys');
      const chat = chatOf(b);
      if (chat === undefined) return bad(BAD_CHAT);
      if (b.via !== 'tool' && b.via !== 'bash') return bad('via is tool | bash');
      const empty = { artboards: [] as string[], lostIds: [] as string[], trashed: [] as string[] };
      if (b.via === 'bash')
        return json(200, bindBashWrites(session, toolUseId, b.since, chat, b.claimedOnly === true));
      const rel = designPathRel(b.path);
      if (!rel) return bad('path is a file inside the design root');
      if (isRuntimeRel(rel)) return json(200, empty);
      const { artboards, lostIds, trashed, elements } = CANVAS_RE.test(rel)
        ? canvasChange(rel, `_runs/${session}/snap/${toolUseId}`, session)
        : { ...empty, elements: [] };
      runs.touch(session, rel, artboards, chat, elements);
      return json(200, { artboards, lostIds, trashed });
    }),
    // p8-a1-claims — a disk-writing verb (reel-place, canvas-edit, ds-check --fix, import-figma) claims
    // the bytes it is about to write for its chat's live run, BEFORE they land (bin/_write-claim.mjs).
    // A hook route: non-browser only (`hookBody`), main origin only, never in a canvas allowlist.
    spec({ path: '/_api/agent/write/claim' }, (b) => {
      const chat = key(b, 'chat');
      if (!chat) return bad(BAD_CHAT);
      if (!Array.isArray(b.writes) || !b.writes.length || b.writes.length > CLAIM_MAX_FILES)
        return bad(`writes is 1–${CLAIM_MAX_FILES} {path, content}`);
      const writes: Array<{ rel: string; content: string }> = [];
      let bytes = 0;
      for (const w of b.writes as Array<Record<string, unknown>>) {
        const rel = w && typeof w === 'object' ? designPathRel(w.path) : null;
        if (!rel || !CLAIM_LANE_RE.test(rel) || isRuntimeRel(rel))
          return bad(
            'path is a canvas, its .meta.json or its .annotations.json in the design root'
          );
        if (typeof w.content !== 'string') return bad('content is the text about to be written');
        bytes += w.content.length;
        if (bytes > CLAIM_MAX_BYTES) return bad('writes are too large to claim');
        writes.push({ rel, content: w.content });
      }
      const r = deps.claimWrites?.(chat, writes) ?? null;
      if (!r)
        return json(409, {
          error: 'no live AI run of this chat: the write is not claimed',
          code: 'no-live-run',
        });
      return json(200, { claimed: writes.length, run: r.runId });
    }),
    spec({ path: '/_api/agent/run/end' }, (b) => {
      const session = key(b, 'session');
      if (!session) return bad('session is a hook key');
      const chat = chatOf(b);
      if (chat === undefined) return bad(BAD_CHAT);
      if (!RUN_OUTCOMES.includes(b.outcome as RunOutcome))
        return bad(`outcome is ${RUN_OUTCOMES.join(' | ')}`);
      const r = runs.end(session, b.outcome as RunOutcome, chat);
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
        if (parsed.open.canvas && !insideDesignRoot(deps, parsed.open.canvas))
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
