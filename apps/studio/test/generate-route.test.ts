// generate-route.test.ts — the privileged /_api/generate* routes on the MAIN
// origin. Boots a real server (no CANVAS_ORIGIN_SPLIT; loopback host). Proves:
// validation rejects bad bodies; a key POST reports {configured} and GET never
// echoes the value; the provider catalogue serializes with a presence flag; and
// a generate POST enqueues a job (202 {jobId}). The job runs on the env-gated
// stub provider (MAUDE_GENERATE_STUB=1, generation/adapters/stub.ts) — no test
// reaches a real provider (S8.16b). Points MAUDE_GEN_KEYS_PATH at the sandbox
// so the user's real key store is never touched.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

let keysDir: string;
beforeEach(() => {
  keysDir = mkdtempSync(join(tmpdir(), 'maude-genroute-'));
});
afterEach(() => rmSync(keysDir, { recursive: true, force: true }));

describe('/_api/generate* main-origin routes', () => {
  test('providers catalogue, key custody (no echo), validation, and enqueue', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port, {
      MAUDE_GEN_KEYS_PATH: join(keysDir, 'keys.json'),
      MAUDE_GENERATE_STUB: '1',
    });
    const base = `http://localhost:${port}`;
    try {
      // Provider catalogue — gemini present, not yet configured.
      const provRes = await fetch(`${base}/_api/generate/providers`);
      expect(provRes.status).toBe(200);
      const provJson = (await provRes.json()) as {
        providers: Array<{ id: string; configured: boolean }>;
      };
      const gemini = provJson.providers.find((p) => p.id === 'gemini');
      expect(gemini).toBeTruthy();
      expect(gemini?.configured).toBe(false);

      // Set a key → {configured:true}; the value is NEVER echoed back.
      const setRes = await fetch(`${base}/_api/generate/keys`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ provider: 'gemini', key: 'AIza-super-secret' }),
      });
      expect(setRes.status).toBe(200);
      const setJson = (await setRes.json()) as Record<string, unknown>;
      expect(setJson.configured).toBe(true);
      expect(JSON.stringify(setJson)).not.toContain('super-secret');

      // GET key status → presence only, no value.
      const statusRes = await fetch(`${base}/_api/generate/keys`);
      const statusJson = (await statusRes.json()) as { configured: string[] };
      expect(statusJson.configured).toContain('gemini');
      expect(JSON.stringify(statusJson)).not.toContain('super-secret');

      // Validation — a malformed generate body 400s before any provider call.
      const badRes = await fetch(`${base}/_api/generate-jobs`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ modality: 'hologram', provider: '../etc' }),
      });
      expect(badRes.status).toBe(400);

      // Unknown provider 400s.
      const unkRes = await fetch(`${base}/_api/generate-jobs`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ modality: 'image', provider: 'nope', prompt: 'x' }),
      });
      expect(unkRes.status).toBe(400);

      // A well-formed request enqueues → 202 { jobId }, on the stub provider: no egress, no real key used.
      const okRes = await fetch(`${base}/_api/generate-jobs`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ modality: 'image', provider: 'stub', prompt: 'a red circle' }),
      });
      expect(okRes.status).toBe(202);
      const okJson = (await okRes.json()) as { jobId: string };
      expect(okJson.jobId).toMatch(/^gen_/);

      // The job shows up in the list.
      const listRes = await fetch(`${base}/_api/generate-jobs`);
      const listJson = (await listRes.json()) as {
        jobs: Array<{ id: string; provider: string }>;
      };
      const job = listJson.jobs.find((j) => j.id === okJson.jobId);
      expect(job?.provider).toBe('stub');

      // Remove the key.
      const delRes = await fetch(`${base}/_api/generate/keys`, {
        method: 'DELETE',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ provider: 'gemini' }),
      });
      expect(delRes.status).toBe(200);
      const afterDel = (await (await fetch(`${base}/_api/generate/keys`)).json()) as {
        configured: string[];
      };
      expect(afterDel.configured).not.toContain('gemini');
    } finally {
      await killProc(proc);
    }
  });
});
