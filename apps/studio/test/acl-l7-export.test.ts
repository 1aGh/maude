// S9.10 — V2-1.16 L7 canvas-only rows (S8 owns the everyone-fixes: job ownership, RAW_EXCLUDES).
//
// The export target comes from client hints (`options.canvasFile`, `selection.file`) or the
// session's `_active.json`, never a top-level `file` — so the gate resolves the job's targets
// the way the exporter will. As A-only: exporting A is accepted; B (or a canvas that does not
// exist) is `not-in-scope` with the same body; a project export (`project-raw`) is refused;
// an observer grant on A holds no export.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  A,
  A_ONLY,
  B,
  bootCanaryCell,
  type Cell,
  canaries,
  canvasOnly,
  send,
} from './_acl-canvas-fixture.ts';

let cell: Cell;
beforeAll(async () => {
  cell = await bootCanaryCell();
}, 60000);
afterAll(async () => {
  await cell?.stop();
});

const job = (headers: Record<string, string>, body: Record<string, unknown>) =>
  send(cell, 'POST', '/_api/export-jobs', headers, body);
const NOT_IN_SCOPE = '{"error":"not-in-scope","reason":"not-in-scope"}';

describe('L7 — export targets for a canvas-only session', () => {
  // `svg` + `canvas-whole` is an incoherent pair the HANDLER refuses with 400: reaching that
  // 400 proves the gate let A through, without starting a render.
  const PAST_THE_GATE = { format: 'svg', scope: 'canvas-whole' };

  test('A by hint: past the gate (the handler answers)', async () => {
    const r = await job(A_ONLY, { ...PAST_THE_GATE, options: { canvasFile: A } });
    expect(r.status).toBe(400);
    expect(r.text).toContain('SVG');
  });

  test('B by hint, a missing canvas: the same not-in-scope', async () => {
    const byHint = await job(A_ONLY, { ...PAST_THE_GATE, options: { canvasFile: B } });
    const missing = await job(A_ONLY, {
      ...PAST_THE_GATE,
      options: { canvasFile: '.design/ui/missing.tsx' },
    });
    for (const r of [byHint, missing]) {
      expect(r.status).toBe(403);
      expect(r.text).toBe(NOT_IN_SCOPE);
    }
    expect(canaries(byHint.text)).toEqual([]);
  });

  test('B by selection (canvas pinned to A): the selection is ignored — the job is A’s', async () => {
    // gate-b-c4e — a selection naming another canvas than the export's is not this export's
    // (exporters/scope.ts), so the target is A: past the gate. `html` + `selection` is an
    // incoherent pair the HANDLER refuses, so no render starts.
    const bySelection = await job(A_ONLY, {
      format: 'html',
      scope: 'selection',
      options: { canvasFile: A, selection: { selector: '[data-dc-screen]', file: B } },
    });
    expect(bySelection.status).toBe(400);
    expect(canaries(bySelection.text)).toEqual([]);
  });

  test('project-raw is project-class: not-in-scope', async () => {
    const r = await job(A_ONLY, { format: 'zip', scope: 'project-raw', options: {} });
    expect(r.status).toBe(403);
    expect(r.text).toBe(NOT_IN_SCOPE);
  });

  test('an observer grant on A holds no export: read-only', async () => {
    const r = await job(canvasOnly('observer'), { ...PAST_THE_GATE, options: { canvasFile: A } });
    expect(r.status).toBe(403);
    expect((r.json as { error?: string }).error).toBe('read-only');
  });
});
