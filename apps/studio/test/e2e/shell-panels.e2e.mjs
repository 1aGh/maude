// rc.1 findings 6 / 16 / 20 (package C) - the shell's panels, driven in a real browser (node --test).
//
//   scripts/v2-test-lane.sh -- node --test apps/studio/test/e2e/shell-panels.e2e.mjs
//   Needs a built dist: cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release (revert dist/ after).
//
// A real studio server on a throwaway project in headless Chromium (the ai-lane harness: native stub, fake agent).
//
//   16  every resizable panel resizes by its grip: Canvases (left), Inspector, AI chat
//   6   the AI chat shrinks (it was stuck at 340) and its Hide chevron is never under a folded panel's corner icon
//   20  nothing scrolls the shell: the window, `.sh-shell` and `body` keep scrollTop 0 after the gestures that used to
//       move them (a focus / scrollIntoView on something past the bottom, an explicit scroll)
//   5   the Advanced folds start closed on a fresh Mac

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BLANK, sleep, startAiLane, until } from './ai-lane.mjs';

const CANVAS = '.design/ui/Landing.tsx';

let lane;
let ui;
before(async () => {
  lane = await startAiLane({ files: { [CANVAS]: BLANK } });
  ui = await lane.open('ui/Landing.tsx');
  await ui.ready(0);
  await sleep(1200);
});
after(async () => {
  await lane?.stop();
});

const box = async (testid) => ui.tid(testid).first().boundingBox();
const widthOf = async (testid) => Math.round((await box(testid)).width);

/** Press on a grip, move `dx` px, release. */
async function drag(gripId, dx) {
  const gb = await box(gripId);
  const x = gb.x + gb.width / 2;
  const y = gb.y + 200;
  await ui.page.mouse.move(x, y);
  await ui.page.mouse.down();
  await ui.page.mouse.move(x + dx, y, { steps: 10 });
  await ui.page.mouse.up();
  await sleep(350);
}
const near = (got, want, what, tol = 3) =>
  assert.ok(Math.abs(got - want) <= tol, `${what}: ${got}px, wanted ${want}px (±${tol})`);

describe('16 · every resizable panel resizes by its grip', () => {
  test('the left panel follows its grip', async () => {
    const w0 = await widthOf('dock-slot-left');
    await drag('panel-grip-left', 60);
    near(await widthOf('dock-slot-left'), w0 + 60, 'Canvases after +60');
    await drag('panel-grip-left', -60);
    near(await widthOf('dock-slot-left'), w0, 'Canvases back');
  });

  test('the Inspector follows its grip (it was a fixed 264 card: the divider showed, the drag did nothing)', async () => {
    await ui.tid('panel-icon-right').click();
    await until(() => ui.tid('panel-grip-right').count(), 'the right grip', 10_000);
    await sleep(500);
    const w0 = await widthOf('dock-slot-right');
    await drag('panel-grip-right', -100);
    near(await widthOf('dock-slot-right'), w0 + 100, 'Inspector after -100');
    await drag('panel-grip-right', 100);
    near(await widthOf('dock-slot-right'), w0, 'Inspector back');
    // ⇧⌘I closes it again: the folded icon is the way back
    await ui.page.keyboard.press('Meta+Shift+KeyI');
    await until(() => ui.tid('panel-icon-right').count(), 'the folded Inspector icon', 10_000);
  });
});

