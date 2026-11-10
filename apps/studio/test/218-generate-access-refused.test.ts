// #218 — "the chat doesn't see the Gemini key that is set in Settings". The chat's
// `maude design generate` reached the project server without the studio's own local access key (the
// helper could not find the app's registry: the chat's shell had assigned a prompt fragment to HOME),
// the server answered `{"ok":false,"error":"api-key-required"}`, and generate.sh printed it raw as
// "enqueue rejected" — which the AI, and the person, read as a missing Gemini key. The provider key
// was never involved. This pins the helper's wording: an access refusal names Maude's own check and
// says the provider key was not read; it is not the "no key" exit (3).
//
// The fake server stands in for the project server; the registry and the key dir point at a temp
// dir, so the real app's files are never read.

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, '..', 'bin', 'generate.sh');
let dir = '';
let server: ReturnType<typeof Bun.serve>;
const seen: string[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'maude-218-'));
  mkdirSync(join(dir, 'repo', '.design'), { recursive: true });
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      seen.push(`${req.method} ${new URL(req.url).pathname}`);
      return Response.json({ ok: false, error: 'api-key-required' }, { status: 401 });
    },
  });
  writeFileSync(
    join(dir, 'repo', '.design', '_server.json'),
    JSON.stringify({ pid: process.pid, port: server.port, url: `http://localhost:${server.port}` })
  );
});
afterAll(() => {
  server?.stop(true);
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('a refused studio access key is not reported as a missing provider key', async () => {
  const home = join(dir, 'home');
  mkdirSync(home, { recursive: true });
  const p = Bun.spawn(
    [
      'bash',
      SCRIPT,
      '--prompt',
      'a misty pine forest',
      '--root',
      join(dir, 'repo'),
      '--timeout',
      '5',
    ],
    {
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: home,
        XDG_STATE_HOME: join(dir, 'state'),
        MAUDE_APP_REGISTRY_FILE: join(dir, 'no-app', 'servers.json'),
        NODE_ENV: 'test',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()]);
  expect(seen).toContain('POST /_api/generate-jobs');
  expect(err).not.toContain('enqueue rejected');
  expect(err).toContain('This is not your provider key');
  // not exit 3 ("no key" / provider error): the person's key was never read
  expect(code).toBe(1);
});
