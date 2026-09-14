// Real HTTP + disk fixture, not an S3 emulator or evidence about AWS/R2 guarantees.

import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function objectFixture(directory) {
  mkdirSync(directory, { recursive: true });
  const requests = [],
    faults = [],
    violations = [];
  const path = (key) => join(directory, sha(key));
  function read(key) {
    try {
      const value = JSON.parse(readFileSync(path(key), 'utf8'));
      return { body: Buffer.from(value.body, 'base64'), etag: value.etag };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  function write(key, body) {
    const etag = `"${sha(body)}"`;
    const temporary = `${path(key)}.tmp`;
    writeFileSync(temporary, JSON.stringify({ key, body: body.toString('base64'), etag }));
    const fd = openSync(temporary, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path(key));
    return etag;
  }
  let barrier = null;
  async function fault(phase, req, res, key) {
    const index = faults.findIndex(
      (f) => f.phase === phase && f.method === req.method && key.endsWith(f.suffix)
    );
    if (index < 0) return false;
    const [failure] = faults.splice(index, 1);
    if (failure.effect === 'drop') req.socket.destroy();
    else if (failure.effect === 'hang') {
      /* client I/O deadline must end this */
    } else res.writeHead(failure.effect).end();
    return true;
  }
  const server = createServer(async (req, res) => {
    try {
      const key = decodeURIComponent(
        new URL(req.url, 'http://loopback').pathname.slice('/fixture/'.length)
      );
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      requests.push({
        method: req.method,
        key,
        bytes: body.length,
        ifMatch: req.headers['if-match'],
        ifNoneMatch: req.headers['if-none-match'],
      });
      if (await fault('before', req, res, key)) return;
      if (req.method === 'GET') {
        const current = read(key);
        if (!current) res.writeHead(404).end();
        else res.writeHead(200, { etag: current.etag }).end(current.body);
        return;
      }
      if (req.method !== 'PUT') {
        res.writeHead(405).end();
        return;
      }
      if (key.endsWith('/head') && barrier) {
        const active = barrier;
        active.arrived++;
        if (active.arrived === active.count) {
          barrier = null;
          active.release();
        }
        await active.promise;
      }
      if (
        !(req.headers['if-match'] || req.headers['if-none-match'] === '*') ||
        !/SignedHeaders=host;if-(?:none-)?match;/.test(req.headers.authorization || '') ||
        req.headers['x-amz-content-sha256'] !== sha(body)
      ) {
        violations.push('missing signed condition or wrong payload digest');
        res.writeHead(400).end();
        return;
      }
      const current = read(key);
      if (
        (req.headers['if-none-match'] === '*' && current) ||
        (req.headers['if-match'] && req.headers['if-match'] !== current?.etag)
      ) {
        res.writeHead(current ? 412 : 404).end();
        return;
      }
      // No await between condition comparison and replace. One server winner.
      const etag = write(key, body);
      if (await fault('after', req, res, key)) return;
      res.writeHead(200, { etag }).end();
    } catch (error) {
      violations.push(String(error));
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    cfg: {
      endpoint: `http://127.0.0.1:${server.address().port}`,
      bucket: 'fixture',
      accessKeyId: 'fixture-key',
      secretAccessKey: 'fixture-secret',
      region: 'auto',
    },
    requests,
    violations,
    faults,
    read,
    write,
    barrier(count) {
      let release;
      const promise = new Promise((resolve) => {
        release = resolve;
      });
      barrier = { count, arrived: 0, release, promise };
    },
    async close() {
      barrier?.release();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