describe('6 · the AI chat resizes both ways and does not sit under a corner icon', () => {
  test('wider and narrower than its 340 default', async () => {
    // the Inspector is folded (its corner icon is on screen): the chat is alone in the slot
    assert.equal(await ui.tid('dock-slot-right').count(), 0, 'the Inspector is closed');
    await ui.openAi();
    await sleep(500);
    const w0 = await widthOf('ai-chat-island');
    near(w0, 340, 'the chat opens at 340', 6);
    await drag('panel-grip-right', -100);
    near(await widthOf('ai-chat-island'), w0 + 100, 'the chat grows with its grip');
    await drag('panel-grip-right', 400);
    const small = await widthOf('ai-chat-island');
    assert.ok(small <= 285, `the chat shrinks well under its old 340 floor (${small}px)`);
    assert.ok(small >= 270, `...but not to nothing (${small}px)`);
  });

  test('its Hide chevron is clear of the folded Inspector icon, even when the chat reaches the top', async () => {
    // a double-click on the grip takes the chat to the window's full height (BigChat)
    const gb = await box('panel-grip-right');
    await ui.page.mouse.dblclick(gb.x + gb.width / 2, gb.y + 300);
    await sleep(500);
    const hide = await box('ai-chat-hide');
    assert.ok(hide, 'the Hide chevron is on screen');
    const icon = await box('panel-icon-right'); // the folded Inspector's corner icon must be there to be dodged
    assert.ok(icon, 'the folded Inspector icon is on screen');
    const apart =
      icon.x + icon.width <= hide.x ||
      hide.x + hide.width <= icon.x ||
      icon.y + icon.height <= hide.y ||
      hide.y + hide.height <= icon.y;
    assert.ok(
      apart,
      `Hide chevron ${JSON.stringify(hide)} overlaps the Inspector icon ${JSON.stringify(icon)}`
    );
    await ui.shot('r1-chat-full');
    await ui.page.mouse.dblclick(gb.x + gb.width / 2, gb.y + 300);
  });
});

describe('20 · nothing scrolls the shell', () => {
  const scrolls = () =>
    ui.page.evaluate(() => ({
      shell: document.querySelector('.sh-shell')?.scrollTop ?? 0,
      shellLeft: document.querySelector('.sh-shell')?.scrollLeft ?? 0,
      doc: document.scrollingElement?.scrollTop ?? 0,
      body: document.body.scrollTop,
      maude: document.querySelector('.maude')?.scrollTop ?? 0,
    }));

  test('a focus + scrollIntoView on something past the shell, and an explicit scroll, leave every scrollTop at 0', async () => {
    await ui.page.evaluate(() => {
      // content taller than the shell, inside it and beside it: whatever the real gesture was, it needs overflow
      const shell = document.querySelector('.sh-shell');
      const tall = document.createElement('div');
      tall.id = '__tall';
      tall.style.cssText = 'flex:none;height:3000px;width:10px';
      const input = document.createElement('input');
      input.id = '__far';
      input.style.cssText = 'position:absolute;left:0;top:2800px';
      tall.append(input);
      tall.style.position = 'relative';
      shell.append(tall);
      const out = document.createElement('div');
      out.id = '__out';
      out.style.cssText = 'position:absolute;left:0;top:4000px;width:10px;height:10px';
      document.body.append(out);
    });
    await ui.page.evaluate(() => {
      document.getElementById('__far').focus();
      document.getElementById('__far').scrollIntoView();
      document.getElementById('__out').scrollIntoView();
      window.scrollTo(0, 500);
      document.scrollingElement.scrollTop = 400;
      document.querySelector('.sh-shell').scrollTop = 300;
      document.querySelector('.sh-shell').scrollLeft = 50;
    });
    await sleep(300); // scroll events settle on the next frame
    const s = await scrolls();
    assert.deepEqual(s, { shell: 0, shellLeft: 0, doc: 0, body: 0, maude: 0 });
    // the panels still scroll inside themselves: the Canvases list is a scroller of its own
    const inner = await ui.page.evaluate(() => {
      const t = document.querySelector('.sh-tree');
      return t ? getComputedStyle(t).overflowY : null;
    });
    assert.ok(inner === 'auto' || inner === 'scroll', `a panel keeps its own scroll (${inner})`);
    await ui.page.evaluate(() => {
      document.getElementById('__tall')?.remove();
      document.getElementById('__out')?.remove();
    });
  });
});

describe('5 · Advanced folds start closed on a fresh Mac', () => {
  test('the chat Advanced is closed until someone opens it, then it is remembered', async () => {
    await ui.openAi();
    await sleep(400);
    const toggle = ui.page.locator('[data-testid="ai-advanced"]:visible').first();
    await toggle.waitFor({ timeout: 10_000 });
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.click();
    await sleep(300);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    const prefs = await fetch(`http://localhost:${lane.port}/_api/ui-prefs`).then((r) => r.json());
    assert.equal(prefs?.fold?.['ai.chat'], true, 'the open fold is remembered per Mac');
    await toggle.click();
  });
});
