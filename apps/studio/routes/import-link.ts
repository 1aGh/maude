// POST /_api/import-link — Assets › Add from a link… (p8-import-link; 12 · ia-edges F "A link instead of a file").
//
//   body   { url: string }  — JSON, ≤ 4 KB. The link the person pasted; nothing else is read from the request.
//   201    { ok: true, path, kind, category, name, host }
//          path: assets/<sha8>.<ext> (what was stored) · kind: the stored extension (from the bytes) ·
//          name: the link's last segment, for the one line only — never a path
//   4xx/5xx { ok: false, reason, error } — reason is a `LinkReason` (link-import.ts), or forbidden · busy ·
//          link-not-on-mac; the client's words are client/v2/assets/import-lines.js. `error` is a fixed phrase:
//          no text from the remote site ever reaches it.
//
// PRIVILEGED, MAIN ORIGIN ONLY (`origin: 'main'`): in neither CANVAS_SAFE_API nor the canvas server's routes map, so
// the untrusted canvas iframe — and planted canvas code inside a capture — can never make the studio fetch a URL.
// `guardTableRoute` (http.ts) gives it the cross-origin + DNS-rebinding write guard like every table write; the role
// gate is here: a project-level write into `assets/` — Can edit on the project, and a canvas-only session is refused
// (as `/_api/import-asset`). A read-only session never reaches the handler (`readOnly: 'refused'`).
//
// Not in a cell: a cloud cell's network is the provider's, not the person's, and a link fetched there is a request
// from inside the provider's network. Until that is decided on its own, a cell answers `link-not-on-mac`.
// One import at a time per server (`busy`): a link holds a connection for up to two minutes.

import type { Access } from '../access/scope.ts';
import type { SaveAssetResult } from '../api.ts';
import {
  importFromLink,
  type LinkLimits,
  type LinkLookup,
  type LinkReason,
  type LinkTransport,
} from '../link-import.ts';
import type { RouteSpec } from './table.ts';

export interface ImportLinkRouteDeps {
  /** The access this request is judged with (http.ts `accessOf`). */
  access: (req: Request) => Access;
  /** `api.saveAssetFromStream` — the Assets writer (sniff, per-kind cap, budget, content address). */
  saveAsset: (stream: ReadableStream<Uint8Array>) => Promise<SaveAssetResult>;
  /** A cloud cell: refused (see the header). */
  inCell?: boolean;
  /** tests only — the studio passes none (Bun DNS, Bun fetch pinned to the checked address) */
  lookup?: LinkLookup;
  transport?: LinkTransport;
  limits?: Partial<LinkLimits>;
}

export const IMPORT_LINK_PATH = '/_api/import-link';
const MAX_JSON = 4 * 1024;

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const STATUS_OF: Record<LinkReason, number> = {
  'link-bad': 400,
  'link-not-https': 400,
  'link-refused': 400,
  'link-private': 403,
  'link-unreachable': 502,
  'link-http': 502,
  'link-redirects': 502,
  'link-not-media': 415,
  'link-svg': 415,
  'too-large': 413,
  timeout: 504,
  'link-failed': 500,
};

async function readUrl(req: Request): Promise<string | null> {
  if (Number(req.headers.get('content-length')) > MAX_JSON) return null;
  let text: string;
  try {
    text = await req.text();
  } catch {
    return null;
  }
  if (text.length > MAX_JSON) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && typeof v.url === 'string' ? v.url : null;
  } catch {
    return null;
  }
}

export function createImportLinkRoutes(deps: ImportLinkRouteDeps): RouteSpec[] {
  let running = false;
  return [
    {
      method: 'POST',
      path: IMPORT_LINK_PATH,
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const access = deps.access(req);
        if (access.canvasOnly || !access.can('edit', null))
          return json(403, { ok: false, reason: 'forbidden', error: 'You can view this project.' });
        if (deps.inCell)
          return json(409, {
            ok: false,
            reason: 'link-not-on-mac',
            error: 'links come in on a Mac',
          });
        const url = await readUrl(req);
        if (url === null) return json(400, { ok: false, reason: 'link-bad', error: 'not a link' });
        if (running)
          return json(429, { ok: false, reason: 'busy', error: 'another link is coming in' });
        running = true;
        try {
          const r = await importFromLink(url, {
            saveAsset: deps.saveAsset,
            ...(deps.lookup ? { lookup: deps.lookup } : {}),
            ...(deps.transport ? { transport: deps.transport } : {}),
            ...(deps.limits ? { limits: deps.limits } : {}),
          });
          if (r.ok) return json(201, r);
          return json(STATUS_OF[r.reason] ?? 500, { ok: false, reason: r.reason, error: r.error });
        } finally {
          running = false;
        }
      },
    },
  ];
}
