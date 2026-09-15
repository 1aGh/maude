#!/usr/bin/env node
// Plan T18/T32 — the hub's resumable-media S3 adapter against REAL S3 (or R2),
// in a fresh synthetic prefix, then removed. Explicit and bounded: it verifies
// the caller account and bucket owner first, refuses a non-empty prefix,
// deploys nothing and touches no project data.
//
//   node scripts/dev/t18-s3-probe.mjs --scratch-write <profile> <bucket> <region> <expected-account> [--big-mib 513]
//
// Cases: a 96 MiB file (over the single-PUT limit) and a --big-mib file go up
// as multipart and come back byte-identical by SHA-256 through the streamed
// download; a part that fails twice is retried to success; a part that keeps
// failing aborts the upload, leaving no incomplete multipart upload behind.
// Every object version and delete marker under the prefix is deleted at the
// end and the prefix is listed empty. Credentials stay in process memory.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, rmSync, statSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256File } from '../../apps/hub/src/file-limits.mjs';
import { getObjectToFile, putObjectFromFile } from '../../apps/hub/src/s3.mjs';

const argv = process.argv.slice(2);
const [flag, profile, bucket, region, account] = argv;
if (flag !== '--scratch-write' || !profile || !bucket || !region || !/^\d{12}$/.test(account || ''))
  throw new Error(
    'Usage: t18-s3-probe.mjs --scratch-write <profile> <bucket> <region> <expected-account> [--big-mib N]'
  );
const bigIdx = argv.indexOf('--big-mib');
const BIG_MIB = bigIdx > 0 ? Number(argv[bigIdx + 1]) : 513;
const MIB = 1024 * 1024;

const aws = (args) =>
  JSON.parse(
    execFileSync('aws', [...args, '--profile', profile, '--region', region, '--output', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    }) || '{}'
  );
assert.equal(aws(['sts', 'get-caller-identity']).Account, account, 'caller account');
aws(['s3api', 'head-bucket', '--bucket', bucket, '--expected-bucket-owner', account]);
const prefix = `maude-sync-conformance/t18-${randomUUID()}`;
const inventory = () =>
  aws([
    's3api',
    'list-object-versions',
    '--bucket',
    bucket,
    '--prefix',
    `${prefix}/`,
    '--expected-bucket-owner',
    account,
  ]);
const versions = (r) => [...(r.Versions || []), ...(r.DeleteMarkers || [])];
const openUploads = () =>
  (
    aws([
      's3api',
      'list-multipart-uploads',
      '--bucket',
      bucket,
      '--prefix',
      `${prefix}/`,
      '--expected-bucket-owner',
      account,
    ]).Uploads || []
  ).length;
assert.equal(versions(inventory()).length, 0, 'the fresh prefix must be empty before any write');

const credential = JSON.parse(
  execFileSync(
    'aws',
    ['configure', 'export-credentials', '--profile', profile, '--format', 'process'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    }
  )
);
const cfg = {
  endpoint: `https://s3.${region}.amazonaws.com`,
  bucket,
  region,
  accessKeyId: credential.AccessKeyId,
  secretAccessKey: credential.SecretAccessKey,
  ...(credential.SessionToken ? { sessionToken: credential.SessionToken } : {}),
};

const work = mkdtempSync(join(tmpdir(), 't18-s3-'));
// Deterministic, incompressible-looking bytes without holding the file in memory.
function makeFile(name, mib) {
  const abs = join(work, name);
  const fd = openSync(abs, 'w');
  const chunk = Buffer.alloc(MIB);
  for (let i = 0; i < mib; i++) {
    let seed = createHash('sha256').update(`${name}:${i}`).digest();
    for (let o = 0; o < MIB; o += 32) {
      seed.copy(chunk, o);
      seed = createHash('sha256').update(seed).digest();
    }
    writeSync(fd, chunk);
  }
  closeSync(fd);
  return abs;
}

const report = {
  status: 'running',
  account,
  bucket,
  region,
  prefix,
  node: process.version,
  started: new Date().toISOString(),
  cases: [],
  cleanup: null,
  limitations:
    'Adapter-level: the hub S3 client (multipart put, streamed get) against real S3. Not the hub HTTP upload-session door, not R2, not quota.',
};
const time = async (fn) => {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t0) };
};

