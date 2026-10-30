// POST /_api/import-asset — Getting things in (S8.22; 12 · ia-more-ways, ia-edges). Moved here from http.ts with a
// v2 body and the dedupe answer; the v1 body (an SVG, no header or `X-Import-Kind: svg`) gets a superset of its v1
// answer `{ ok, path }`, so a v1 client keeps working.
//
//   headers  X-Import-Kind  svg | psd | heic | raster | auto — a HINT: it only picks the read cap. The bytes decide
//                            what runs (`sniffConvertibleKind` / `sniffRasterKind` / the SVG pre-parse), DDR-167 §4.
//            X-Import-Name  the file's name, URI-encoded, for the one line only — never a path: its last segment,
//                            control characters dropped, ≤ 200 characters.
//   body     the file's raw bytes (never multipart — DDR-167 Decision 4)
//   201      { ok: true, path, kind, reused, name?, converted?, removed? }
//            kind: svg | png | jpg (what was stored) · reused: the same bytes were already in Assets (the sha is the
//            name, so a second drop is the one already there) · converted: psd | heic · removed: an SVG's
//            { scripts, links, other } that were left out
//   4xx      { ok: false, error, reason } — reason is `ImportAssetError.reason` (bin/_import-asset.mjs), or
//            forbidden · too-large · empty · pdf-unavailable; the client's words are client/v2/assets/import-lines.js
//
// MAIN ORIGIN ONLY, never canvas-safe (DDR-167 §4: absent from both canvas allowlists). The table's write guard is the
// cross-origin + DNS-rebinding pair; the role gate is here: a project-level write into `assets/` — Can edit on the
// project, and a canvas-only session is refused (as `/_api/assets/trash`).

import type { Access } from '../access/scope.ts';
import {
  CONVERT_MAX_BYTES,
  CONVERT_OUT_MAX_BYTES,
  ImportAssetError,
  importConvertible,
  importRasterBytes,
  importSvg,
  SVG_MAX_BYTES,
  sniffConvertibleKind,
  sniffRasterKind,
} from '../bin/_import-asset.mjs';
import type { RouteSpec } from './table.ts';

type Imported = {
  path: string;
  ext: string;
  reused?: boolean;
  converted?: string;
  removed?: { scripts: number; links: number; other: number };
};
type ImportOpts = { root: string; designRootRel: string };

export interface AssetImportRouteDeps {
  root: string;
  designRel: string;
  /** The access this request is judged with (http.ts `accessOf`). */
  access: (req: Request) => Access;
  /** A file joined the project (the studio's change announcement; workspace mode only). */
  announce?: (rel: string) => void;
  /** Seams for the tests (the SVG canary drives a browser; `sips` is macOS only). The studio passes none. */
  importSvg?: (text: string, opts: ImportOpts) => Promise<Imported>;
  importConvertible?: (bytes: Buffer, opts: ImportOpts) => Promise<Imported>;
  importRaster?: (bytes: Buffer, opts: ImportOpts) => Imported;
}

/** The read cap per hint: never more than the largest kind accepts. */
export const IMPORT_READ_CAP: Record<string, number> = {
  svg: SVG_MAX_BYTES,
  psd: CONVERT_MAX_BYTES.psd,
  heic: CONVERT_MAX_BYTES.heic,
  raster: CONVERT_OUT_MAX_BYTES,
  auto: Math.max(
    SVG_MAX_BYTES,
    CONVERT_MAX_BYTES.psd,
    CONVERT_MAX_BYTES.heic,
    CONVERT_OUT_MAX_BYTES
  ),
};

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const STATUS_OF: Record<string, number> = {
  forbidden: 403,
  'too-large': 413,
  'too-many-pixels': 413,
  unsupported: 415,
  'not-on-mac': 415,
  busy: 429,
  'pdf-unavailable': 501,
};

