// S3/R2 asset lane — Cloud Phase 3 Task 2.
//
// THE PROBLEM. Binary media currently rides git. A 60 MB video in a design repo
// is 60 MB in every clone, forever, and git's delta compression does nothing for
// it. DDR-148's line that "video rides git and hub sync" describes an intent the
// code never made true cross-machine; this lane is what makes heavy media
// actually reach a second machine without bloating history.
//
// THE SHAPE. Assets stay CONTENT-ADDRESSED exactly as they are today —
// `assets/<sha8>.<ext>`. That single property is what makes every operation
// here safe:
//
//   • push is idempotent — the same bytes produce the same key, so a re-upload
//     is a no-op rather than a duplicate;
//   • there is no invalidation problem — a key's content never changes, so a
//     cached copy is never stale;
//   • pull is verifiable — the bytes must hash back to the key they came from,
//     which is what lets us accept them from a semi-trusted hub (DDR-054).
//
// NEVER GARBAGE-COLLECTED. A canvas in git history can reference an asset that
// no current canvas does, so "unreferenced" never means "unreachable". Bucket
// lifecycle/expiry rules MUST be off for the `assets/` prefix — an expired
// object is a permanently broken canvas with no recovery path.
//
// NO PRESIGNED URLS IN A CANVAS. The canvas origin's CSP is `img-src 'self'`
// (DDR-063/DDR-054) and stays that way: media is fetched through the hub's
// authenticated proxy and served same-origin. A presigned URL would also be a
// bearer credential embedded in tenant-authored content — exactly the thing the
// canvas must never hold.

import { createHash, createHmac } from 'node:crypto';

// ---------------------------------------------------------------- SigV4

const sha256Hex = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string): Buffer =>
  createHmac('sha256', key).update(data).digest();

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  sessionToken?: string;
}

/**
 * Resolve an S3 target from environment. Returns null when not configured —
 * an unconfigured asset lane is the DEFAULT, not an error: a local project and
 * a self-hoster on a single box both work without a bucket.
 */
export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config | null {
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

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeSegment).join('/');
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/**
 * AWS Signature Version 4 for one request.
 *
 * Hand-rolled for the same reason the hub's is (DDR-194 §7): `@aws-sdk/client-s3`
 * is ~20 MB and several hundred packages to perform three HTTP verbs, and this
 * code ships inside a compiled binary users install. Deliberately mirrors
 * `apps/hub/src/s3.mjs` rather than sharing it — the two packages build
 * independently — and `test/assets-s3.test.ts` pins them to the same signature
 * for the same input so they cannot drift.
 */
export function signRequest(
  cfg: S3Config,
  {
    method,
    key,
    body = null,
    bodySha256,
    now = new Date(),
  }: {
    method: string;
    key: string;
    body?: Uint8Array | null;
    /** Hex SHA-256 of a body the caller streams instead of passing as `body`. */
    bodySha256?: string;
    now?: Date;
  }
): SignedRequest {
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}${key ? `/${encodeKey(key)}` : ''}`);
  const iso = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const dateStamp = iso.slice(0, 8);
  const payloadHash = bodySha256 ?? (body === null ? sha256Hex('') : sha256Hex(body));

  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': iso,
    ...(cfg.sessionToken ? { 'x-amz-security-token': cfg.sessionToken } : {}),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((h) => `${h}:${headers[h]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method,
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', iso, scope, sha256Hex(canonicalRequest)].join('\n');

  let signingKey = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
  signingKey = hmac(signingKey, cfg.region);
  signingKey = hmac(signingKey, 's3');
  signingKey = hmac(signingKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url: url.toString(), headers };
}

// ------------------------------------------------------------ content address

/** The `sha8` in `assets/<sha8>.<ext>` — first 8 hex chars of sha256. */
export function sha8(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 8);
}

/**
 * Extract the sha8 from a designRoot-relative asset path, or null when the path
 * is not a content-addressed asset (a legacy or hand-placed file).
 *
 * The suffix after the hash is deliberately permissive, because the real corpus
 * is more varied than `<sha8>.<ext>`:
 *
 *   assets/deadbeef.png            saveAsset's own output
 *   assets/deadbeef.photo.json     a sidecar (dotted, multi-part)
 *   assets/deadbeef-cloud.mp4      ingested footage, hash + human label
 *
 * A stricter pattern silently classified the last two as "not content
 * addressed", which made `verifyAssetBytes` refuse them — so the mirror would
 * have rejected legitimate assets as unverifiable. Found by running
 * `maude hub asset-check` against this repo's own design root, not by a test:
 * the fixtures all had the tidy shape.
 *
 * What must NOT match is anything where the 8 hex chars are not a complete
 * token — `deadbeef1.png` is a different name, not this asset.
 */
