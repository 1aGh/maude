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

export type UploadResult = { path: string } | { error: string };

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
  try {
    if (!shouldChunk(input.size, input.type)) return await uploadOneShot(input, doFetch);
    const run = chunkQueue.then(() => uploadChunked(input, doFetch, opts.onProgress));
    chunkQueue = run.catch(() => undefined);
    return await run;
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'network error' };
  }
}
