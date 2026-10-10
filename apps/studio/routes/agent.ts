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

import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

import type { RouteSpec } from './table.ts';

export interface AgentRouteDeps {
  repoRoot: string;
  /** `.design` (or the configured designRoot, relative to repoRoot) */
  designRel: string;
  /** how many shells (inspector sockets) of this project are attached right now */
  shells: () => number;
  /** ctx.bus.emit — `ui-open` is relayed to the shells by ws.ts */
  emit: (event: string, payload: unknown) => void;
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

export function agentRouteSpecs(deps: AgentRouteDeps): RouteSpec[] {
  return [
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
