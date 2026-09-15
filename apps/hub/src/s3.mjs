// Minimal S3-compatible client — Cloud Phase 2 Task 3.
//
// Dependency-free on purpose. The hub image installs with
// `bun install --frozen-lockfile` and is the ONE component DDR-193 designates
// "untrusted to peers", so every transitive dependency added here lands on
// every self-hoster's box. `@aws-sdk/client-s3` is ~20 MB and several hundred
// packages to do four HTTP verbs; SigV4 is a documented hash chain and node
// already ships the crypto.
//
// Covers exactly what backup.mjs and the restore drill need: PUT, GET, LIST,
// DELETE, against R2 / MinIO / S3. Path-style addressing (`<endpoint>/<bucket>/<key>`),
// because R2 and MinIO both speak it and it avoids per-bucket DNS.
//
// NOT a general-purpose SDK. Multipart exists for one caller — the file
// mirror's large media (`putObjectFromFile`, plan T18); no retries beyond that. Backups are single-shot gzipped SQLite snapshots, well under the
// 5 GB single-PUT limit. If a future caller needs multipart, that is the moment
// to reconsider the dependency, not now.

import { createHash, createHmac } from 'node:crypto';
import {
  closeSync,
  createWriteStream,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
} from 'node:fs';

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/** ISO8601 basic format: 20260728T203000Z + the 20260728 date stamp. */
function stamps(date) {
  const iso = date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

/**
 * Percent-encode one URI path segment per AWS's rules (which are NOT
 * encodeURIComponent's — `!'()*` must be escaped, `/` must not be, inside a
 * segment). Getting this wrong produces a signature mismatch that looks like a
 * credentials problem, so it is spelled out rather than approximated.
 */
function encodeSegment(segment) {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function encodeKey(key) {
  return String(key).split('/').map(encodeSegment).join('/');
}

/**
 * @typedef {object} S3Config
 * @property {string} endpoint    e.g. https://<account>.r2.cloudflarestorage.com
 * @property {string} bucket
 * @property {string} accessKeyId
 * @property {string} secretAccessKey
 * @property {string} [region]    default 'auto' (what R2 wants)
 * @property {string} [sessionToken]
 */

/**
 * Read an S3 target from environment. Returns null when not configured, so a
 * hub with no backup destination simply doesn't back up rather than failing to
 * boot.
 */
export function s3ConfigFromEnv(env = process.env) {
  const endpoint = env.MAUDE_S3_ENDPOINT;
  const bucket = env.MAUDE_S3_BUCKET;
  const accessKeyId = env.MAUDE_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.MAUDE_S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    bucket,
    accessKeyId,
    secretAccessKey,
    region: env.MAUDE_S3_REGION || 'auto',
    ...(env.MAUDE_S3_SESSION_TOKEN ? { sessionToken: env.MAUDE_S3_SESSION_TOKEN } : {}),
  };
}

/**
 * Build the signed headers for one request (AWS Signature Version 4).
 * Exported so a test can assert the canonical request without a network call.
 */
export function signRequest(
  cfg,
  { method, key, query = {}, body = null, now = new Date(), condition }
) {
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}${key ? `/${encodeKey(key)}` : ''}`);
  const sortedQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeSegment(k)}=${encodeSegment(String(query[k]))}`)
    .join('&');
  if (sortedQuery) url.search = sortedQuery;

  const { amzDate, dateStamp } = stamps(now);
  const payloadHash = body === null ? sha256Hex('') : sha256Hex(body);

  const headers = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(cfg.sessionToken ? { 'x-amz-security-token': cfg.sessionToken } : {}),
    ...(condition === undefined ? {} : conditionalHeaders(method, condition)),
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');

  const canonicalRequest = [
    method,
    url.pathname,
    sortedQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${cfg.region ?? 'auto'}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  let signingKey = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
  signingKey = hmac(signingKey, cfg.region ?? 'auto');
  signingKey = hmac(signingKey, 's3');
  signingKey = hmac(signingKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url: url.toString(), headers, canonicalRequest, stringToSign };
}

async function send(cfg, opts) {
  const { url, headers } = signRequest(cfg, opts);
  const res = await fetch(url, {
    method: opts.method,
    headers,
    ...(opts.body === null ? {} : { body: opts.body }),
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.redirect ? { redirect: opts.redirect } : {}),
  });
  return res;
}

/** The signed request itself — for probes that inject a failure around it. */
export const sendSigned = send;

const MAX_HEAD_BYTES = 1024 * 1024;

function conditionalHeaders(method, condition) {
  if (method !== 'PUT' || !condition || typeof condition !== 'object' || Array.isArray(condition)) {
    throw new TypeError('Conditional S3 writes require exactly one PUT precondition');
  }
  const keys = Object.keys(condition);
  if (keys.length === 1 && keys[0] === 'ifNoneMatch' && condition.ifNoneMatch === '*') {
    return { 'if-none-match': '*' };
  }
  if (
    keys.length === 1 &&
    keys[0] === 'ifMatch' &&
    typeof condition.ifMatch === 'string' &&
    condition.ifMatch.length <= 512 &&
    /^"[\x21\x23-\x7e]+"$/.test(condition.ifMatch)
  ) {
    return { 'if-match': condition.ifMatch };
  }
  throw new TypeError('Use ifNoneMatch: "*" or the exact strong quoted ETag from S3');
}

