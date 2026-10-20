// The Import from Figma sheet's two server halves (S8.17; canvas 12 · ia-figma-sheets, ia-figma-arrived).
//
//   POST /_api/figma/frames         { url }                                → 200 { ok, surface, fileName, page, frames[], more }
//   POST /_api/figma/import-frames  { url, frames[], folder?, name?, comments?, styles? }
//                                                                          → 200 { ok, canvas, artboards, frames[], comments, tokens, assets, dispositions }
//   400 { ok:false, reason: bad-request | bad-url | not-connected | …}   403 { ok:false, reason:'forbidden' }
//   A FigJam link lists as { surface: 'board', frames: [] } — it lands through POST /_api/annotations/figjam (S4.16)
//   502 { ok:false, reason: <FigmaApiError kind> }                       Figma did not answer
//
// DDR-216 posture, unchanged:
//   - MAIN ORIGIN ONLY, in neither canvas allowlist: both spend the person's Figma token and reach the network,
//     and the second writes a canvas (DDR-054/088). `guardTableRoute` gives both the same-origin + loopback-Host
//     gates the legacy `/_api/figma/*` routes carry by hand (D3).
//   - Can edit on the PROJECT (a new canvas in a folder is a project-level write; a canvas-only session has no say
//     over where new canvases go): refused per request, and `readOnly: 'refused'` keeps a viewer out at the table.
//   - The caller never picks a PATH: a folder (checked segment by segment) and a canvas name (a filename charset).
//   - Every answer is counts, node ids, sizes and code-owned reason codes; frame labels pass `attrValue` (D6/D7/D10).
//     An upstream message never becomes a response string: errors map to fixed reasons here.
//   - Deterministic code end to end: no model reads the file (D1). Tests stub the verb (`list` / `importPictures`);
//     the real ones are `bin/_import-figma.mjs`, imported lazily so a boot never loads the import machinery.

import type { Access } from '../access/scope.ts';
import type { RouteSpec } from './table.ts';

const MAX_BODY = 16 * 1024;
const MAX_FRAMES = 60;
const FRAME_ID_RE = /^-?[0-9]{1,10}:[0-9]{1,10}(?:;[0-9:;-]{1,64})?$/;

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface FramesRequest {
  url: string;
}
export interface PicturesRequest {
  url: string;
  frames: string[];
  folder: string;
  name: string | null;
  comments: boolean;
  styles: boolean;
}

/** `{ url }` — a Figma link of at most 2 kB. The verb's URL parser is the host gate. */
export function parseFramesRequest(body: unknown): FramesRequest | null {
  if (!body || typeof body !== 'object') return null;
  const url = (body as Record<string, unknown>).url;
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return null;
  return { url: url.trim() };
}

/** The import body, narrowed: 1–60 frame ids, a folder and a name as strings (the verb checks their charset). */
export function parsePicturesRequest(body: unknown): PicturesRequest | null {
  const base = parseFramesRequest(body);
  if (!base) return null;
  const b = body as Record<string, unknown>;
  const frames = b.frames;
  if (
    !Array.isArray(frames) ||
    frames.length < 1 ||
    frames.length > MAX_FRAMES ||
    !frames.every((f) => typeof f === 'string' && FRAME_ID_RE.test(f))
  )
    return null;
  if (b.folder !== undefined && (typeof b.folder !== 'string' || b.folder.length > 256))
    return null;
  if (b.name !== undefined && b.name !== null && (typeof b.name !== 'string' || b.name.length > 80))
    return null;
  return {
    url: base.url,
    frames: [...new Set(frames as string[])],
    folder: typeof b.folder === 'string' ? b.folder : '',
    name: typeof b.name === 'string' ? b.name : null,
    comments: b.comments !== false,
    styles: b.styles === true,
  };
}

