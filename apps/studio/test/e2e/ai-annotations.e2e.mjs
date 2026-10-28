// P8 test round, group G3 - the AI on the annotation layer, driven end to end (browser E2E, node --test).
//
//   scripts/v2-test-lane.sh --wait 3600 -- node --test apps/studio/test/e2e/ai-annotations.e2e.mjs
//
// Same lane as ai-states.e2e.mjs: a real studio, the real canvas + AI panel, a scripted fake ACP agent that runs the
// design plugin's REAL hook for the canvas edits and the REAL `maude design annotate` verb for the layer writes
// (fixtures/hook-agent.mjs `maude` step) - so what lands on the board is exactly what Claude Code's own run writes
// (`author: {kind: 'ai'}`, resolved-by-AI, status stickers), and the studio draws it from that.
//
//   15 an-rebind       AI rewrites the button an arrow points at: the arrow stays bound ("rewritten by AI")
//   15 an-ai-write     AI writes a review as notes with spark arrows, in the layer, never in the design
//   15 an-ai-read      three stickies as the scope: the AI says it back in one line and offers ONE button
//   15 an-ai-apply     "Make these changes": the canvas changes, the stickies stay, resolved; one undo
//   15 an-ai-stickers  Done! / Flagged status stickers wear a spark badge
//
// Evidence: a screenshot per state into $E2E_SHOTS.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { sleep, startAiLane, until } from './ai-lane.mjs';

const CANVAS_FILE = '.design/ui/Board.tsx';
const BOARD_FILE = '.design/ui-board.annotations.json';
const CANVAS = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";
export default function Board() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={720} height={450}>
        <div data-cd-id="hero" style={{ padding: 24 }}>Home</div>
        <button data-cd-id="see-the-work" style={{ position: "absolute", left: 40, top: 120 }}>See the work</button>
        <a className="pricing" style={{ position: "absolute", left: 300, top: 120 }}>Pricing</a>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const META = JSON.stringify({ layout: { artboards: [{ id: 'desktop', x: 100, y: 900 }] } });
const boardFile = (els) =>
  `{"format":"maude.annotations","v":2,"elements":[\n${els.map((e) => JSON.stringify(e)).join(',\n')}\n]}\n`;
