// The object storage the F3 self-host fixture writes to — one place.
//
// Default: a LOCAL S3-compatible server (RustFS in Docker, `maude-f3-s3`),
// started on demand and reached by the hub container by name on the fixture
// network (NETWORK below). It speaks the parts of S3 the hub relies on — conditional writes
// (If-Match / If-None-Match), multipart uploads, ListObjectsV2 — verified
// against apps/hub/src/s3.mjs before it was adopted (2026-09-25), after the
// isolated R2 test bucket was deleted with the rest of the cloud fixture.
//
// `F3_S3_ENV=<file>` switches to a real bucket: the file holds
// MAUDE_S3_ACCESS_KEY_ID / MAUDE_S3_SECRET_ACCESS_KEY, with MAUDE_S3_ENDPOINT
// and MAUDE_S3_BUCKET (defaulting to the old isolated R2 test bucket).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
/**
 * The fixture's own docker network. The hub container reaches the local S3
 * server and the local ProjectStore by NAME on it: a host firewall commonly
 * drops container → host traffic, so the docker bridge address is not a
 * reliable way back (2026-09-25: both timed out from the hub container).
 */
export const NETWORK = 'maude-f3';
const LOCAL = {
  container: 'maude-f3-s3',
  image: 'rustfs/rustfs:latest',
  bucket: 'maude-f3-local',
  accessKeyId: 'f3testkey',
  // A throwaway credential for a server published on loopback only.
  secretAccessKey: 'f3testsecret-local-only',
  region: 'us-east-1',
  hostEndpoint: 'http://127.0.0.1:9000',
  containerEndpoint: 'http://maude-f3-s3:9000',
};

const docker = (...a) => execFileSync('docker', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function fromFile(file) {
  const env = Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
  );
  const endpoint = env.MAUDE_S3_ENDPOINT ?? 'https://b5b596efe65abb732777c7171dc18145.r2.cloudflarestorage.com';
  return {
    bucket: env.MAUDE_S3_BUCKET ?? 'maude-multiplayer-test-20260922',
    accessKeyId: env.MAUDE_S3_ACCESS_KEY_ID,
    secretAccessKey: env.MAUDE_S3_SECRET_ACCESS_KEY,
    region: env.MAUDE_S3_REGION ?? 'auto',
    hostEndpoint: endpoint,
    containerEndpoint: endpoint,
  };
}

export function ensureNetwork() {
  try {
    docker('network', 'inspect', NETWORK);
  } catch {
    docker('network', 'create', NETWORK);
  }
}

async function ensureLocal() {
  ensureNetwork();
  let running = '';
  try {
    running = docker('inspect', '-f', '{{.State.Running}}', LOCAL.container);
  } catch {
    /* not created */
  }
  if (running !== 'true') {
    try {
      docker('rm', '-f', LOCAL.container);
    } catch {
      /* none */
    }
    docker(
      'run', '-d', '--name', LOCAL.container, '--network', NETWORK,
      '-p', '127.0.0.1:9000:9000',
      '-e', `RUSTFS_ACCESS_KEY=${LOCAL.accessKeyId}`,
      '-e', `RUSTFS_SECRET_KEY=${LOCAL.secretAccessKey}`,
      LOCAL.image, '/data'
    );
  }
  const { signRequest } = await import(`${REPO}apps/hub/src/s3.mjs`);
  const cfg = { ...LOCAL, endpoint: LOCAL.hostEndpoint };
  for (let i = 0; i < 60; i++) {
    try {
      const s = signRequest(cfg, { method: 'PUT', key: '', body: Buffer.alloc(0) });
      const r = await fetch(s.url, { method: 'PUT', headers: s.headers, signal: AbortSignal.timeout(3000) });
      const text = await r.text();
      if (r.status === 200 || /BucketAlready/.test(text)) return;
    } catch {
      /* booting */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('the local S3 server did not come up');
}

/** `{ bucket, accessKeyId, secretAccessKey, region, hostEndpoint, containerEndpoint }` */
export async function testS3() {
  ensureNetwork();
  if (process.env.F3_S3_ENV) return fromFile(process.env.F3_S3_ENV);
  await ensureLocal();
  return { ...LOCAL };
}

/** The hub container's MAUDE_S3_* environment. */
export async function hubS3Env() {
  const s = await testS3();
  return {
    MAUDE_S3_ENDPOINT: s.containerEndpoint,
    MAUDE_S3_BUCKET: s.bucket,
    MAUDE_S3_REGION: s.region,
    MAUDE_S3_ACCESS_KEY_ID: s.accessKeyId,
    MAUDE_S3_SECRET_ACCESS_KEY: s.secretAccessKey,
  };
}

/** An apps/hub/src/s3.mjs config for reading the bucket from THIS machine. */
export async function hostS3Config() {
  const s = await testS3();
  return {
    endpoint: s.hostEndpoint,
    bucket: s.bucket,
    accessKeyId: s.accessKeyId,
    secretAccessKey: s.secretAccessKey,
    region: s.region,
  };
}
