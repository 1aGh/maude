// The two closing statuses besides `verified` (Michal 2026-10-29, via the keeper):
// `soak` — cannot be driven locally, checked on the rc soak; `not-a-state` — the board draws
// something the product never reaches. Both need a written note; v2-done accepts them, and
// PR.md lists every `soak` row as the rc-soak checklist.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkComplete, prSoakDrift, soakChecklist, withSoakBlock } from '../v2-ledger.mjs';

const row = (over) => ({ id: 'artboard:05/es-x', kind: 'artboard', canvas: 'c.tsx', ...over });
const ledger = (rows) => ({ canvases: { 'c.tsx': { sha256: 'h' } }, rows });

test('soak and not-a-state with a note close a row of any kind', () => {
  const l = ledger([
    row({ status: 'soak', note: 'needs two real Macs on one cell' }),
    row({
      id: 'task:V2-8.7',
      kind: 'task',
      status: 'not-a-state',
      note: 'the board draws a state the hub never sends',
    }),
  ]);
  assert.deepEqual(checkComplete(l), []);
});

test('soak and not-a-state without a note stay incomplete', () => {
  const l = ledger([
    row({ status: 'soak' }),
    row({ id: 'artboard:05/es-y', status: 'not-a-state', note: '  ' }),
  ]);
  const errors = checkComplete(l);
  assert.equal(errors.length, 2);
  for (const e of errors) assert.match(e, /needs a note/);
});

test('the rc-soak checklist lists only soak rows, in ledger order, with their notes', () => {
  const l = ledger([
    row({ id: 'artboard:07/ve-footage', status: 'soak', note: 'local hub presence stub' }),
    row({ id: 'artboard:05/es-z', status: 'not-a-state', note: 'never reached' }),
    row({ id: 'artboard:10/an-vote', status: 'soak', note: 'minted cell sessions' }),
    row({ id: 'artboard:01/a', status: 'verified' }),
  ]);
  assert.equal(
    soakChecklist(l),
    '- [ ] `artboard:07/ve-footage` — local hub presence stub\n- [ ] `artboard:10/an-vote` — minted cell sessions\n'
  );
});

test('PR.md carries the checklist between its markers and drift is detected', () => {
  const l = ledger([row({ status: 'soak', note: 'n1' })]);
  const pr =
    '# PR\n\n## rc soak\n\n<!-- v2-ledger:soak:start -->\nstale\n<!-- v2-ledger:soak:end -->\n\ntail\n';
  assert.notEqual(prSoakDrift(pr, l), null);
  const fixed = withSoakBlock(pr, l);
  assert.equal(prSoakDrift(fixed, l), null);
  assert.match(fixed, /- \[ \] `artboard:05\/es-x` — n1/);
  assert.match(fixed, /tail\n$/);
  assert.match(prSoakDrift('# PR without markers\n', l) ?? '', /markers/);
});
