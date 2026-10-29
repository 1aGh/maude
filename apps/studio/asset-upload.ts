/**
 * @file       asset-upload.ts — the one client for `POST /_api/asset*`
 * @scope      apps/studio/asset-upload.ts
 * @purpose    Uploads a media file the way every surface should: in one request
 *             when it is small, or as a chunked session (issue #126) when it is
 *             a video/audio clip past {@link CHUNK_THRESHOLD}. Shared by the
 *             canvas drop/paste hook (inside the canvas iframe) and the shell's
 *             AssetPicker, including the desktop native "Open file" picker — so
 *             no surface is left capped at the one-shot limit.
 *
 *             DOM- and React-free. The server decides type, caps and budget;
 *             nothing here is trusted by it.
 */

/**
 * S8.22 — an import answer adds facts for the one line (`client/v2/assets/import-lines.js`): `reused` (the same bytes
 * were already in Assets), `converted` (psd | heic), `removed` (what a logo left out); a refusal adds its `reason`.
 */
export type UploadResult =
  | {
      path: string;
      reused?: boolean;
      converted?: 'psd' | 'heic';
      removed?: { scripts: number; links: number; other: number };
    }
  | { error: string; reason?: string };

/**
 * Bytes to upload. A `Blob`/`File` slices lazily, so a 500 MB drop is never
 * read whole; a {@link ChunkSource} serves sources that live outside the page
 * (the desktop picker reads them through IPC, one slice at a time).
 */
export interface ChunkSource {
  readonly size: number;
  readonly type: string;
  read(start: number, end: number): Promise<Uint8Array>;
}

export type UploadInput = Blob | ChunkSource;

export interface UploadOptions {
  /** 0..1 as chunks land. Called only on the chunked path. */
  onProgress?: (fraction: number) => void;
  fetchImpl?: typeof fetch;
  /** The file's name when the input is not a `File` (the desktop picker's ChunkSource). Shown in the line only. */
  name?: string;
}

/**
 * S8.22 — the kinds that go through `POST /_api/import-asset` (main origin) instead of `/_api/asset`: a Photoshop file
 * or a HEIC (converted by the server's sandboxed `sips`), or an SVG logo (sanitized). A guess from the name and type:
 * the server sniffs the bytes and decides; a wrong guess is refused cleanly, never reinterpreted.
 */
export function importKindOf(name: string, type: string): 'psd' | 'heic' | 'svg' | null {
  const n = name.toLowerCase();
  const t = type.toLowerCase();
  if (
    /\.(psd|psb)$/.test(n) ||
    t === 'image/vnd.adobe.photoshop' ||
    t === 'application/x-photoshop'
  )
    return 'psd';
  if (/\.(heic|heif)$/.test(n) || t === 'image/heic' || t === 'image/heif') return 'heic';
  if (/\.svg$/.test(n) || t === 'image/svg+xml') return 'svg';
  return null;
}

function nameOf(input: UploadInput, opts: UploadOptions): string {
  if (opts.name) return opts.name;
  const n = (input as { name?: unknown }).name;
  return typeof n === 'string' ? n : '';
}

/** One import through the converters' route: raw bytes, the kind as a hint, the name for the line. */
export async function importAsset(
  input: UploadInput,
  kind: 'psd' | 'heic' | 'svg' | 'auto',
  opts: UploadOptions = {}
): Promise<UploadResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const name = nameOf(input, opts);
    const res = await doFetch('/_api/import-asset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Import-Kind': kind,
        ...(name ? { 'X-Import-Name': encodeURIComponent(name) } : {}),
      },
      body: await bodyOf(input, 0, input.size),
    });
    let j: Record<string, unknown> = {};
    try {
      j = (await res.json()) as Record<string, unknown>;
    } catch {
      /* non-JSON answer */
    }
    if (!res.ok || j.ok !== true || typeof j.path !== 'string') {
      return {
        error: typeof j.error === 'string' ? j.error : `upload failed (${res.status})`,
        ...(typeof j.reason === 'string' ? { reason: j.reason } : {}),
      };
    }
    return {
      path: j.path,
      reused: j.reused === true,
      ...(j.converted === 'psd' || j.converted === 'heic' ? { converted: j.converted } : {}),
      ...(j.removed && typeof j.removed === 'object'
        ? { removed: j.removed as { scripts: number; links: number; other: number } }
        : {}),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'network error' };
  }
}

/** F2 — this server's page key for the link import (`GET /_api/import-link/key`), asked once per page. */
let linkKey: Promise<string | null> | null = null;
function linkKeyOf(doFetch: typeof fetch, fresh = false): Promise<string | null> {
  if (!linkKey || fresh)
    linkKey = doFetch('/_api/import-link/key', { headers: { Accept: 'application/json' } })
      .then(async (r) => {
        const j = r.ok ? ((await r.json()) as { key?: unknown }) : {};
        return typeof j.key === 'string' ? j.key : null;
      })
      .catch(() => null);
  return linkKey;
}

/**
 * p8-import-link (12 · ia-edges F) — Assets › Add from a link…: the SERVER fetches the https link (public addresses only,
 * capped, the type from the bytes — link-import.ts) and lands it in Assets; the page only names the link. `name` and
 * `host` are for the one line, never a path. The page key (F2) rides in `X-Maude-Link-Key`.
 */
