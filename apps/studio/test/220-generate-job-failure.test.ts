// 220-generate-job-failure.test.ts — #220: "the app crashes when the AI makes changes".
//
// The AI chat makes pictures through `maude design generate` → POST /_api/generate-jobs, which
// answers 202 at once and runs the job in the background. A job that FAILS (no key, the provider
// refused the prompt, the account is out of credit) used to reject a promise nobody listened to;
// the server registers no `unhandledRejection` handler, so Bun ended the whole project server with
// exit 1, the desktop shell respawned it, and the next ask crashed it again (2.1.1: seven
// "terminated (code=Some(1))" in 40 minutes, each right after a provider error).
//
// This boots a real server and asks for a picture from a provider that has no key in the sandbox —
// a local failure, no network. The server must stay up and the job must read `failed`.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

let keysDir: string;
beforeEach(() => {
  keysDir = mkdtempSync(join(tmpdir(), 'maude-gen220-'));
});
afterEach(() => rmSync(keysDir, { recursive: true, force: true }));

describe('#220 — a failed generation job never ends the server', () => {
  test('POST a job that fails → the job reads failed and the server still answers', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port, {
      MAUDE_GEN_KEYS_PATH: join(keysDir, 'keys.json'),
    });
    const base = `http://localhost:${port}`;
    try {
      const res = await fetch(`${base}/_api/generate-jobs`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ modality: 'image', provider: 'gemini', prompt: 'a red circle' }),
      });
      expect(res.status).toBe(202);
      const { jobId } = (await res.json()) as { jobId: string };

      // Wait for the job to settle (it fails fast: no key), then a little longer, so a rejection
      // nobody handles has had every chance to end the process.
      let status: string | undefined;
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const list = (await (await fetch(`${base}/_api/generate-jobs`)).json()) as {
          jobs: Array<{ id: string; status: string }>;
        };
        status = list.jobs.find((j) => j.id === jobId)?.status;
        if (status === 'failed' || status === 'done') break;
        await Bun.sleep(50);
      }
      expect(status).toBe('failed');
      await Bun.sleep(500);

      expect(proc.exitCode).toBeNull();
      const health = await fetch(`${base}/_health`);
      expect(health.status).toBe(200);
    } finally {
      await killProc(proc);
    }
  });
});
