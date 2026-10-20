// S12.15 — the agent-journey harness's own self-test (no model, no studio, no network):
// `run.mjs --dry` builds each journey's good end state with Maude's own writers and grades it
// green, then plants each grader's fault and watches that grader go red; it also builds both
// lanes' plans (terminal + AI chat) and checks they share the AI chat's permission model.
// The live journeys (`run.mjs live`) are NOT part of any test run — they cost model usage (D14).
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUN = join(import.meta.dir, 'run.mjs');

test('run.mjs --dry: good runs grade green, every grader goes red on its planted fault', () => {
  const out = mkdtempSync(join(tmpdir(), 'agent-journeys-dry-'));
  try {
    const r = spawnSync('bun', [RUN, '--dry', '--out', out], {
      encoding: 'utf8',
      env: { ...process.env, NO_OPEN: '1', MAUDE_NO_AUTOBUILD: '1' },
      timeout: 240_000,
    });
    const res = JSON.parse(readFileSync(join(out, 'dry-results.json'), 'utf8'));
    const red = res.checks.filter((c: { pass: boolean }) => !c.pass);
    if (red.length)
      console.log(
        red.map((c: { name: string; why: string }) => `✗ ${c.name} — ${c.why}`).join('\n')
      );
    expect(red).toEqual([]);
    expect(r.status).toBe(0);
    // every journey of the wave is there, each with its faults
    const names = res.checks.map((c: { name: string }) => c.name);
    for (const j of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11']) {
      expect(names).toContain(`${j} good run grades green`);
      expect(names.some((n: string) => n.startsWith(`${j} fault `))).toBe(true);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 300_000);
