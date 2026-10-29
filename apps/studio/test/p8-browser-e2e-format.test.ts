// The browser e2e harnesses build throwaway projects. The 2A full format gate opens a format-1 project (no
// `formatVersion` in .design/config.json) view only, so a harness that writes `{ name }` gets writes 403/409 and an
// agent that answers "read-only — nothing written": every scenario fails for a reason that has nothing to do with it.
// Pin: every project the browser e2e rigs build is one this build may edit. E2E_LEGACY=1 deliberately models a 1.x
// project (a pre-v2 baseline studio), so it keeps the bare config.
import { afterAll, expect, test } from 'bun:test';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FORMAT_GATE_OPTS, formatGate } from '../format.ts';
// @ts-expect-error plain .mjs harness
import { makeProject } from './e2e/harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const E2E = join(HERE, 'e2e');
const made: string[] = [];
afterAll(() => {
  for (const r of made) rmSync(r, { recursive: true, force: true });
});

const gateOf = (root: string) => {
  const cfg = JSON.parse(readFileSync(join(root, '.design', 'config.json'), 'utf8'));
  return {
    formatVersion: cfg.formatVersion,
    gate: formatGate({ cfg, paths: { designRoot: join(root, '.design') } }, FORMAT_GATE_OPTS),
  };
};

test('makeProject() builds a project this build may edit (formatVersion 2, no format gate)', () => {
  const root = makeProject({ board: [] }) as string;
  made.push(root);
  expect(gateOf(root)).toEqual({ formatVersion: 2, gate: null });
});

test('makeProject() with E2E_LEGACY=1 stays a format-1 project (the pre-v2 baseline)', () => {
  const prev = process.env.E2E_LEGACY;
  process.env.E2E_LEGACY = '1';
  try {
    const root = makeProject({ legacySvg: '<svg xmlns="http://www.w3.org/2000/svg"/>' }) as string;
    made.push(root);
    expect(gateOf(root).formatVersion).toBeUndefined();
  } finally {
    if (prev === undefined) Reflect.deleteProperty(process.env, 'E2E_LEGACY');
    else process.env.E2E_LEGACY = prev;
  }
});

// The scripts that build their own project (not through makeProject) write the config inline. Each must carry the
// format (or take it from the harness helper) — a bare `JSON.stringify({ name })` is the bug.
test('every browser e2e script that writes a project config states its format', () => {
  const bare: string[] = [];
  for (const f of readdirSync(E2E).filter((n) => n.endsWith('.mjs'))) {
    const src = readFileSync(join(E2E, f), 'utf8');
    for (const m of src.matchAll(/writeFileSync\(\s*join\([^)]*'config\.json'\)\s*,\s*([^;]*);/g)) {
      if (!/formatVersion|e2eProjectConfig/.test(m[1])) bare.push(`${f}: ${m[1].slice(0, 80)}`);
    }
  }
  expect(bare).toEqual([]);
});

// The dev rigs under scripts/dev that serve a project they built (a fresh machine linked to a hub) go through
// `v2Config`. A hub workspace dir (no linkedHub) is not served by a studio and stays as it is; journal-e2e and
// cell-materialize-e2e write configs only for a ledger / a hub materialise, never a studio.
test('the dev sync rigs stamp the format on every studio project they build', () => {
  const dev = join(HERE, '..', '..', '..', 'scripts', 'dev');
  const bare: string[] = [];
  for (const f of ['sync-e2e.mjs', 't32-scale.mjs']) {
    const src = readFileSync(join(dev, f), 'utf8');
    for (const m of src.matchAll(/writeFileSync\(\s*join\([^)]*'config\.json'\),/g)) {
      const rest = src.slice((m.index ?? 0) + m[0].length);
      const body = rest.slice(0, rest.indexOf(');'));
      if (/linkedHub/.test(body) && !/v2Config\(/.test(body)) bare.push(`${f}: ${body.slice(0, 70)}`);
    }
  }
  expect(bare).toEqual([]);
  expect(readFileSync(join(dev, 'v2-config.mjs'), 'utf8')).toContain('formatVersion');
});
