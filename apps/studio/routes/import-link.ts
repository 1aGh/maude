// POST /_api/import-link — Assets › Add from a link… (p8-import-link; 12 · ia-edges F "A link instead of a file").
//
//   headers X-Maude-Link-Key  this server's page key (GET /_api/import-link/key) — proof the shell page sent it
//   body   { url: string }  — JSON, ≤ 4 KB. The link the person pasted; nothing else is read from the request.
//   201    { ok: true, path, kind, category, name, host }
//          path: assets/<sha8>.<ext> (what was stored) · kind: the stored extension (from the bytes) ·
//          name: the link's last segment, for the one line only — never a path
//   4xx/5xx { ok: false, reason, error } — `reason` is a word (ANSWER_OF below), `error` a FIXED phrase per word:
//          no text from the remote site — no status number, no header, no body — ever reaches either (F4).
//
// PRIVILEGED, MAIN ORIGIN ONLY (`origin: 'main'`): in neither CANVAS_SAFE_API nor the canvas server's routes map, so
// the untrusted canvas iframe — and planted canvas code inside a capture — can never make the studio fetch a URL.
// `guardTableRoute` (http.ts) gives it the cross-origin + DNS-rebinding write guard like every table write; the role
// gate is here: a project-level write into `assets/` — Can edit on the project, and a canvas-only session is refused
// (as `/_api/import-asset`). A read-only session never reaches the handler (`readOnly: 'refused'`).
//
// F2 — only the shell page may ask. `guardTableRoute` admits a request with no Origin and a loopback Host (a CLI), so
// without more an agent's always-allowed `maude design curl-local POST /_api/import-link` would be unprompted egress.
// So the POST needs this server's page key in `X-Maude-Link-Key` (timing-safe compare), and both routes refuse any
// request that carries `X-Maude-Chat` — the header curl-local and every studio verb stamp on an AI chat's requests
// (bin/_curl-local.mjs, bin/_studio-verb.mjs). The key is minted per server and handed out by `GET …/key`: main
// origin only, Can edit only, never to a request with X-Maude-Chat. Like Home's `x-maude-home` page secret, it is a
// page-held secret, not a person's credential; an agent that wants a file downloads it with its own tools, under
// Claude Code's own permission card, and brings it in with `maude design import-asset`.
//
// F3 — one answer for "not reachable": a private address, a site with no DNS answer and one that never connects all
// answer `link-unreachable` with the same status and phrase, so the route cannot be used to map internal names.
//
// Not in a cell: a cloud cell's network is the provider's, not the person's, and a link fetched there is a request
// from inside the provider's network. Until that is decided on its own, a cell answers `link-not-on-mac`.
// One import at a time per server (`busy`): a link holds a connection for up to two minutes, and (L4) the slot stays
// taken until every DNS lookup the import started has settled — a lookup has no signal and can outlive the deadline.

import { randomBytes, timingSafeEqual } from 'node:crypto';
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
  /** tests only — the studio passes none (a fresh random key; Bun DNS; Bun fetch pinned to the checked address) */
  pageKey?: string;
  lookup?: LinkLookup;
  transport?: LinkTransport;
  limits?: Partial<LinkLimits>;
  env?: Record<string, string | undefined>;
}

export const IMPORT_LINK_KEY_HEADER = 'x-maude-link-key';
const MAX_JSON = 4 * 1024;

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** What the route answers per refusal: one word, one status, one fixed phrase (F3, F4). */
const ANSWER_OF: Record<LinkReason, [reason: string, status: number, error: string]> = {
  'link-bad': ['link-bad', 400, 'not a link'],
  'link-not-https': ['link-not-https', 400, 'only https links'],
  'link-refused': ['link-refused', 400, 'a password or a port in the link'],
  // F3 — private, no address, no connection: the same answer
  'link-private': ['link-unreachable', 502, 'the link cannot be reached from here'],
  'link-unreachable': ['link-unreachable', 502, 'the link cannot be reached from here'],
  'link-http': ['link-http', 502, 'the site did not send the file'],
  'link-encoded': ['link-http', 502, 'the site did not send the file'],
  'link-redirects': ['link-redirects', 502, 'too many redirects'],
  'link-not-media': ['link-not-media', 415, 'not a picture, video or sound'],
  'link-svg': ['link-svg', 415, 'an SVG from a link'],
  'link-proxy': ['link-proxy', 409, 'this Mac sends web traffic through a proxy'],
  'too-large': ['too-large', 413, 'past the size cap'],
  timeout: ['timeout', 504, 'took too long'],
  'link-failed': ['link-failed', 500, 'Assets did not take it'],
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

const NOT_FROM_SHELL = () =>
  json(403, { ok: false, reason: 'not-from-shell', error: 'only the studio window adds links' });

function keyMatches(req: Request, key: Buffer): boolean {
  const got = Buffer.from(req.headers.get(IMPORT_LINK_KEY_HEADER) ?? '', 'utf8');
  return got.length === key.length && timingSafeEqual(got, key);
}

export function createImportLinkRoutes(deps: ImportLinkRouteDeps): RouteSpec[] {
  // only a real string counts: the table tests build every factory from proxies (routes/index.ts rule 1)
  const pageKey =
    typeof deps.pageKey === 'string' && deps.pageKey
      ? deps.pageKey
      : randomBytes(32).toString('base64url');
  const keyBytes = Buffer.from(pageKey, 'utf8');
  let running = false;
  /** Who may ask at all: an editor of the whole project, never an AI chat's request. */
  const refusal = (req: Request): Response | null => {
    const access = deps.access(req);
    if (access.canvasOnly || !access.can('edit', null))
      return json(403, { ok: false, reason: 'forbidden', error: 'You can view this project.' });
    if (req.headers.has('x-maude-chat')) return NOT_FROM_SHELL();
    return null;
  };
  return [
    {
      method: 'GET',
      path: '/_api/import-link/key',
      origin: 'main',
      readOnly: 'allowed',
      handle: (req) => refusal(req) ?? json(200, { key: pageKey }),
    },
    {
      method: 'POST',
      path: '/_api/import-link',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const refused = refusal(req);
        if (refused) return refused;
        if (!keyMatches(req, keyBytes)) return NOT_FROM_SHELL();
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
        const lookups: Promise<unknown>[] = [];
        let r: Awaited<ReturnType<typeof importFromLink>>;
        try {
          r = await importFromLink(url, {
            saveAsset: deps.saveAsset,
            track: (p) => lookups.push(p),
            ...(deps.lookup ? { lookup: deps.lookup } : {}),
            ...(deps.transport ? { transport: deps.transport } : {}),
            ...(deps.limits ? { limits: deps.limits } : {}),
            ...(deps.env ? { env: deps.env } : {}),
          });
        } finally {
          // L4 — the answer goes out now; the slot frees only once every lookup it started has settled
          void Promise.allSettled(lookups).then(() => {
            running = false;
          });
        }
        if (r.ok) return json(201, r);
        const [reason, status, error] = ANSWER_OF[r.reason] ?? [
          'link-failed',
          500,
          'Assets did not take it',
        ];
        return json(status, { ok: false, reason, error });
      },
    },
  ];
}
