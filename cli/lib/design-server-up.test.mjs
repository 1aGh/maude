import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const helper = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../apps/studio/bin/server-up.sh'
);

for (const mismatch of [null, 'pid', 'root']) {
  test(`server-up checks HTTP identity when process probing is unavailable: ${mismatch ?? 'matching'}`, async (t) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'maude-server-up-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, '.design'));
    const stubDir = join(root, 'maude-test');
    await mkdir(stubDir);
    const stub = join(stubDir, 'maude');
    await writeFile(stub, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    // No such local PID: kill -0 cannot prove liveness. The server is authoritative.
    const pid = 2147483647;
    const rootId = createHash('sha256').update(root).digest('hex').slice(0, 12);
    const server = createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          ok: true,
          app: 'design',
          pid: mismatch === 'pid' ? 42 : pid,
          rootId: mismatch === 'root' ? 'other-root' : rootId,
        })
      );
    });
    await new Promise((done) => server.listen(0, done));
    t.after(() => new Promise((done) => server.close(done)));
    const port = server.address().port;
    const state = join(root, '.design/_server.json');
    const original = JSON.stringify({ pid, port });
    await writeFile(state, original);
    const result = await new Promise((done, reject) => {
      const child = spawn('bash', [helper, '--root', root, '--timeout', '0'], {
        cwd: root,
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: root,
          MAUDE_DEV_SERVER_BIN: stub,
          MAUDE_FORCE_SOURCE: '0',
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('exit', (code) => done({ code, stdout, stderr }));
    });
    if (mismatch) {
      assert.equal(result.code, 1, result.stderr);
      assert.match(result.stderr, /stale _server/);
    } else {
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout.trim(), String(port));
      assert.equal(await readFile(state, 'utf8'), original);
    }
  });
}
