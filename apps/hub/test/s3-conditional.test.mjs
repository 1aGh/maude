import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { getObjectVersion, putObjectConditional, signRequest } from '../src/s3.mjs';

const base = {
  endpoint: 'http://127.0.0.1',
  bucket: 'fixture',
  accessKeyId: 'example',
  secretAccessKey: 'not-a-real-secret',
  region: 'auto',
};

test('preconditions are included in SigV4 and cannot silently become unconditional writes', async () => {
  const args = {
    method: 'PUT',
    key: 'head',
    body: Buffer.from('a'),
    now: new Date('2026-09-14T12:00:00Z'),
  };
  const first = signRequest(base, { ...args, condition: { ifNoneMatch: '*' } });
  const next = signRequest(base, { ...args, condition: { ifMatch: '"old-etag"' } });
  assert.match(first.canonicalRequest, /if-none-match:\*\n/);
  assert.match(first.headers.authorization, /SignedHeaders=host;if-none-match;/);
  assert.match(next.canonicalRequest, /if-match:"old-etag"\n/);
  assert.notEqual(first.headers.authorization, next.headers.authorization);
  assert.notEqual(
    next.headers.authorization,
    signRequest(base, { ...args, condition: { ifMatch: '"new-etag"' } }).headers.authorization
  );
  for (const condition of [
    undefined,
    null,
    {},
    { ifMatch: '*' },
    { ifMatch: 'W/"weak"' },
    { ifMatch: '"a"\r\nx: y' },
    { ifNoneMatch: 'x' },
    { ifMatch: '"a"', ifNoneMatch: '*' },
    { ifMath: '"typo"' },
  ]) {
    await assert.rejects(putObjectConditional(base, 'head', 'body', condition), TypeError);
  }
});

async function fixture(t) {
  const objects = new Map();
  let lost = false;
  const requests = [];
  const server = createServer(async (req, res) => {
    const key = new URL(req.url, 'http://local').pathname;
    requests.push({ method: req.method, key, headers: req.headers });
    if (key.endsWith('/status409')) {
      res.writeHead(409).end();
      return;
    }
    if (key.endsWith('/status503')) {
      res.writeHead(503).end();
      return;
    }
    if (key.endsWith('/oversize')) {
      res.writeHead(200, { etag: '"large"' });
      res.end(Buffer.alloc(1024 * 1024 + 1));
      return;
    }
    if (req.method === 'GET') {
      const current = objects.get(key);
      if (!current) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { etag: current.etag });
      res.end(current.body);
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks),
      current = objects.get(key);
    const matches = req.headers['if-match'];
    if (
      (req.headers['if-none-match'] === '*' && current) ||
      (matches && matches !== current?.etag)
    ) {
      res.writeHead(matches && !current ? 404 : 412).end();
      return;
    }
    assert.ok(
      matches || req.headers['if-none-match'] === '*',
      'every dispatched PUT is conditional'
    );
    const etag = '"' + createHash('sha256').update(body).digest('hex') + '"';
    objects.set(key, { body, etag });
    if (key.endsWith('/lost-ack') && !lost) {
      lost = true;
      req.socket.destroy();
      return;
    }
    res.writeHead(200, { etag });
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return {
    cfg: { ...base, endpoint: `http://127.0.0.1:${server.address().port}` },
    requests,
    objects,
  };
}

test('real HTTP client keeps one CAS winner, exact version reads and unknown-ACK reconciliation', async (t) => {
  const { cfg, requests } = await fixture(t);
  assert.equal(await getObjectVersion(cfg, 'head'), null);
  const created = await putObjectConditional(cfg, 'head', 'initial', { ifNoneMatch: '*' });
  const first = await getObjectVersion(cfg, 'head');
  assert.equal(first.body.toString(), 'initial');
  assert.equal(first.etag, created.etag);
  const results = await Promise.all(
    ['writer-a', 'writer-b'].map((body) =>
      putObjectConditional(cfg, 'head', body, { ifMatch: first.etag })
    )
  );
  assert.equal(results.filter((r) => r.status === 'written').length, 1);
  assert.equal(results.filter((r) => r.reason === 'precondition-failed').length, 1);
  const final = await getObjectVersion(cfg, 'head');
  assert.equal(final.etag, results.find((r) => r.status === 'written').etag);
  assert.ok(['writer-a', 'writer-b'].includes(final.body.toString()));
  await assert.rejects(
    putObjectConditional(cfg, 'lost-ack', 'transaction-1', { ifNoneMatch: '*' })
  );
  assert.equal(
    requests.filter((r) => r.method === 'PUT' && r.key.endsWith('/lost-ack')).length,
    1,
    'client does not retry an ambiguous write'
  );
  const recovered = await getObjectVersion(cfg, 'lost-ack');
  assert.equal(recovered.body.toString(), 'transaction-1');
  assert.equal(
    (await putObjectConditional(cfg, 'lost-ack', 'transaction-1', { ifNoneMatch: '*' })).reason,
    'precondition-failed'
  );
  for (const request of requests.filter((r) => r.method === 'PUT'))
    assert.match(request.headers.authorization, /SignedHeaders=host;if-(?:none-)?match;/);
});

test('conflict/unavailable/bounds are explicit and never trigger a plain PUT retry', async (t) => {
  const { cfg, requests } = await fixture(t);
  assert.equal(
    (await putObjectConditional(cfg, 'status409', 'x', { ifNoneMatch: '*' })).reason,
    'conflict'
  );
  await assert.rejects(
    putObjectConditional(cfg, 'status503', 'x', { ifNoneMatch: '*' }),
    (e) => e.httpStatus === 503
  );
  assert.equal(
    (await putObjectConditional(cfg, 'missing', 'x', { ifMatch: '"missing"' })).reason,
    'missing'
  );
  await assert.rejects(getObjectVersion(cfg, 'oversize'), /exceeds 1 MiB/);
  const before = requests.length;
  await assert.rejects(
    putObjectConditional(cfg, 'too-big', Buffer.alloc(1024 * 1024 + 1), { ifNoneMatch: '*' }),
    RangeError
  );
  assert.equal(requests.length, before);
  assert.equal(requests.filter((r) => r.key.endsWith('/status503')).length, 1);
});