try {
  for (const [name, mib] of [
    ['over-single-put.bin', 96],
    ['large-video-profile.bin', BIG_MIB],
  ]) {
    const abs = makeFile(name, mib);
    const key = `${prefix}/${name}`;
    const want = await sha256File(abs);
    const up = await time(() => putObjectFromFile(cfg, key, abs));
    const back = join(work, `${name}.back`);
    const down = await time(() => getObjectToFile(cfg, key, back));
    const got = await sha256File(back);
    report.cases.push({
      case: `multipart round trip ${mib} MiB`,
      bytes: statSync(abs).size,
      parts: up.value.parts ?? 1,
      uploadMs: up.ms,
      downloadMs: down.ms,
      sha256Match: got === want,
    });
    assert.equal(got, want, `${name}: downloaded bytes differ`);
    rmSync(abs);
    rmSync(back);
  }

  // A part that fails twice is retried to success — one object, right bytes.
  {
    const abs = makeFile('flaky-part.bin', 72);
    const key = `${prefix}/flaky-part.bin`;
    let failures = 0;
    const send = await realSendWith(async (opts, real) => {
      if (opts.method === 'PUT' && opts.query?.partNumber === '2' && failures < 2) {
        failures++;
        return new Response('injected', { status: 503 });
      }
      return real(opts);
    });
    const res = await putObjectFromFile(cfg, key, abs, { deps: { send } });
    const back = join(work, 'flaky.back');
    await getObjectToFile(cfg, key, back);
    report.cases.push({
      case: 'part fails twice, retried to success',
      injectedFailures: failures,
      parts: res.parts,
      sha256Match: (await sha256File(back)) === (await sha256File(abs)),
    });
    rmSync(abs);
    rmSync(back);
  }

  // A part that keeps failing aborts the upload: no incomplete upload remains.
  {
    const abs = makeFile('abort.bin', 72);
    const key = `${prefix}/abort.bin`;
    const send = await realSendWith(async (opts, real) =>
      opts.method === 'PUT' && opts.query?.partNumber === '3'
        ? new Response('injected', { status: 503 })
        : real(opts)
    );
    const refused = await putObjectFromFile(cfg, key, abs, { deps: { send } }).then(
      () => false,
      () => true
    );
    const lingering = openUploads();
    const exists = versions(inventory()).some((v) => v.Key === key);
    report.cases.push({
      case: 'part keeps failing → aborted',
      refused,
      incompleteUploads: lingering,
      objectCreated: exists,
    });
    assert.equal(refused, true);
    assert.equal(lingering, 0, 'an aborted upload must leave no parts');
    assert.equal(exists, false);
    rmSync(abs);
  }
  report.status = 'passed';
} catch (err) {
  report.status = 'failed';
  report.error = String(err?.stack ?? err).slice(0, 2000);
} finally {
  // Remove every version and delete marker under the prefix, then prove it.
  const all = versions(inventory());
  for (const v of all)
    aws([
      's3api',
      'delete-object',
      '--bucket',
      bucket,
      '--key',
      v.Key,
      '--version-id',
      v.VersionId,
      '--expected-bucket-owner',
      account,
    ]);
  for (const u of aws([
    's3api',
    'list-multipart-uploads',
    '--bucket',
    bucket,
    '--prefix',
    `${prefix}/`,
    '--expected-bucket-owner',
    account,
  ]).Uploads || [])
    aws([
      's3api',
      'abort-multipart-upload',
      '--bucket',
      bucket,
      '--key',
      u.Key,
      '--upload-id',
      u.UploadId,
      '--expected-bucket-owner',
      account,
    ]);
  report.cleanup = {
    deletedVersions: all.length,
    remainingVersions: versions(inventory()).length,
    remainingUploads: openUploads(),
  };
  report.finished = new Date().toISOString();
  rmSync(work, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.status === 'passed' && report.cleanup.remainingVersions === 0 ? 0 : 1);

// The adapter's `deps.send` replaces its signed request; wrap the real one so a
// case can inject a response for a chosen part and pass the rest through.
async function realSendWith(wrap) {
  const mod = await import('../../apps/hub/src/s3.mjs');
  const real = (opts) => mod.sendSigned(cfg, opts);
  return (opts) => wrap(opts, real);
}
