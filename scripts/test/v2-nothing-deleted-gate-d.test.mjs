// V2-4.gate-d (Phase 4 gate, apps/studio/client/v2/contracts/V2-4-gate-nothing-deleted.md): the pieces that
// take the audit to 100 % — named render tests as proof for transient hooks, prose label sets as selectors,
// shells that draw a hook, the ACP stub, and per-shell opener scopes. No browser.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ACP_SCRIPTS, acpOpenFrames, acpReplies } from '../v2-manifest/acp-stub.mjs';
import { OPENERS, resolveOpener } from '../v2-manifest/openers.mjs';
import {
  HOOK_PROOFS,
  hookMatcher,
  hookProbes,
  LOCAL_PROBES,
  proofHolds,
  summarize,
} from '../v2-manifest/reach-rules.mjs';

const opener = (id) => OPENERS.find((o) => o.id === id);
const ev0 = (testids, css = []) => ({ ok: true, testids, tours: [], css, palette: {} });
const target = (hook, need) => ({ id: `testid:${hook}`, need, hook, action: null });
const summ = (evidence, targets, proofs) =>
  summarize({
    evidence,
    subjects: { rows: [], targets },
    hooksByName: new Map([['.dc-x', { hook: '.dc-x', kind: 'selector' }]]),
    proofs,
    taken: 't',
    bundle: 't',
  });

test('proofHolds: the test file, its title and the hook must all still be there', () => {
  const proof = { test: 'a.test.tsx', name: 'renders it', needles: ['dc-x'] };
  const read = (text) => (p) => (p === 'a.test.tsx' ? text : null);
  assert.equal(proofHolds('.dc-x', proof, read("test('renders it', () => dc-x)")), true);
  assert.equal(proofHolds('.dc-x', proof, read("test('renders it', () => nothing)")), false);
  assert.equal(proofHolds('.dc-x', proof, read("test('other', () => dc-x)")), false);
  assert.equal(
    proofHolds('.dc-x', proof, () => null),
    false
  );
  assert.equal(proofHolds('.dc-x', undefined, read('x')), false);
  // without needles the hook text itself is the needle
  assert.equal(proofHolds('dc-x', { test: 'a.test.tsx', name: 'n' }, read('n dc-x')), true);
});

test('a hook with a holding proof is reached where its container is on screen, and only there', () => {
  const proofs = new Map([
    ['.dc-x', { container: 'canvas-frame', test: 'a.test.tsx', name: 'renders it', ok: true }],
  ]);
  const doc = summ(
    { desktop: { o: ev0(['canvas-frame']) }, browser: { o: ev0([]) } },
    [target('.dc-x', ['desktop', 'browser'])],
    proofs
  );
  assert.match(doc.targets['testid:.dc-x'], /not reached in browser$/);
  assert.match(
    doc.perShell.desktop.targets['testid:.dc-x'],
    /^ok: proof\(a\.test\.tsx › renders it\)$/
  );
  // the probe seeing the hook itself wins over the proof
  const seen = summ(
    { desktop: { o: ev0(['canvas-frame'], ['.dc-x']) } },
    [target('.dc-x', ['desktop'])],
    proofs
  );
  assert.equal(seen.targets['testid:.dc-x'], true);
  assert.equal(seen.perShell.desktop.targets['testid:.dc-x'], 'ok: o');
});

test('a proof whose test no longer holds credits nothing', () => {
  const doc = summ(
    { desktop: { o: ev0(['canvas-frame']) } },
    [target('.dc-x', ['desktop'])],
    new Map([['.dc-x', { container: 'canvas-frame', test: 'a', name: 'n', ok: false }]])
  );
  assert.match(doc.targets['testid:.dc-x'], /not reached in desktop$/);
});

test('every HOOK_PROOFS entry names a real test that still says what the table says', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const read = (rel) =>
    existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null;
  assert.ok(Object.keys(HOOK_PROOFS).length > 0);
  for (const [hook, proof] of Object.entries(HOOK_PROOFS))
    assert.equal(proofHolds(hook, proof, read), true, `${hook}: ${proof.test} › ${proof.name}`);
});

