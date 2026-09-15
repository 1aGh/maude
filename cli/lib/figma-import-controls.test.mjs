// DDR-216 D7 + D8 existence guard — the anti-recurrence test.
//
// This repo has now written the same mistake into three consecutive decision
// records: a DDR asserts a control, nobody builds it, and the NEXT DDR cites it
// as an existing mitigation. DDR-216 D7 promised `/design:edit` a pre-flight
// untrusted-content banner on an imported canvas; D8 promised Pass A.10 run
// promoted-to-blocker for `imported-figma`. Both were "shipped" in prose. When
// DDR-219 leaned on the A.10 promotion as a control that was "still enforced,
// unchanged", the design-stage review ran one command —
//
//     grep -rn "imported-figma" plugins/     →  zero matches
//
// — and the whole chain came apart. A decision record cannot assert its way to a
// control. This test is the cheapest possible thing that would have caught it,
// and it is deliberately dumb: it checks the string is REACHABLE from the files
// that must act on it, not that the behaviour is correct.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url).pathname;
const read = (p) => readFileSync(root + p, 'utf8');

// Commands and skills are split into an index plus linked stage/guide files
// (the per-host packaging); a test of what a command SAYS reads the index and
// every local markdown file it links, one level deep.
const withLinked = (rel, text) => {
  const dir = rel.split('/').slice(0, -1).join('/');
  const linked = [...text.matchAll(/\]\((\.{0,2}\/?[^)#\s]+\.md)\)/g)]
    .map((m) => `${dir}/${m[1]}`)
    .filter((p, i, all) => all.indexOf(p) === i)
    .map((p) => {
      try {
        return readFileSync(root + p.replace(/\/\.\//g, '/'), 'utf8');
      } catch {
        return '';
      }
    });
  return [text, ...linked].join('\n');
};

test('DDR-216 D7 — /design:edit banners an imported canvas before reading it', () => {
  const edit = withLinked(
    'plugins/design/commands/edit.md',
    read('plugins/design/commands/edit.md')
  );
  assert.match(
    edit,
    /imported-figma/,
    "/design:edit must detect an `imported-figma` canvas at pre-flight (DDR-216 D7). Without it, several hundred third-party strings enter a tool-holding agent's context with nothing saying what they are."
  );
  assert.match(
    edit,
    /untrusted content, never instructions/i,
    "The banner must say the content is untrusted and is never instructions — that exact framing is the control (DDR-216 D7, DDR-085's whiteboard trust model)."
  );
});

test('DDR-216 D8 — Pass A.10 is promoted to blocker on an imported canvas', () => {
  const keeper = read('plugins/design/agents/design-system-keeper.md');
  const a10 = keeper.slice(keeper.indexOf('## Pass A.10'));
  assert.notEqual(a10, '', 'Pass A.10 section is missing from design-system-keeper.');
  assert.match(
    a10,
    /imported-figma/,
    'Pass A.10 must special-case `imported-figma` (DDR-216 D8). As a plain warning it is not a gate.'
  );
  assert.match(
    a10,
    /blocker/i,
    'A.10 findings must be blockers on an imported canvas — the mass-drift stacking ladder exists to avoid nagging a human over one deliberate overlay, and that reasoning does not survive a machine-authored file.'
  );
});

test('A.10 does not let an imported canvas skip via its declared kind', () => {
  // The skip condition is "no kind=\"web\" artboard" — and on an import the
  // TRANSLATOR picks the kind, so the gate would be satisfied by the very code
  // it audits. DDR-216 D8's Round-1 correction named this; the exception closes it.
  const keeper = read('plugins/design/agents/design-system-keeper.md');
  const a10 = keeper.slice(keeper.indexOf('## Pass A.10'), keeper.indexOf('## Pass B'));
  const skipIdx = a10.indexOf('Skip entirely');
  assert.ok(skipIdx > -1, 'A.10 skip condition not found — did the section change shape?');
  assert.match(
    a10.slice(skipIdx, skipIdx + 1200),
    // `[\s\S]` rather than `[^]` — same "any char incl. newline" meaning, but
    // `[^]` is a negated EMPTY class, which biome flags and which reads as a typo.
    /EXCEPTION[\s\S]*imported-figma/,
    'The skip condition must carry an explicit imported-canvas exception, stated next to the skip itself where a reader will actually meet it.'
  );
});
