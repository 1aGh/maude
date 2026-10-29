// The post-rollout conversion report (`cells-deploy.yml` → scripts/collect-v2-convert.mjs).
//
// After the stable 2.0.0 fleet deploys, each cell converts its project on start and reports the
// counts on `/health` as `v2Convert` — the shape pinned at the producer by
// apps/hub/test/v2-convert-boot.test.mjs. The properties here:
//
//   - the counts of every cell add up into one fleet line in the cell's own report format
//   - a failed count is SURFACED (a warning, the summary) and never fails the deploy
//   - a cell still converting is waited for; one that never reports is named, not hidden
//   - the fleet line parses with the same parser as a cell's own log line

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { parseReportLine } from '../../apps/hub/src/v2-convert.mjs';

const execFileAsync = promisify(execFile);
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'collect-v2-convert.mjs');

const done = (c) => ({ ok: true, releaseVersion: '2.0.0', v2Convert: { state: 'done', ...c } });

/** One responder per cell; each serves its scripted sequence, the last entry repeating. */
async function withCells(sequences, fn) {
  const servers = [];
  try {
    const urls = [];
    for (const seq of sequences) {
      let n = 0;
      const server = createServer((_req, res) => {
        const body = seq[Math.min(n++, seq.length - 1)];
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      servers.push(server);
      urls.push(`http://127.0.0.1:${server.address().port}/health`);
    }
    return await fn(urls);
  } finally {
    for (const s of servers) s.close();
  }
}

async function run(urls, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'v2c-summary-'));
  const summary = join(dir, 'summary.md');
  try {
    const r = await execFileAsync(process.execPath, [SCRIPT, ...urls], {
      env: {
        ...process.env,
        V2_CONVERT_ATTEMPTS: '3',
        V2_CONVERT_SLEEP: '0',
        GITHUB_STEP_SUMMARY: summary,
        ...env,
      },
    }).catch((e) => e);
    let text = '';
    try {
      text = readFileSync(summary, 'utf8');
    } catch {}
    return { code: r.code ?? 0, stdout: r.stdout, summary: text };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('two cells, one failed: the fleet line says failed=1 converted=1, and the deploy is not failed', async () => {
  await withCells(
    [
      [done({ converted: 1, skipped: 0, failed: 0 })],
      [done({ converted: 0, skipped: 0, failed: 1 })],
    ],
    async (urls) => {
      const r = await run(urls);
      assert.equal(r.code, 0);
      const fleet = r.stdout.split('\n').find((l) => l.includes(' fleet '));
      assert.match(fleet, /cells=2 unreported=0 disabled=0$/);
      assert.deepEqual(parseReportLine(fleet), { converted: 1, skipped: 0, failed: 1 });
      assert.match(r.stdout, /::warning::1 cloud project\(s\) did not convert/);
      assert.match(r.summary, /### Maude 2 cloud conversion/);
      assert.match(r.summary, /fleet converted=1 skipped=0 failed=1/);
    }
  );
});

test('a cell still converting is waited for', async () => {
  await withCells(
    [
      [
        { ok: true, v2Convert: { state: 'running' } },
        done({ converted: 0, skipped: 1, failed: 0 }),
      ],
    ],
    async (urls) => {
      const r = await run(urls);
      assert.equal(r.code, 0);
      assert.match(r.stdout, /fleet converted=0 skipped=1 failed=0 cells=1 unreported=0/);
      assert.doesNotMatch(r.stdout, /::warning::/);
    }
  );
});

test('a cell that never reports (an image without the conversion, a gated rc) is named, not counted', async () => {
  await withCells(
    [
      [{ ok: true, releaseVersion: '1.10.0' }],
      [{ ok: true, v2Convert: { state: 'gated', reason: 'prerelease' } }],
    ],
    async (urls) => {
      const r = await run(urls);
      assert.equal(r.code, 0);
      assert.match(r.stdout, /unreported: no v2Convert on \/health/);
      assert.match(r.stdout, /gated \(prerelease\)/);
      assert.match(r.stdout, /fleet converted=0 skipped=0 failed=0 cells=0 unreported=2/);
      assert.match(r.stdout, /::warning::2 cell\(s\) did not report/);
    }
  );
});

test('a cell whose kill switch is off is named as disabled, neither counted nor unreported', async () => {
  await withCells(
    [[{ ok: true, v2Convert: { state: 'disabled', by: 'CELL_V2_CONVERT=0' } }]],
    async (urls) => {
      const r = await run(urls);
      assert.equal(r.code, 0);
      assert.match(r.stdout, /disabled \(CELL_V2_CONVERT=0\) — the kill switch was honoured/);
      assert.match(r.stdout, /fleet converted=0 skipped=0 failed=0 cells=0 unreported=0 disabled=1/);
      assert.doesNotMatch(r.stdout, /::warning::/);
    }
  );
});

test('no URL is a usage error', async () => {
  const r = await run([]);
  assert.equal(r.code, 2);
});
