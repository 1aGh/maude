import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditSources } from './surface-source-audit.mjs';

test('source evidence distinguishes malformed TSX, valid stale source and a missing receiver', () => {
  const out = mkdtempSync(join(tmpdir(), 'maude-source-audit-'));
  try {
    const valid = 'export default () => <h1>new</h1>;';
    writeFileSync(join(out, 'step-expected.tsx'), valid);
    writeFileSync(join(out, 'step-hub.tsx'), valid.replace('new', 'old'));
    writeFileSync(join(out, 'step-native.tsx'), 'export default () => <h1>broken');
    const report = auditSources(out);
    assert.deepEqual(report.counts, {
      parsed: 3,
      syntaxFailures: 1,
      compared: 3,
      mismatched: 2,
      missing: 1,
    });
    assert.equal(report.syntax.find((r) => r.path.endsWith('step-hub.tsx')).status, 'pass');
    assert.equal(report.comparisons.find((r) => r.receiver === 'hub').status, 'mismatch');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
