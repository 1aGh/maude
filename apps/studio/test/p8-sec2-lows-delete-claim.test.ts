// p8-sec2-lows I1 — a `DELETE /_api/canvas` that names a run claims the delete BEFORE the file leaves (so the
// watcher's delete joins the run). When the delete FAILS the claim must go again: a left-behind claim makes the
// PERSON's later delete of that canvas, during the run, a staged AI delete that the run's Discard/Undo undoes.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createActionStage } from '../sync/action-stage.ts';

function rig() {
  const root = mkdtempSync(join(tmpdir(), 'sec2-del-claim-'));
  const stage = createActionStage({
    designRoot: root,
    propose: async () => ({ status: 'accepted', actionId: 'a_1' }) as never,
    newTransactionId: () => 'tx_1',
    log: { log() {}, warn() {} },
  });
  stage.begin('run:R1', 'Clean up', { runId: 'R1', chatId: 'c1', claimOnly: true });
  return stage;
}

describe('I1 — a failed delete leaves no claim', () => {
  test('claimed and then released: the person’s later delete is NOT staged into the run', () => {
    const stage = rig();
    stage.claimDelete('R1', 'ui-home');
    stage.unclaimDelete('R1', 'ui-home');
    expect(stage.stagesDelete('ui-home', 'doc-ui-home')).toBe(false);
  });

  test('a claim that is kept still stages the delete (the success path is unchanged)', () => {
    const stage = rig();
    stage.claimDelete('R1', 'ui-home');
    expect(stage.stagesDelete('ui-home', 'doc-ui-home')).toBe(true);
  });

  test('releasing one slug leaves the run’s other claimed deletes alone', () => {
    const stage = rig();
    stage.claimDelete('R1', 'a');
    stage.claimDelete('R1', 'b');
    stage.unclaimDelete('R1', 'a');
    expect(stage.stagesDelete('a', 'doc-a')).toBe(false);
    expect(stage.stagesDelete('b', 'doc-b')).toBe(true);
  });
});

describe('I1 — http.ts releases the claim when the delete fails', () => {
  test('the DELETE handler unclaims on !result.ok (source pin)', async () => {
    const src = await Bun.file(join(import.meta.dir, '..', 'http.ts')).text();
    const at = src.indexOf('control?.claimAiDelete?.(mine.runId, repoRel)');
    expect(at).toBeGreaterThan(0);
    const after = src.slice(at, at + 1200);
    expect(after).toMatch(/release = \(\) => control\?\.unclaimAiDelete/);
    expect(after).toMatch(/if \(!result\.ok\) \{\s*release\?\.\(\)/);
  });
});
