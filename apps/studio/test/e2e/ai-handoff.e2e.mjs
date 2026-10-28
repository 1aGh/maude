// P8 test round, group G3 - 09 ex-handoff-ready: a finished handoff run (browser E2E, node --test).
//
//   scripts/v2-test-lane.sh --wait 3600 -- node --test apps/studio/test/e2e/ai-handoff.e2e.mjs
//
// ⇧⌘H opens "Hand off to production"; Hand off starts ONE scoped AI run. The scripted fake agent (fixtures/hook-agent.mjs)
// runs the REAL `maude design handoff` verb - the same one /design:handoff runs - so the registry file the sheet is
// waiting for is the one the product writes; the sheet then draws "<name> is ready for developers" with ONE thing to
// copy, and Advanced holds the rest (the file on this Mac, the Claude Code command, the terminal verb).
//
// The cloud address half of the board's web command ("fetches Pricing from Studio site's cloud address", Any machine)
// needs a project on a cell: this lane's project is local, so the line the sheet can give is "This Mac only".

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { landingSource, startAiLane, until } from './ai-lane.mjs';

const LANDING = '.design/ui/Landing.tsx';

describe('09 ex-handoff-ready - Ready means one thing to copy; Advanced shows the rest', () => {
  let lane;
  let ui;
  before(async () => {
    lane = await startAiLane({ files: { [LANDING]: landingSource({ drawn: 3 }) } });
    ui = await lane.open('ui/Landing.tsx');
    await ui.ready(3);
  });
  after(async () => {
    await lane?.stop();
  });

  test('Hand off drafts, then the card says "Landing is ready for developers" with Copy command; Advanced lists the commands', async () => {
    await ui.page.keyboard.press('Shift+Meta+h');
    const sheet = ui.page.locator('[data-testid="export-sheet"][data-mode="handoff"]');
    await until(() => sheet.count(), 'the handoff sheet');
    assert.equal(await ui.tid('handoff-target-web').first().getAttribute('aria-checked'), 'true');
    lane.script([
      { op: 'tool', id: 'h1', title: 'Hand off Landing to the web', kind: 'execute' },
      { op: 'gate', name: 'handoff' },
      { op: 'maude', args: ['design', 'handoff', join(lane.project, LANDING), join(lane.project, '.design')] },
      { op: 'done', id: 'h1' },
      { op: 'say', text: 'Done - Landing is ready for developers.' },
    ]);
    await ui.tid('export-submit').first().click();
    // drafting: one scoped run, said in one line
    await until(() => ui.tid('handoff-drafting').count(), 'the drafting line');
    assert.equal(await sheet.getAttribute('data-phase'), 'drafting');
    await ui.shot('09-ex-handoff-ready.drafting');
    lane.gate('handoff');
    // ready: the file the run wrote is the registry item next to the canvas
    await until(() => ui.tid('handoff-ready').count(), 'the ready card', 40_000);
    assert.equal(await sheet.getAttribute('data-phase'), 'ready');
    const card = await ui.tid('handoff-ready').first().innerText();
    assert.match(card, /Landing is ready for developers/);
    assert.equal(await ui.tid('handoff-ready').first().getAttribute('data-kind'), 'web');
    assert.match(await ui.tid('handoff-ready-copy').first().innerText(), /^Copy command/);
    assert.equal(
      await ui.page.locator('[data-testid="handoff-ready"] .k-mono, [data-testid="handoff-ready"] pre').count(),
      0,
      'no file path or mono text before Advanced is opened'
    );
    await ui.shot('09-ex-handoff-ready.ready');
    await ui.tid('handoff-ready-advanced').first().click();
    const adv = await until(async () => {
      const t = await ui.tid('handoff-ready').first().innerText();
      return /Claude Code/.test(t) && /Terminal/.test(t) ? t : null;
    }, 'Advanced to list the commands');
    assert.match(adv, /This Mac only|Any machine/);
    assert.match(adv, /\/design:handoff/);
    assert.match(adv, /maude design handoff/);
    assert.ok(lane.read('.design/ui/Landing.registry.json').includes('"name"'), 'the registry item is on disk');
    await ui.shot('09-ex-handoff-ready.advanced');
  });
});