export function sha8FromAssetPath(rel: string): string | null {
  const m = rel.match(/^assets\/([0-9a-f]{8})(?:[-.][^/]*)?$/);
  return m?.[1] ?? null;
}

/**
 * Verify bytes against the sha8 embedded in the path they were fetched under.
 *
 * This is what makes accepting an asset from a SEMI-TRUSTED hub (DDR-054) safe:
 * the hub can refuse to serve, but it cannot substitute different bytes without
 * the mismatch being detectable. A path with no sha8 (legacy) can't be verified
 * and is treated as unverifiable rather than valid.
 */
export function verifyAssetBytes(rel: string, bytes: Uint8Array): boolean {
  const expected = sha8FromAssetPath(rel);
  if (!expected) return false;
  return sha8(bytes) === expected;
}

// ------------------------------------------------------------------ the lane

export interface AssetMirror {
  readonly configured: boolean;
  readonly describe: string;
  /**
   * Upload one asset. Content-addressed ⇒ idempotent, so a re-push of identical
   * bytes is harmless. Returns false on failure rather than throwing: a failed
   * mirror must NEVER fail the local save (the file is on disk and in git; the
   * bucket is the redundant copy, not the authority).
   */
  push(rel: string, bytes: Uint8Array): Promise<boolean>;
  /**
   * {@link push} for a file already on disk, streamed so a 512 MB clip is never
   * held in RAM. `sha256Hex` is the hash of the file's bytes (the writer has it).
   */
  pushFile(rel: string, absPath: string, sha256Hex: string): Promise<boolean>;
  /** Download one asset, or null when absent. Verifies the content address. */
  pull(rel: string): Promise<Uint8Array | null>;
  /** True when the object exists. Used by the dangling-pointer check. */
  has(rel: string): Promise<boolean>;
}

const NOOP_MIRROR: AssetMirror = {
  configured: false,
  describe: 'none',
  async push() {
    return false;
  },
  async pushFile() {
    return false;
  },
  async pull() {
    return null;
  },
  async has() {
    return false;
  },
};

export function createAssetMirror(
  cfg: S3Config | null,
  { log = console }: { log?: Pick<Console, 'warn'> } = {}
): AssetMirror {
  if (!cfg) return NOOP_MIRROR;

  const send = (method: string, key: string, body: Uint8Array | null = null) => {
    const { url, headers } = signRequest(cfg, { method, key, body });
    // Uint8Array<ArrayBufferLike> vs BodyInit — see saveAsset in api.ts.
    return fetch(url, {
      method,
      headers,
      ...(body === null ? {} : { body: body as Uint8Array<ArrayBuffer> }),
    });
  };

  return {
    configured: true,
    describe: `s3://${cfg.bucket} @ ${cfg.endpoint}`,

    async push(rel, bytes) {
      try {
        const res = await send('PUT', rel, bytes);
        if (!res.ok) {
          log.warn(`[assets] mirror PUT ${rel} failed: ${res.status}`);
          return false;
        }
        return true;
      } catch (err) {
        // Offline, DNS, a bad key — all the same answer. The asset is safely on
        // local disk; a later push (or `maude hub asset-check`) reconciles.
        log.warn(`[assets] mirror PUT ${rel} failed: ${(err as Error).message}`);
        return false;
      }
    },

    async pushFile(rel, absPath, sha256Hex) {
      try {
        const { url, headers } = signRequest(cfg, {
          method: 'PUT',
          key: rel,
          bodySha256: sha256Hex,
        });
        const res = await fetch(url, { method: 'PUT', headers, body: Bun.file(absPath) });
        if (!res.ok) {
          log.warn(`[assets] mirror PUT ${rel} failed: ${res.status}`);
          return false;
        }
        return true;
      } catch (err) {
        log.warn(`[assets] mirror PUT ${rel} failed: ${(err as Error).message}`);
        return false;
      }
    },

    async pull(rel) {
      try {
        const res = await send('GET', rel);
        if (res.status === 404) return null;
        if (!res.ok) {
          log.warn(`[assets] mirror GET ${rel} failed: ${res.status}`);
          return null;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (!verifyAssetBytes(rel, bytes)) {
          // Content address mismatch: either corruption or substitution. Refuse
          // either way — writing these bytes to disk under this name would
          // poison every peer that later mirrors from us.
          log.warn(
            `[assets] REFUSING ${rel}: content does not hash to its own name ` +
              '(corruption or substitution — see DDR-054)'
          );
          return null;
        }
        return bytes;
      } catch (err) {
        log.warn(`[assets] mirror GET ${rel} failed: ${(err as Error).message}`);
        return null;
      }
    },

    async has(rel) {
      try {
        const res = await send('HEAD', rel);
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
