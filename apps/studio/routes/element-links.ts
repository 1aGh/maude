// routes/element-links.ts — `GET /_api/links?file=` (S3.10a; named apart from S1.18's routes/links.ts at A6a; contract client/v2/contracts/S3-links-format.md §4).
//
// The trusted shell's one source for where an on-click link goes. The canvas never hands the shell a
// target (DDR-054: the canvas origin is untrusted): in Preview it posts `link-follow {elementId,
// artboardId}`, and the shell reads the target HERE, parsed server-side from the versioned TSX.
//
// MAIN ORIGIN ONLY — in neither canvas allowlist (`origin: 'main'`). A read: `readOnly: 'allowed'`, any role
// (a Can view session opens a canvas in Preview and must follow its links).
//
// No existence oracle (V2-1.16 U1): a target canvas this session cannot read reports `dangling` with the
// fallback label — byte-equal to a canvas that is not there; a `file` it cannot read answers the same 404 as
// a missing one. `sees` is the session predicate (access/scope.ts `sees`); the local studio has one project
// role and passes none (everything readable).

import { readFileSync } from 'node:fs';

import { canvasWords, type LinkTarget, linkLabel } from '../bridge/link-target.ts';
import { readLinks } from '../canvas-edit.ts';
import { artboardsOfSource, type CanvasArtboard, canvasFileIn } from '../check/link-resolver.ts';
import type { RouteSpec } from './table.ts';

export interface ElementLinksRouteDeps {
  designRoot: string;
  /** `.design` — a `file` may carry it as a prefix */
  designRel: string;
  /** may this request's session read `rel` (designRoot-relative)? absent = yes (one local project role) */
  sees?(req: Request, rel: string): boolean;
}

export interface LinkEntry {
  id: string;
  artboard: string | null;
  target: string;
  kind: 'artboard' | 'canvas' | 'external' | 'invalid';
  canvas?: string;
  toArtboard?: string | null;
  url?: string;
  host?: string;
  state: 'ok' | 'dangling' | 'invalid';
  label: string;
}

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const NOT_FOUND = { error: 'not-found' } as const;

/** designRoot-relative `.tsx` from a `file` param, or null when the grammar is wrong (→ 400). */
export function linksFileRel(designRel: string, file: string | null): string | null {
  if (!file || file.length > 1024) return null;
  let p = file;
  const dr = designRel.replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
  if (dr && p.startsWith(`${dr}/`)) p = p.slice(dr.length + 1);
  if (!p.endsWith('.tsx') || p.startsWith('/') || p.includes('\\') || p.includes('\0')) return null;
  if (p.split('/').some((s) => s === '' || s === '.' || s === '..')) return null;
  return p;
}

const labelOf = (a: CanvasArtboard | undefined) => a?.label || undefined;

/** The entries of one canvas's links — pure over the source + a resolver for other canvases. */
export function linkEntries(
  source: string,
  file: string,
  otherCanvas: (rel: string) => CanvasArtboard[] | null
): LinkEntry[] {
  const own = artboardsOfSource(source, file) ?? [];
  const out: LinkEntry[] = [];
  for (const row of readLinks(source, file)) {
    if (!row.id) continue; // `link-no-id`: nothing can address it, nothing follows it
    const base = { id: row.id, artboard: row.artboardId, target: row.raw };
    const t: LinkTarget | null = row.target;
    if (!t) {
      out.push({ ...base, kind: 'invalid', state: 'invalid', label: '' });
    } else if (t.kind === 'artboard') {
      const hit = own.find((a) => a.id === t.artboard);
      out.push({
        ...base,
        kind: 'artboard',
        toArtboard: t.artboard,
        state: hit ? 'ok' : 'dangling',
        label: linkLabel(t, { artboard: labelOf(hit) }),
      });
    } else if (t.kind === 'canvas') {
      const abs = t.canvas === file ? own : otherCanvas(t.canvas);
      const hit = abs && t.artboard !== null ? abs.find((a) => a.id === t.artboard) : undefined;
      const ok = abs !== null && (t.artboard === null ? abs.length > 0 : hit !== undefined);
      out.push({
        ...base,
        kind: 'canvas',
        canvas: t.canvas,
        // no artboard named → the first in source order (the shell's fallback for Present order, D5)
        toArtboard: ok ? (t.artboard ?? (abs as CanvasArtboard[])[0]?.id ?? null) : t.artboard,
        state: ok ? 'ok' : 'dangling',
        label: linkLabel(t, { canvas: canvasWords(t.canvas) }),
      });
    } else {
      out.push({
        ...base,
        kind: 'external',
        url: t.url,
        host: t.host,
        state: 'ok',
        label: linkLabel(t),
      });
    }
  }
  return out;
}

export function createElementLinksRoutes(deps: ElementLinksRouteDeps): RouteSpec[] {
  return [
    {
      method: 'GET',
      path: '/_api/links',
      origin: 'main',
      readOnly: 'allowed',
      handle: (req) => {
        const rel = linksFileRel(deps.designRel, new URL(req.url).searchParams.get('file'));
        if (!rel) return json(400, { error: 'bad-file' });
        const sees = (r: string) => (deps.sees ? deps.sees(req, r) : true);
        const abs = sees(rel) ? canvasFileIn(deps.designRoot, rel) : null;
        if (!abs) return json(404, NOT_FOUND);
        let source: string;
        try {
          source = readFileSync(abs, 'utf8');
        } catch {
          return json(404, NOT_FOUND);
        }
        const cache = new Map<string, CanvasArtboard[] | null>();
        const other = (r: string): CanvasArtboard[] | null => {
          if (cache.has(r)) return cache.get(r) ?? null;
          let out: CanvasArtboard[] | null = null;
          const f = sees(r) ? canvasFileIn(deps.designRoot, r) : null;
          if (f) {
            try {
              out = artboardsOfSource(readFileSync(f, 'utf8'), r) ?? [];
            } catch {
              out = null;
            }
          }
          cache.set(r, out);
          return out;
        };
        let links: LinkEntry[];
        try {
          links = linkEntries(source, rel, other);
        } catch {
          links = []; // a file that does not parse has no followable links
        }
        return json(200, { v: 1, file: rel, links });
      },
    },
  ];
}
