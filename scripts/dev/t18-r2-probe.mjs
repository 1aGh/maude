#!/usr/bin/env node
// F2: a REAL R2 multipart round-trip through the production hub adapter.
// Credentials are read from MAUDE_S3_* env, never flags or printed output.
// node scripts/dev/t18-r2-probe.mjs --scratch-write <account-id> <test-bucket>
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File } from '../../apps/hub/src/file-limits.mjs';
import {
  deleteObject,
  getObjectToFile,
  listObjects,
  putObjectFromFile,
  s3ConfigFromEnv,
  sendSigned,
} from '../../apps/hub/src/s3.mjs';

export function r2ProbeConfig(args, env = process.env) {
  const [flag, account, bucket] = args;
  if (
    args.length !== 3 ||
    flag !== '--scratch-write' ||
    !/^[a-f0-9]{32}$/.test(account ?? '') ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket ?? '')
  ) {
    throw new Error('Usage: t18-r2-probe.mjs --scratch-write <account-id> <test-bucket>');
  }
  const cfg = s3ConfigFromEnv(env);
  if (!cfg)
    throw new Error('R2 credentials/target missing: configure MAUDE_S3_* environment variables.');
  if (cfg.endpoint !== `https://${account}.r2.cloudflarestorage.com`)
    throw new Error('R2 endpoint does not match the explicit account.');
  if (cfg.bucket !== bucket) throw new Error('R2 bucket does not match the explicit test bucket.');
  if (cfg.region !== 'auto') throw new Error('R2 region must be auto.');
  return cfg;
}

export async function runR2Probe(cfg) {
  const prefix = `maude-sync-conformance/f2-${randomUUID()}/`;
  const key = `${prefix}multipart.bin`;
  const work = mkdtempSync(join(tmpdir(), 'maude-r2-probe-'));
  const input = join(work, 'input.bin');
  const output = join(work, 'output.bin');
  const bytes = 96 * 1024 * 1024; // Above the adapter's real 64 MiB threshold.
  const report = {
    backend: 'r2',
    bucket: cfg.bucket,
    prefix,
    bytes,
    status: 'failed',
    cleanup: false,
  };
  let mayHaveWritten = false;
  let step = 'assert empty scratch prefix';
  try {
    assert.deepEqual(await listObjects(cfg, prefix), []);
    step = 'generate real bytes';
    const fd = openSync(input, 'wx');
    try {
      for (let i = 0; i < 96; i++) {
        const chunk = randomBytes(1024 * 1024);
        let offset = 0;
        while (offset < chunk.length) offset += writeSync(fd, chunk, offset, chunk.length - offset);
      }
    } finally {
      closeSync(fd);
    }
    const expected = await sha256File(input);
    step = 'multipart upload';
    mayHaveWritten = true;
    const start = performance.now();
    const uploaded = await putObjectFromFile(cfg, key, input, {
      deps: {
        send: (opts) =>
          sendSigned(cfg, { ...opts, redirect: 'error', signal: AbortSignal.timeout(120_000) }),
      },
    });
    report.uploadMs = Math.round(performance.now() - start);
    report.parts = uploaded.parts;
    assert.ok(uploaded.parts > 1, 'must exercise multipart, not single PUT');
    step = 'streamed download and hash';
    assert.equal(await getObjectToFile(cfg, key, output, { maxBytes: bytes }), bytes);
    report.sha256 = await sha256File(output);
    assert.equal(report.sha256, expected, 'downloaded bytes must match');
    report.status = 'passed';
  } catch (error) {
    // Never print a vendor response, signed request, or credential-bearing URL.
    report.error = { step, kind: error.name };
  } finally {
    try {
      // Delete ONLY the exact key this invocation attempted, never a listed
      // key, bucket, or prefix. The production adapter aborts failed multipart.
      if (mayHaveWritten) await deleteObject(cfg, key);
      assert.deepEqual(await listObjects(cfg, prefix), []);
      const uploads = await sendSigned(cfg, {
        method: 'GET',
        key: '',
        query: { uploads: '', prefix },
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      assert.equal(uploads.ok, true);
      assert.ok(!/<Upload>/.test(await uploads.text()), 'no incomplete upload may remain');
      report.cleanup = true;
    } catch (error) {
      report.cleanupError = { kind: error.name, key };
      report.status = 'failed';
    }
    rmSync(work, { recursive: true, force: true });
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await runR2Probe(r2ProbeConfig(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === 'passed' && report.cleanup ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
