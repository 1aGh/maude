// Local T8 service experiment; no production auth, multi-tenant deployment or adapter decision.

import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { own } from './paths.mjs';
export const limits = {
  bodyBytes: 4 * 1024 * 1024,
  requestBytes: 8 * 1024 * 1024 + 4096,
  concurrency: 2,
  timeoutMs: 2000,
};
const sha = (body) => createHash('sha256').update(body).digest('hex');
export async function startValidationService({
  workerScript = join(own, 'validator-child.mjs'),
  timeoutMs = limits.timeoutMs,
} = {}) {
  let active = 0;
  let closed = false;
  const children = new Set();
  const results = [];
  const sandbox = mkdtempSync(join(tmpdir(), 't8-validator-empty-cwd-'));
  const validatorHash = sha(readFileSync(join(own, 'dist/source-validator.mjs')));
  const server = createServer(async (req, res) => {
    const reply = (status, body) => {
      if (!res.writableEnded) {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      }
    };
    if (req.method === 'GET' && req.url === '/health') {
      reply(200, { ready: !closed, active, limits, validatorHash });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/validate') {
      reply(404, { valid: false, code: 'not-found' });
      return;
    }
    if (closed || active >= limits.concurrency) {
      reply(503, { valid: false, code: 'capacity', retryable: true });
      return;
    }
    active++;
    let child;
    let finished = false;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        active--;
      }
    };
    const cleanup = () => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        child.once('close', release);
        if (!child.killed) child.kill('SIGKILL');
      } else release();
    };
    const fail = (status, code) => {
      results.push({ status, code });
      cleanup();
      reply(status, { valid: false, code, retryable: status >= 500 });
    };
    const deadline = setTimeout(() => fail(504, 'validation-timeout'), timeoutMs);
    res.on('close', () => {
      if (!res.writableFinished) cleanup();
    });
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        if (finished) return;
        size += chunk.length;
        if (size > limits.requestBytes) {
          fail(413, 'request-too-large');
          return;
        }
        chunks.push(chunk);
      }
      if (finished) return;
      let proposal;
      try {
        proposal = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        fail(400, 'malformed');
        return;
      }
      if (
        !proposal ||
        typeof proposal !== 'object' ||
        Array.isArray(proposal) ||
        Object.keys(proposal).some((k) => !['file', 'body', 'sha256'].includes(k)) ||
        typeof proposal.body !== 'string' ||
        proposal.file !== 'canvas.tsx' ||
        typeof proposal.sha256 !== 'string'
      ) {
        fail(400, 'malformed');
        return;
      }
      if (Buffer.byteLength(proposal.body) > limits.bodyBytes) {
        fail(413, 'source-too-large');
        return;
      }
      if (proposal.sha256 !== sha(proposal.body)) {
        fail(422, 'hash-mismatch');
        return;
      }
      const received = performance.now();
      child = fork(workerScript, [], {
        cwd: sandbox,
        execArgv: ['--max-old-space-size=96'],
        env: {},
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      children.add(child);
      child.on('exit', () => children.delete(child));
      child.once('error', () => {
        if (!finished) fail(503, 'validator-unavailable');
      });
      child.once('exit', () => {
        if (!finished) fail(503, 'validator-unavailable');
      });
      child.once('message', (result) => {
        if (finished) return;
        if (
          !result ||
          typeof result.valid !== 'boolean' ||
          result.sha256 !== proposal.sha256 ||
          result.executed !== false
        ) {
          fail(503, 'invalid-validator-result');
          return;
        }
        const status = result.valid ? 200 : 422;
        results.push({
          status,
          validationMs: result.validationMs,
          roundtripMs: performance.now() - received,
        });
        cleanup();
        reply(status, { ...result, validatorHash });
      });
      child.send({ file: proposal.file, body: proposal.body }, (error) => {
        if (error && !finished) fail(503, 'validator-unavailable');
      });
    } catch {
      if (!finished) fail(503, 'validator-unavailable');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    results,
    sandbox,
    async close() {
      closed = true;
      for (const child of children) child.kill('SIGKILL');
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      rmSync(sandbox, { recursive: true, force: true });
    },
  };
}