export async function importFromLink(
  url: string,
  opts: { fetchImpl?: typeof fetch } = {}
): Promise<UploadResult & { name?: string; host?: string }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const post = async (key: string | null) =>
    doFetch('/_api/import-link', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { 'X-Maude-Link-Key': key } : {}),
      },
      body: JSON.stringify({ url }),
    });
  try {
    let res = await post(await linkKeyOf(doFetch));
    // a restarted server mints its own key: ask for it once more
    if (res.status === 403) {
      const again = await linkKeyOf(doFetch, true);
      if (again) res = await post(again);
    }
    let j: Record<string, unknown> = {};
    try {
      j = (await res.json()) as Record<string, unknown>;
    } catch {
      /* non-JSON answer */
    }
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    if (!res.ok || j.ok !== true || typeof j.path !== 'string') {
      const reason = str(j.reason);
      return {
        error: str(j.error) ?? `link import failed (${res.status})`,
        ...(reason ? { reason } : {}),
      };
    }
    const name = str(j.name);
    const host = str(j.host);
    return { path: j.path, ...(name ? { name } : {}), ...(host ? { host } : {}) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'network error' };
  }
}

/**
 * Above this, video/audio goes through chunk sessions. A client constant on
 * purpose — the server's one-shot cap is env-configurable and unknown here; the
 * chunk SIZE comes from the server's chunk-start answer.
 */
export const CHUNK_THRESHOLD = 32 * 1024 * 1024;

const CHUNK_RETRIES = 3;

function isBlob(input: UploadInput): input is Blob {
  return typeof Blob !== 'undefined' && input instanceof Blob;
}

/**
 * Whether an upload takes the chunked path. Images never do (the server refuses
 * them there); an UNTYPED large source is assumed to be media — the server
 * sniffs the bytes either way.
 */
export function shouldChunk(size: number, type: string): boolean {
  return size > CHUNK_THRESHOLD && !type.startsWith('image/');
}

/** `[start, end)` byte ranges for `size` bytes in `chunkBytes` pieces. */
export function chunkRanges(size: number, chunkBytes: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let start = 0; start < size; start += chunkBytes) {
    out.push([start, Math.min(size, start + chunkBytes)]);
  }
  return out;
}

async function errorOf(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    if (j?.error) return j.error;
  } catch {
    /* non-JSON error body */
  }
  return `upload failed (${res.status})`;
}

async function bodyOf(input: UploadInput, start: number, end: number): Promise<BodyInit> {
  if (isBlob(input)) return input.slice(start, end);
  return (await input.read(start, end)) as Uint8Array<ArrayBuffer>;
}

async function uploadOneShot(input: UploadInput, doFetch: typeof fetch): Promise<UploadResult> {
  const res = await doFetch('/_api/asset', {
    method: 'POST',
    headers: { 'Content-Type': input.type || 'application/octet-stream' },
    body: await bodyOf(input, 0, input.size),
  });
  if (!res.ok) return { error: await errorOf(res) };
  const j = (await res.json()) as { path?: unknown };
  return typeof j?.path === 'string' ? { path: j.path } : { error: 'malformed upload response' };
}

/** 4xx other than 409/429 won't change on a retry. */
function retryable(status: number): boolean {
  return status >= 500 || status === 409 || status === 429;
}

async function uploadChunked(
  input: UploadInput,
  doFetch: typeof fetch,
  onProgress?: (fraction: number) => void
): Promise<UploadResult> {
  const startRes = await doFetch('/_api/asset/chunk-start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ totalSize: input.size }),
  });
  if (!startRes.ok) return { error: await errorOf(startRes) };
  const { session, chunkBytes } = (await startRes.json()) as {
    session?: unknown;
    chunkBytes?: unknown;
  };
  if (typeof session !== 'string' || typeof chunkBytes !== 'number' || chunkBytes <= 0) {
    return { error: 'malformed upload response' };
  }
  const q = `session=${encodeURIComponent(session)}`;
  const abort = () =>
    doFetch(`/_api/asset/chunk?${q}`, { method: 'DELETE' }).catch(() => undefined);

  const ranges = chunkRanges(input.size, chunkBytes);
  for (let i = 0; i < ranges.length; i++) {
    const [start, end] = ranges[i];
    let lastError = 'upload failed';
    let sent = false;
    for (let attempt = 0; attempt < CHUNK_RETRIES && !sent; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * attempt));
      try {
        const res = await doFetch(`/_api/asset/chunk?${q}&index=${i}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: await bodyOf(input, start, end),
        });
        if (res.ok) {
          sent = true;
        } else {
          lastError = await errorOf(res);
          if (!retryable(res.status)) break;
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : 'network error';
      }
    }
    if (!sent) {
      await abort();
      return { error: lastError };
    }
    onProgress?.((i + 1) / ranges.length);
  }

  const res = await doFetch(`/_api/asset/chunk-finish?${q}`, { method: 'POST' });
  if (!res.ok) return { error: await errorOf(res) };
  const j = (await res.json()) as { path?: unknown };
  return typeof j?.path === 'string' ? { path: j.path } : { error: 'malformed upload response' };
}

// Chunked uploads run one at a time: the server caps open sessions, so a
// six-file native pick fired concurrently would 429 on the fifth. One-shot
// uploads stay concurrent.
let chunkQueue: Promise<unknown> = Promise.resolve();

export async function uploadAsset(
  input: UploadInput,
  opts: UploadOptions = {}
): Promise<UploadResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const viaImport = importKindOf(nameOf(input, opts), input.type);
  if (viaImport) return importAsset(input, viaImport, opts);
  try {
    if (!shouldChunk(input.size, input.type)) return await uploadOneShot(input, doFetch);
    const run = chunkQueue.then(() => uploadChunked(input, doFetch, opts.onProgress));
    chunkQueue = run.catch(() => undefined);
    return await run;
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'network error' };
  }
}