/**
 * Bounded metadata CAS primitive. No retry is automatic: an interrupted response
 * can follow a successful write. Read the authoritative head and resolve the
 * proposed transaction before deciding whether another write is appropriate.
 * A 412 may be a competing writer OR our earlier unknown-outcome write.
 */
export async function putObjectConditional(cfg, key, body, condition, { signal } = {}) {
  conditionalHeaders('PUT', condition); // Fail before dispatch; never fall back to plain PUT.
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (bytes.length > MAX_HEAD_BYTES) throw new RangeError('Conditional S3 metadata exceeds 1 MiB');
  const res = await send(cfg, {
    method: 'PUT',
    key,
    body: bytes,
    condition,
    signal: signal ?? AbortSignal.timeout(10000),
    redirect: 'error',
  });
  if ([404, 409, 412].includes(res.status)) {
    await res.body?.cancel();
    return {
      status: 'not-written',
      reason:
        res.status === 412 ? 'precondition-failed' : res.status === 409 ? 'conflict' : 'missing',
      httpStatus: res.status,
    };
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw Object.assign(new Error(`S3 conditional PUT failed: ${res.status}`), {
      httpStatus: res.status,
    });
  }
  const etag = res.headers.get('etag');
  await res.body?.cancel();
  if (!etag || !/^"[\x21\x23-\x7e]+"$/.test(etag)) {
    throw new Error(
      'S3 conditional PUT returned no usable ETag; outcome must be resolved by reading'
    );
  }
  return { status: 'written', key, bytes: bytes.length, etag };
}

/** Read bounded head bytes and their ETag from ONE response, never HEAD + GET. */
export async function getObjectVersion(cfg, key, { signal } = {}) {
  const res = await send(cfg, {
    method: 'GET',
    key,
    signal: signal ?? AbortSignal.timeout(10000),
    redirect: 'error',
  });
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw Object.assign(new Error(`S3 version GET failed: ${res.status}`), {
      httpStatus: res.status,
    });
  }
  const etag = res.headers.get('etag');
  if (!etag || etag.length > 512 || !/^"[\x21\x23-\x7e]+"$/.test(etag)) {
    await res.body?.cancel();
    throw new Error('S3 version GET returned no usable ETag');
  }
  const reader = res.body?.getReader();
  if (!reader) return { body: Buffer.alloc(0), etag };
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_HEAD_BYTES) throw new RangeError('S3 metadata exceeds 1 MiB');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return { body: Buffer.concat(chunks, size), etag };
}