test('prose label sets and selector-plus-words hooks resolve to selectors a page can answer', () => {
  const css = (hook) => hookMatcher({ hook, kind: 'selector' }).css;
  assert.deepEqual(css('Photo tab field labels'), [
    '[aria-label="Brightness"]',
    '[aria-label="Contrast"]',
  ]);
  assert.deepEqual(css('[aria-expanded] on tree rows'), ['[role="tree"] [aria-expanded]']);
  assert.deepEqual(css('.btn--danger (permission prompt)'), ['.chat-perm .btn--danger']);
  assert.deepEqual(css('menuitem by name (row menu)'), ['.st-dropdown [role="menuitem"]']);
});

test('the Changes panel, deep links and the embed shell are required only where they are drawn', () => {
  const seen = new Map();
  assert.deepEqual(hookProbes('git-save-all', seen), ['desktop']);
  assert.deepEqual(hookProbes('pull', seen), ['desktop']);
  assert.deepEqual(hookProbes('cloud-deeplink-dialog', seen), ['desktop']);
  assert.deepEqual(hookProbes('file-deeplink-open', seen), ['desktop']);
  assert.deepEqual(hookProbes('embed-view', seen), ['embed']);
  assert.deepEqual(hookProbes('git-history-retry', seen), LOCAL_PROBES);
});

test('a state names its ACP script, the routes that make the chat available, and silenced server pushes', () => {
  const w = resolveOpener(opener('acp-turn'));
  assert.equal(w.acp, 'chat');
  assert.equal(w.routes['/_api/acp/status'].available, true);
  assert.equal(resolveOpener(opener('acp-missing')).acp, null);
  assert.equal(resolveOpener(opener('acp-missing')).routes['/_api/acp/status'].available, false);
  // a state that stubs the repo status also drops the real server's own `git-status` push
  assert.deepEqual(resolveOpener(opener('history-dirty')).dropFrames, ['git-status']);
  assert.deepEqual(resolveOpener(opener('shell')).dropFrames, []);
});

test('every ACP script answers the frames the client speaks, and $chat is filled from the client', () => {
  for (const name of Object.keys(ACP_SCRIPTS)) {
    assert.equal(acpOpenFrames(ACP_SCRIPTS, name)[0].t, 'ready', name);
    assert.deepEqual(acpReplies(ACP_SCRIPTS, name, { t: 'attach', chat: 'c9' }), [
      { t: 'attached', chat: 'c9', running: false },
    ]);
    assert.equal(
      JSON.stringify(acpReplies(ACP_SCRIPTS, name, { t: 'prompt' }, 'c9')).includes('$chat'),
      false
    );
  }
  const turn = acpReplies(ACP_SCRIPTS, 'chat', { t: 'prompt', text: 'go' }, 'c9');
  const perms = turn.filter((f) => f.t === 'permission-request');
  assert.equal(perms.length, 2, 'two waiting requests: the first shows "+1 more waiting"');
  assert.ok(perms.every((f) => f.chat === 'c9'));
  assert.equal(perms[0].scope.outOfProjectWrite, true);
  assert.equal(
    turn.some((f) => f.t === 'turn-end'),
    false,
    'the turn stays open: Stop and the cards stay'
  );
  assert.equal(acpReplies(ACP_SCRIPTS, 'chat-done', { t: 'prompt' }).at(-1).t, 'turn-end');
  assert.throws(() => acpReplies(ACP_SCRIPTS, 'nope', { t: 'prompt' }), /no script/);
});

test('openers are scoped to the shells that draw their surface; nothing else loses coverage', () => {
  assert.deepEqual(opener('acp-turn').probes, ['desktop']);
  assert.deepEqual(opener('annot-select').probes, ['desktop', 'browser']);
  assert.equal(opener('menu').probes, undefined);
  assert.equal(opener('history-dirty').probes, undefined);
  assert.equal(new Set(OPENERS.map((o) => o.id)).size, OPENERS.length, 'opener ids are unique');
});
