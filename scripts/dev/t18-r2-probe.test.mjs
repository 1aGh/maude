import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { r2ProbeConfig, runR2Probe } from './t18-r2-probe.mjs';

// Synthetic, non-secret fixture credentials; never sent to a network.
const account = '0'.repeat(32);
const env = {
  MAUDE_S3_ENDPOINT: `https://${account}.r2.cloudflarestorage.com`,
  MAUDE_S3_BUCKET: 'isolated-test-bucket',
  MAUDE_S3_ACCESS_KEY_ID: 'fixture-id',
  MAUDE_S3_SECRET_ACCESS_KEY: 'fixture-secret',
};
const args = ['--scratch-write', account, 'isolated-test-bucket'];
test('R2 requires explicit account/bucket approval and configured credentials', () => {
  assert.equal(r2ProbeConfig(args, env).region, 'auto');
  assert.throws(() => r2ProbeConfig([], env), /Usage/);
  assert.throws(() => r2ProbeConfig(args, {}), /credentials/);
  assert.throws(() => r2ProbeConfig(args, { ...env, MAUDE_S3_BUCKET: 'production' }), /bucket/);
});
test('R2 target cannot be redirected to another account, host, path or cleartext', () => {
  for (const endpoint of [
    'http://127.0.0.1',
    `http://${account}.r2.cloudflarestorage.com`,
    'https://1.r2.cloudflarestorage.com',
    `https://${account}.r2.cloudflarestorage.com/other`,
    `https://${account}.r2.cloudflarestorage.com.evil.example`,
  ])
    assert.throws(() => r2ProbeConfig(args, { ...env, MAUDE_S3_ENDPOINT: endpoint }), /endpoint/);
});
test('invoking without explicit target fails closed without exposing credentials', () => {
  const result = spawnSync(process.execPath, ['scripts/dev/t18-r2-probe.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage/);
  assert.ok(!result.stderr.includes(env.MAUDE_S3_SECRET_ACCESS_KEY));
});

// Local protocol fixture verifies the probe itself, NOT Cloudflare behavior.
// No production adapter methods are mocked: signing, multipart threshold,
// streamed GET, hashing and cleanup all cross a real loopback HTTP connection.
for (const rejectPart of [false, true]) {
  test(`probe wire round-trip and cleanup (part rejected: ${rejectPart})`, async () => {
    const parts = new Map();
    let object = null;
    let uploadOpen = false;
    let aborted = false;
    let deleted = false;
    let uploadedParts = 0;
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://fixture');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      if (!req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')) {
        res.writeHead(403).end();
        return;
      }
      if (req.method === 'GET' && url.searchParams.has('list-type')) {
        res.end('<ListBucketResult></ListBucketResult>');
      } else if (req.method === 'POST' && url.searchParams.has('uploads')) {
        uploadOpen = true;
        res.end(
          '<InitiateMultipartUploadResult><UploadId>fixture</UploadId></InitiateMultipartUploadResult>'
        );
      } else if (req.method === 'PUT' && url.searchParams.has('partNumber')) {
        if (rejectPart) {
          res.writeHead(403).end('fixture refusal');
          return;
        }
        parts.set(Number(url.searchParams.get('partNumber')), body);
        uploadedParts++;
        res.setHeader('etag', '"fixture-etag"');
        res.end();
      } else if (req.method === 'POST' && url.searchParams.has('uploadId')) {
        object = Buffer.concat([...parts.entries()].sort(([a], [b]) => a - b).map(([, b]) => b));
        parts.clear();
        uploadOpen = false;
        res.end('<CompleteMultipartUploadResult/>');
      } else if (req.method === 'GET' && url.searchParams.has('uploads')) {
        res.end(
          `<ListMultipartUploadsResult>${uploadOpen ? '<Upload>fixture</Upload>' : ''}</ListMultipartUploadsResult>`
        );
      } else if (req.method === 'DELETE' && url.searchParams.has('uploadId')) {
        aborted = true;
        parts.clear();
        uploadOpen = false;
        res.writeHead(204).end();
      } else if (req.method === 'DELETE') {
        deleted = true;
        object = null;
        res.writeHead(204).end();
      } else if (req.method === 'GET' && object) {
        res.setHeader('content-length', object.length);
        res.end(object);
      } else res.writeHead(400).end('unexpected fixture request');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const cfg = {
        ...r2ProbeConfig(args, env),
        endpoint: `http://127.0.0.1:${server.address().port}`,
      };
      const report = await runR2Probe(cfg);
      assert.equal(report.status, rejectPart ? 'failed' : 'passed');
      assert.equal(report.cleanup, true);
      assert.equal(deleted, true);
      assert.equal(uploadOpen, false);
      assert.equal(object, null);
      assert.equal(aborted, rejectPart);
      if (!rejectPart) {
        assert.equal(report.parts, 6);
        assert.equal(uploadedParts, 6);
        assert.match(report.sha256, /^[a-f0-9]{64}$/);
      } else assert.equal(report.error.step, 'multipart upload');
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
}