/** PUT one object. Throws with the service's message on a non-2xx. */
export async function putObject(cfg, key, body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const res = await send(cfg, { method: 'PUT', key, body: buf });
  if (!res.ok) {
    throw new Error(`S3 PUT ${key} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return { key, bytes: buf.length, etag: res.headers.get('etag') };
}

/**
 * PUT a FILE — plan T18. Small files go up in one request; large ones as an
 * S3 multipart upload (R2 and S3 both speak it), one part at a time, so memory
 * stays at one part however big the video is. A failed multipart upload is
 * aborted so the bucket keeps no orphaned parts.
 */
export async function putObjectFromFile(
  cfg,
  key,
  abs,
  { threshold = 64 * 1024 * 1024, partBytes = 16 * 1024 * 1024, deps = {} } = {}
) {
  const { size } = statSync(abs);
  if (size <= threshold) return putObject(cfg, key, readFileSync(abs));
  const call = deps.send ?? ((opts) => send(cfg, opts));
  const pause = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  // A large upload meets transient faults as a matter of course: a pooled
  // keep-alive socket S3 already closed ("fetch failed"), a 503 SlowDown, a
  // 500. Each is retried with backoff — a thrown network error included, which
  // is what failed a real 513 MiB upload before any byte moved. A 4xx other
  // than 429 is an answer, not a fault, and ends the attempt.
  const retrying = async (opts, what) => {
    let last = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt) await pause(250 * 2 ** (attempt - 1));
      try {
        const res = await call(opts);
        if (res.ok || (res.status < 500 && res.status !== 429)) return res;
        last = new Error(`${what}: ${res.status}`);
      } catch (err) {
        last = err;
      }
    }
    throw new Error(`${what} failed after retries: ${last?.message ?? last}`);
  };
  const created = await retrying(
    { method: 'POST', key, query: { uploads: '' }, body: Buffer.alloc(0) },
    `S3 multipart start ${key}`
  );
  if (!created.ok) {
    throw new Error(`S3 multipart start ${key} failed: ${created.status} ${(await created.text()).slice(0, 300)}`);
  }
  const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(await created.text())?.[1];
  if (!uploadId) throw new Error(`S3 multipart start ${key}: no UploadId`);
  const etags = [];
  const fd = openSync(abs, 'r');
  try {
    const buf = Buffer.allocUnsafe(partBytes);
    for (let part = 1, offset = 0; offset < size; part += 1) {
      const n = readSync(fd, buf, 0, Math.min(partBytes, size - offset), offset);
      const body = Buffer.from(buf.subarray(0, n));
      const res = await retrying(
        { method: 'PUT', key, query: { partNumber: String(part), uploadId }, body },
        `S3 part ${part} of ${key}`
      );
      if (!res.ok) throw new Error(`S3 part ${part} of ${key} failed: ${res.status}`);
      etags.push({ part, etag: res.headers.get('etag') });
      offset += n;
    }
    const xml =
      '<CompleteMultipartUpload>' +
      etags.map((e) => `<Part><PartNumber>${e.part}</PartNumber><ETag>${e.etag}</ETag></Part>`).join('') +
      '</CompleteMultipartUpload>';
    let done;
    let completeError = null;
    try {
      done = await retrying({ method: 'POST', key, query: { uploadId }, body: Buffer.from(xml) }, `S3 multipart complete ${key}`);
    } catch (err) {
      done = null;
      completeError = err;
    }
    const text = done ? await done.text() : '';
    // A completion whose answer was lost may have landed: a retry then reads
    // NoSuchUpload. The object at full size is the proof it did.
    if (!done || /NoSuchUpload/.test(text)) {
      const head = await headObject(cfg, key).catch(() => null);
      if (head?.size === size) return { key, bytes: size, parts: etags.length };
      throw completeError ?? new Error(`S3 multipart complete ${key} failed: ${done?.status} ${text.slice(0, 300)}`);
    }
    // S3 can answer 200 with an <Error> body for a failed completion.
    if (!done.ok || /<Error>/.test(text)) {
      throw new Error(`S3 multipart complete ${key} failed: ${done.status} ${text.slice(0, 300)}`);
    }
    return { key, bytes: size, parts: etags.length };
  } catch (err) {
    await call({ method: 'DELETE', key, query: { uploadId }, body: null }).catch(() => {});
    throw err;
  } finally {
    closeSync(fd);
  }
}

/**
 * GET an object straight to a file — plan T18: a large video restored at a
 * cell's boot never sits whole in memory. Returns the byte count, or null on
 * 404. Refuses (and removes the partial file) past `maxBytes`.
 */
export async function getObjectToFile(cfg, key, abs, { maxBytes = Number.POSITIVE_INFINITY } = {}) {
  const res = await send(cfg, { method: 'GET', key });
  if (res.status === 404) return null;
  if (!res.ok || !res.body) {
    throw new Error(`S3 GET ${key} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body.cancel().catch(() => {});
    throw new Error(`S3 GET ${key}: ${declared} bytes is over the ${maxBytes}-byte ceiling`);
  }
  const out = createWriteStream(abs);
  let total = 0;
  try {
    for await (const chunk of res.body) {
      total += chunk.byteLength;
      if (total > maxBytes) throw new Error(`S3 GET ${key}: over the ${maxBytes}-byte ceiling`);
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    }
    await new Promise((r, j) => out.end((err) => (err ? j(err) : r())));
  } catch (err) {
    out.destroy();
    rmSync(abs, { force: true });
    throw err;
  }
  return total;
}

/** GET one object as a Buffer, or null on 404. */
export async function getObject(cfg, key) {
  const res = await send(cfg, { method: 'GET', key });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`S3 GET ${key} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * HEAD one object → `{ size }`, or null on 404. Used by the asset proxy's HEAD
 * and by `asset-check`, which needs existence + size without paying to
 * download a 60 MB video just to learn it is there.
 */
export async function headObject(cfg, key) {
  const res = await send(cfg, { method: 'HEAD', key });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`S3 HEAD ${key} failed: ${res.status}`);
  return { size: Number(res.headers.get('content-length') ?? 0) };
}

export async function deleteObject(cfg, key) {
  const res = await send(cfg, { method: 'DELETE', key });
  if (!res.ok && res.status !== 404) {
    throw new Error(`S3 DELETE ${key} failed: ${res.status}`);
  }
  return true;
}

/**
 * List keys under a prefix (ListObjectsV2, paginated to exhaustion).
 * Returns `[{ key, size, lastModified }]` sorted by key.
 *
 * The XML is parsed with regex rather than a parser dependency. That is
 * defensible ONLY because the shape is fixed and machine-generated, and the
 * values we extract (key, size, date) are used for our own bookkeeping — never
 * rendered into a page or a shell command.
 */
export async function listObjects(cfg, prefix = '') {
  const out = [];
  let token;
  do {
    const query = { 'list-type': '2', prefix };
    if (token) query['continuation-token'] = token;
    const res = await send(cfg, { method: 'GET', key: '', query });
    if (!res.ok) {
      throw new Error(
        `S3 LIST ${prefix} failed: ${res.status} ${(await res.text()).slice(0, 300)}`
      );
    }
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const block = m[1];
      const key = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
      if (!key) continue;
      out.push({
        key: decodeXmlEntities(key),
        size: Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0),
        lastModified: block.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1] ?? null,
      });
    }
    token = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1];
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) token = undefined;
  } while (token);
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