interface VerbArgs {
  root: string;
  designRootRel: string;
}
type ListFn = (req: FramesRequest) => Promise<Record<string, unknown>>;
type PicturesFn = (req: PicturesRequest & VerbArgs) => Promise<Record<string, unknown>>;

export interface FigmaRouteDeps {
  /** the repo root and the design root relative to it — where the verb writes */
  root: string;
  designRel: string;
  /** The access this request is judged with (http.ts `accessOf`). */
  access: (req: Request) => Access;
  /** test seams; default = the verb (`bin/_import-figma.mjs`) */
  list?: ListFn;
  importPictures?: PicturesFn;
  /** A canvas landed (the studio's change announcement), so the Canvases list shows it at once. */
  announce?: (canvasRel: string) => void;
}

const verb = () => import('../bin/_import-figma.mjs');

/**
 * An error → a fixed reason. `FigmaApiError.kind` is the client's own enum; the verb's usage/validation
 * errors are its exit codes (2 usage, 3 validation); everything else is `failed` — never a message.
 */
export function figmaFailure(err: unknown): Response {
  const e = err as { name?: string; kind?: unknown; code?: unknown } | null;
  if (e && typeof e.kind === 'string' && /^[a-z_]{1,32}$/.test(e.kind)) {
    if (e.kind === 'not_configured') return json(400, { ok: false, reason: 'not-connected' });
    return json(502, { ok: false, reason: e.kind });
  }
  if (e?.name === 'FigmaUrlError') return json(400, { ok: false, reason: 'bad-url' });
  if (e && (e.code === 2 || e.code === 3))
    return json(e.code === 2 ? 400 : 422, {
      ok: false,
      reason: e.code === 2 ? 'bad-request' : 'not-on-page',
    });
  return json(500, { ok: false, reason: 'failed' });
}

async function readBody(req: Request): Promise<unknown | Response> {
  if (Number(req.headers.get('content-length')) > MAX_BODY)
    return json(413, { ok: false, reason: 'too-large' });
  const text = await req.text();
  if (text.length > MAX_BODY) return json(413, { ok: false, reason: 'too-large' });
  try {
    return JSON.parse(text);
  } catch {
    return json(400, { ok: false, reason: 'bad-json' });
  }
}

export function createFigmaRoutes(deps: FigmaRouteDeps): RouteSpec[] {
  const list: ListFn = deps.list ?? (async (r) => (await verb()).listFigmaFrames(r));
  const pictures: PicturesFn =
    deps.importPictures ?? (async (r) => (await verb()).importFramePictures(r));
  const refused = (req: Request): Response | null => {
    const access = deps.access(req);
    return access.canvasOnly || !access.can('edit', null)
      ? json(403, { ok: false, reason: 'forbidden' })
      : null;
  };

  return [
    {
      method: 'POST',
      path: '/_api/figma/frames',
      origin: 'main',
      // It writes nothing, but it spends the token and reaches the network: a viewer has no import to make.
      readOnly: 'refused',
      handle: async (req) => {
        const no = refused(req);
        if (no) return no;
        const body = await readBody(req);
        if (body instanceof Response) return body;
        const parsed = parseFramesRequest(body);
        if (!parsed) return json(400, { ok: false, reason: 'bad-request' });
        try {
          return json(200, { ok: true, ...(await list(parsed)) });
        } catch (err) {
          return figmaFailure(err);
        }
      },
    },
    {
      method: 'POST',
      path: '/_api/figma/import-frames',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const no = refused(req);
        if (no) return no;
        const body = await readBody(req);
        if (body instanceof Response) return body;
        const parsed = parsePicturesRequest(body);
        if (!parsed) return json(400, { ok: false, reason: 'bad-request' });
        try {
          const r = await pictures({ ...parsed, root: deps.root, designRootRel: deps.designRel });
          if (typeof r.canvas === 'string') deps.announce?.(r.canvas);
          return json(200, { ok: true, ...r });
        } catch (err) {
          return figmaFailure(err);
        }
      },
    },
  ];
}