/** A display name from the header: the last path segment, printable, ≤ 200 chars. Never used for a path. */
export function importDisplayName(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw;
  try {
    s = decodeURIComponent(raw);
  } catch {
    /* not encoded: keep it as it came */
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: dropping control characters is the point
  s = s.replace(/[\u0000-\u001f\u007f]/g, '');
  s = s.split(/[\\/]/).pop() ?? '';
  s = s.trim().slice(0, 200);
  return s && s !== '.' && s !== '..' ? s : null;
}

/** Read the body up to `cap` bytes; `null` past it (the stream is cancelled, nothing is buffered beyond). */
async function readCapped(req: Request, cap: number): Promise<Buffer | null> {
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.length) continue;
    total += value.length;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

function looksLikeSvg(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 1024).toString('utf8').trimStart();
  return /^(<\?xml|<svg|<!--|<!DOCTYPE)/i.test(head);
}

export function createAssetImportRoutes(deps: AssetImportRouteDeps): RouteSpec[] {
  const opts = (): ImportOpts => ({ root: deps.root, designRootRel: deps.designRel });
  const doSvg =
    deps.importSvg ?? (importSvg as unknown as NonNullable<AssetImportRouteDeps['importSvg']>);
  const doConvert =
    deps.importConvertible ??
    (importConvertible as unknown as NonNullable<AssetImportRouteDeps['importConvertible']>);
  const doRaster =
    deps.importRaster ??
    (importRasterBytes as unknown as NonNullable<AssetImportRouteDeps['importRaster']>);
  return [
    {
      method: 'POST',
      path: '/_api/import-asset',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const access = deps.access(req);
        if (access.canvasOnly || !access.can('edit', null))
          return json(403, { ok: false, reason: 'forbidden', error: 'You can view this project.' });
        const hint = (req.headers.get('x-import-kind') || 'svg').toLowerCase();
        if (hint === 'pdf') {
          return json(501, {
            ok: false,
            reason: 'pdf-unavailable',
            error: 'PDF import is not yet available (DDR-167 addendum) — only SVG import is wired.',
          });
        }
        const cap = IMPORT_READ_CAP[hint] ?? IMPORT_READ_CAP.auto;
        const declared = Number(req.headers.get('content-length') || '0');
        if (Number.isFinite(declared) && declared > cap)
          return json(413, {
            ok: false,
            reason: 'too-large',
            error: 'the file is past the size cap',
          });
        let bytes: Buffer | null;
        try {
          bytes = await readCapped(req, cap);
        } catch {
          return json(400, { ok: false, reason: 'unreadable', error: 'could not read body' });
        }
        if (bytes === null)
          return json(413, {
            ok: false,
            reason: 'too-large',
            error: 'the file is past the size cap',
          });
        if (bytes.length === 0)
          return json(400, { ok: false, reason: 'empty', error: 'empty body' });
        const name = importDisplayName(req.headers.get('x-import-name'));
        try {
          let r: Imported;
          if (sniffConvertibleKind(bytes)) r = await doConvert(bytes, opts());
          else if (sniffRasterKind(bytes)) r = doRaster(bytes, opts());
          else if (looksLikeSvg(bytes)) r = await doSvg(bytes.toString('utf8'), opts());
          else throw new ImportAssetError(5, 'not a picture Maude can bring in', 'unsupported');
          if (!r.reused) deps.announce?.(r.path);
          return json(201, {
            ok: true,
            path: r.path,
            kind: r.ext,
            reused: r.reused === true,
            ...(name ? { name } : {}),
            ...(r.converted ? { converted: r.converted } : {}),
            ...(r.removed ? { removed: r.removed } : {}),
          });
        } catch (err) {
          const own =
            err instanceof ImportAssetError
              ? (err as ImportAssetError & { reason?: string | null }).reason
              : null;
          const code = err instanceof ImportAssetError ? err.code : 1;
          // an error without its own word keeps the v1 status (3 → 400, 5 → 415, 6 → 500)
          const reason =
            own ?? (code === 3 ? 'refused' : code === 5 ? 'unsupported' : 'unreadable');
          const status = own
            ? (STATUS_OF[own] ?? 422)
            : code === 5
              ? 415
              : code === 6 || !(err instanceof ImportAssetError)
                ? 500
                : 400;
          return json(status, {
            ok: false,
            reason,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  ];
}