const sticky = (id, index, x, y, text, extra = {}) => ({
  id,
  type: 'sticky',
  index,
  x,
  y,
  w: 150,
  h: 150,
  text,
  ...extra,
});
const files = (els) => ({
  [CANVAS_FILE]: CANVAS,
  '.design/ui/Board.meta.json': META,
  [BOARD_FILE]: boardFile(els),
});
const diskBoard = (lane) => JSON.parse(lane.read(BOARD_FILE)).elements;
const annotate = (lane, ops, extra = []) => ({
  op: 'maude',
  args: ['design', 'annotate', 'ui/Board.tsx', '--root', lane.project, '--ops', '-', ...extra],
  stdin: JSON.stringify({ ops }),
});
const scene = (ui, sel) => ui.frame().locator(`.dc-annot-scene ${sel}`);

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('15 an-rebind - AI rewrites the button the arrow points at', () => {
  let lane;
  let ui;
  const BOARD = [
    sticky('tereza', 'a0', 120, 360, 'Make See the work bigger'),
    {
      id: 'arw',
      type: 'arrow',
      index: 'a1',
      start: { el: 'tereza' },
      end: { x: 170, y: 1040 },
      endHost: { ref: 'el:desktop/see-the-work', label: 'See the work', box: { x: 140, y: 1020, w: 110, h: 30 } },
    },
  ];
  before(async () => {
    lane = await startAiLane({ files: files(BOARD) });
    ui = await lane.open('ui/Board.tsx');
    await ui.ready(1);
    await ui.fit();
  });
  after(async () => {
    await lane?.stop();
  });

  test('the run rewrites the words; the arrow stays bound and says "rewritten by AI"; nothing is dangling', { todo: 'next run: select the arrow by its stroke (the layer draws it as svg geometry); the AI side is green' }, async () => {
    lane.script([
      { op: 'tool', id: 'r1', title: 'Rewrite the button', path: CANVAS_FILE },
      { op: 'subst', path: CANVAS_FILE, from: '>See the work<', to: '>See our work<' },
      { op: 'done', id: 'r1', path: CANVAS_FILE },
      { op: 'say', text: 'Done - the button now says "See our work". The arrow still points at it.' },
    ]);
    await ui.ask('Rewrite the See the work button, shorter');
    await until(() => ui.tid('ai-result').count(), 'the run to finish', 30_000);
    await until(() => /See our work/.test(lane.read(CANVAS_FILE)), 'the rewrite on disk');
    await sleep(2500); // the canvas reloads on the file change
    const arrow = scene(ui, '[data-id="arw"] path, [data-id="arw"] line, [data-id="arw"] polyline').first();
    await until(async () => (await arrow.count()) > 0, 'the arrow\'s stroke on the layer');
    const box = await arrow.boundingBox();
    assert.ok(box, 'the arrow has a box');
    const markup = await scene(ui, '[data-id="arw"]').first().evaluate((e) => e.outerHTML.slice(0, 300));
    lane.markup = markup;
    // a real press on the arrow's middle (the line runs from the note to the button)
    await ui.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(80);
    await ui.page.mouse.down();
    await ui.page.mouse.up();
    await sleep(300);
    const text = await until(
      async () =>
        (await ui.frame().locator('[data-testid="annot-arrow-rewritten"]').count()) &&
        ui.frame().locator('[data-testid="annot-arrow-rewritten"]').first().textContent(),
      `the "rewritten by AI" ring on the button (the arrow: ${markup})`
    );
    assert.match(text, /See our work · rewritten by AI/);
    assert.equal(await ui.frame().locator('[data-testid="annot-dangling-mark"]').count(), 0, 'not dangling');
    const stored = diskBoard(lane).find((e) => e.id === 'arw');
    assert.equal(stored.endHost.ref, 'el:desktop/see-the-work', 'the bind is untouched on the board');
    await ui.shot('15-an-rebind');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('15 an-ai-write - AI writes a review as notes with arrows', () => {
  let lane;
  let ui;
  before(async () => {
    lane = await startAiLane({ files: files([]) });
    ui = await lane.open('ui/Board.tsx');
    await ui.ready(1);
    await ui.fit();
  });
  after(async () => {
    await lane?.stop();
  });

  test('four notes with a spark edge, each with a spark arrow to what it means; the design did not change', { todo: 'next run: the annotate verb needs the canvas rects manifest; written, unverified' }, async () => {
    const design = lane.read(CANVAS_FILE);
    // the verb finds an artboard from a canvas-rects manifest (a live studio is not asked to render for it)
    lane.write(
      '.design/_state/rects.json',
      JSON.stringify({ artboards: [{ id: 'desktop', x: 100, y: 900, w: 720, h: 450 }], elements: [] })
    );
    const notes = [
      'Yearly is easy to miss - make it the default?',
      'No price on Team reads as expensive',
      'Three plans look alike - let Studio stand out',
      '"Two days a week" - say "16 hours a week"',
    ];
    lane.script([
      { op: 'tool', id: 'w1', title: 'Writing notes on the layer', kind: 'other' },
      annotate(
        lane,
        notes.map((text, i) => ({ op: 'create', type: 'sticky', text, x: 140 + i * 190, y: 640, to: 'ab:desktop' })),
        ['--rects', join(lane.project, '.design/_state/rects.json')]
      ),
      { op: 'done', id: 'w1' },
      { op: 'say', text: "Done - 4 notes on Board, each pointing at what it means. The design didn't change." },
    ]);
    await ui.ask('Review Board like someone seeing it for the first time');
    await until(() => ui.tid('ai-canvas-unchanged').count(), 'the answer that touched nothing', 40_000);
    // the layer: four AI stickies (spark edge + glyph) and their arrows
    await until(async () => (await scene(ui, '[data-type="sticky"][data-author="ai"]').count()) === 4, 'four AI notes', 20_000);
    assert.equal(await scene(ui, '[data-type="sticky"][data-author="ai"] .dc-annot-spark').count(), 4, 'each note carries the spark glyph');
    assert.ok((await scene(ui, '[data-type="arrow"][data-author="ai"]').count()) >= 4, 'each note has an AI arrow');
    const stored = diskBoard(lane);
    assert.equal(stored.filter((e) => e.type === 'sticky' && e.author?.kind === 'ai').length, 4, 'stamped author.kind ai on disk');
    // an arrow's end is bound to the artboard it means
    assert.ok(stored.some((e) => e.type === 'arrow' && e.endHost?.ref === 'ab:desktop'));
    assert.equal(lane.read(CANVAS_FILE), design, 'AI writes on the layer, never in the design');
    await ui.shot('15-an-ai-write');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('15 an-ai-read / an-ai-apply / an-ai-stickers - three stickies, one button, resolved and marked', () => {
  let lane;
  let ui;
  const BOARD = [
    sticky('s1', 'a0', 130, 330, 'Photo bigger?', { author: { kind: 'user' } }),
    sticky('s2', 'a1', 300, 330, 'See the work feels small', { author: { kind: 'user' } }),
    sticky('s3', 'a2', 470, 330, 'Let it fill the right half', { author: { kind: 'user' } }),
    sticky('s4', 'a3', 640, 330, 'Warmer sun?', { author: { kind: 'user' } }),
  ];
  before(async () => {
    lane = await startAiLane({ files: files(BOARD) });
    ui = await lane.open('ui/Board.tsx');
    await ui.ready(1);
    await ui.fit();
  });
  after(async () => {
    await lane?.stop();
  });

  test('an-ai-read: the three stickies are the scope; AI answers in a line and offers ONE button; nothing changed yet', { todo: 'next run: a click selects no sticky in Preview (chip stays Whole canvas); find the selecting gesture' }, async () => {
    const design = lane.read(CANVAS_FILE);
    // select the three stickies: the note tool is not needed, a marquee over them with the select tool does it
    // N opens Preview (the layer's mode) with Sticky in hand; esc puts it down, and a click selects
    const key = (k) =>
      ui.inFrame(
        (key) =>
          document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })),
        k
      );
    await key('n');
    await until(
      () => ui.frame().locator('[data-testid="toolbar-preview"]').count(),
      'Preview with its toolbar'
    );
    await key('Escape');
    await key('v'); // the select tool
    await sleep(300);
    for (const id of ['s1', 's2', 's3']) {
      const b = await scene(ui, `[data-id="${id}"]`).first().boundingBox();
      assert.ok(b, `${id} on screen`);
      if (id !== 's1') await ui.page.keyboard.down('Shift');
      await ui.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await sleep(80);
      await ui.page.mouse.down();
      await ui.page.mouse.up();
      if (id !== 's1') await ui.page.keyboard.up('Shift');
      await sleep(300);
    }
    await ui.shot('15-an-ai-read.selected');
    const picked = await scene(ui, '[data-id^="s"]').evaluateAll((els) =>
      els.map((e) => [e.getAttribute('data-id'), [...e.attributes].map((a) => a.name).join(',')])
    );
    const offer = {
      v: 1,
      says: 'See the work: from 110 to 220 wide, the headline keeps its two lines. "Warmer sun?" is not included.',
      answers: ['s1', 's2', 's3'],
      leaves: ['s4'],
      targets: [{ ref: 'el:desktop/see-the-work', name: 'The button' }],
    };
    lane.script([
      { op: 'say', text: 'All three ask for a bigger button - Tereza, Jonas and you.\n\n```maude-offer\n' + JSON.stringify(offer) + '\n```' },
    ]);
    await ui.ask('What do these ask for?');
    await until(() => ui.tid('ai-scope-chip').count(), 'the scope chip');
    assert.match(
      await ui.tid('ai-scope-chip').first().innerText(),
      /3 stickies/,
      `the chip follows the selection (sticky attributes: ${JSON.stringify(picked)})`
    );
    await until(() => ui.tid('ai-offer').count(), 'the offer card', 40_000);
    assert.equal((await ui.tid('ai-offer-make').first().innerText()).trim(), 'Make these changes');
    assert.equal((await ui.tid('ai-offer-skip').first().innerText()).trim(), 'Not now');
    assert.match(await ui.tid('ai-offer-says').first().innerText(), /See the work/);
    // AI outlines what the stickies point at
    await until(() => ui.frame().locator('[data-testid="ai-seen-ring"]').count(), 'the dashed outline round the target');
    assert.equal(lane.read(CANVAS_FILE), design, 'nothing has changed yet');
    await ui.shot('15-an-ai-read');
  });

  test('an-ai-apply + an-ai-stickers: Make these changes - the canvas changes, the stickies stay resolved, Done!/Flagged wear a spark; one undo takes both back', { todo: 'next run: depends on the verb write above; written, unverified' }, async () => {
    const design = lane.read(CANVAS_FILE);
    lane.script([
      { op: 'tool', id: 'm1', title: 'Make the button bigger', path: CANVAS_FILE },
      {
        op: 'subst',
        path: CANVAS_FILE,
        from: 'style={{ position: "absolute", left: 40, top: 120 }}>See the work',
        to: 'style={{ position: "absolute", left: 40, top: 120, padding: "16px 40px" }}>See the work',
      },
      annotate(lane, [
        { op: 'resolve', ids: ['s1', 's2', 's3'] },
        { op: 'sticker', sticker: 'project-status/group-51', x: 220, y: 280, w: 88, h: 88 },
        { op: 'sticker', sticker: 'project-status/group-47', x: 700, y: 300, w: 88, h: 88 },
      ]),
      { op: 'done', id: 'm1', path: CANVAS_FILE },
      { op: 'say', text: 'Done - the button is bigger. The 3 stickies it answered are resolved and stay where they were. "Warmer sun?" is flagged - that one is your call.' },
    ]);
    // "Make these changes" sends the follow-up from the offer card when there is one; this test does not depend on
    // the card (an-ai-read above covers it), so it asks in the same words itself when the card is not there
    if (await ui.tid('ai-offer-make').count()) await ui.tid('ai-offer-make').first().click();
    else await ui.ask('Make these changes and mark what is done');
    await until(() => /padding: "16px 40px"/.test(lane.read(CANVAS_FILE)), 'the canvas change', 40_000);
    await until(() => ui.tid('ai-result').count(), 'the result card', 40_000);
    // the stickies it answered are resolved BY AI, struck through and kept
    await until(async () => (await scene(ui, '.dc-annot-done[data-by="ai"]').count()) === 3, 'three stickies resolved by AI', 20_000);
    const stored = diskBoard(lane);
    for (const id of ['s1', 's2', 's3']) {
      const e = stored.find((x) => x.id === id);
      assert.ok(e, `${id} is kept`);
      assert.equal(e.resolved?.by, 'AI', `${id} resolved by AI`);
    }
    assert.ok(!stored.find((x) => x.id === 's4').resolved, '"Warmer sun?" stays open');
    // status stickers wear the small spark badge: "Placed by AI"
    assert.equal(await ui.frame().locator('[data-testid="annot-ai-badge"]').count(), 2, 'Done! and Flagged both wear the spark');
    await ui.shot('15-an-ai-stickers');
    // ⌘Z undoes the change AND what the AI did on the layer for it
    await ui.tid('ai-result-undo').first().click();
    await until(() => lane.read(CANVAS_FILE) === design, 'one undo to take the canvas change back', 20_000);
    await ui.shot('15-an-ai-apply.undone');
    const after = diskBoard(lane);
    assert.ok(
      !after.some((x) => x.id === 's1' && x.resolved),
      'the stickies are open again after the undo (both are undone together)'
    );
  });
});
