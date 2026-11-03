// rc3-h (issue 182) - Michal's rc.2 scenario, end to end (browser E2E, node --test): an empty project, an empty
// canvas, one prompt "udelej mi jednoduchy navrh kanban board". The canvas must react the moment AI starts, and the
// chat must say what AI is doing as it does it.
//
//   cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release        (the shell bundle this tree ships)
//   scripts/v2-test-lane.sh --wait 3600 -- node --test apps/studio/test/e2e/rc3-liveness.e2e.mjs
//   E2E_SHOTS=<dir> keeps the screenshots (the evidence lives in .ai/plans/notes/v2-evidence/rc3-liveness/).
//
// The same lane as ai-states.e2e.mjs: a real studio server on a throwaway project, the real canvas + AI panel in
// headless Chromium, and the SCRIPTED fake ACP agent (fixtures/hook-agent.mjs) that runs the design plugin's REAL
// hook code - the run registry, the working line, the ghost and the rings are the shipped ones; only the model is
// missing. The agent holds each state at a `gate`: the scenario asserts, shoots, then lets it go on. No model, no
// real `claude`, no timer decides a state.
//
// The mock run, the way Claude Code streams it: thinking -> a plan -> Read the canvas -> Write the canvas with a
// kanban artboard -> done.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BLANK, sleep, startAiLane, until } from './ai-lane.mjs';

const CANVAS = '.design/ui/Untitled.tsx';
const PROMPT = 'udelej mi jednoduchy navrh kanban board';

const column = (
  id,
  title,
  cards
) => `            <section data-cd-id="${id}" style={{ flex: 1, background: "#eef0f4", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <h2 data-cd-id="${id}-title" style={{ margin: 0, fontSize: 18 }}>${title}</h2>
${cards.map((c, i) => `              <div data-cd-id="${id}-card-${i + 1}" style={{ background: "#fff", borderRadius: 8, padding: 12, boxShadow: "0 1px 2px rgba(0,0,0,.08)" }}>${c}</div>`).join('\n')}
            </section>`;
const KANBAN = `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function Untitled() {
  return (
    <DesignCanvas>
      <DCSection id="main" title="Main">
        <DCArtboard id="kanban" label="Kanban board" kind="web" width={1280} height={800}>
          <div data-cd-id="kanban-page" style={{ width: 1280, height: 800, background: "#f7f8fa", fontFamily: "system-ui, sans-serif", padding: 40, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 24 }}>
            <h1 data-cd-id="kanban-title" style={{ margin: 0, fontSize: 32 }}>Sprint board</h1>
            <div data-cd-id="kanban-columns" style={{ display: "flex", gap: 20, flex: 1 }}>
${column('todo', 'To do', ['Write the brief', 'Pick a palette', 'Sketch the home page'])}
${column('doing', 'In progress', ['Design system tokens', 'Card component'])}
${column('done', 'Done', ['Kick-off call'])}
            </div>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;
const PLAN = (i) =>
  ['Read the canvas', 'Draw the kanban board', 'Check how it looks'].map((content, n) => ({
    content,
    status: n < i ? 'completed' : n === i ? 'in_progress' : 'pending',
    priority: 'medium',
  }));

const line = (ui) => ui.vis('ai-working-text').first().innerText();
const working = (ui) => ui.vis('ai-working').first().innerText();
const ghost = (ui) => ui.tid('ai-drafting').count();
const ghostLabel = (ui) => ui.tid('ai-drafting-label').first().innerText();

describe('rc3 liveness - an empty canvas, one prompt: the canvas and the chat react from the first second', () => {
  let lane;
  let ui;
  before(async () => {
    lane = await startAiLane({ files: { [CANVAS]: BLANK }, name: 'Kanban' });
    ui = await lane.open('ui/Untitled.tsx');
    await ui.ready(0);
    await sleep(3500); // past the canvas's first draw: an artboard that appears after this is the AI's
  });
  after(async () => {
    await lane?.stop();
  });

  test('presence before the first write, a line that follows the stream, the artboard lands and both let go', async () => {
    // 0 - the empty canvas invites; nothing of AI on it
    await until(() => ui.tid('empty-canvas').count(), 'the empty-canvas card');
    assert.equal(await ghost(ui), 0, 'no AI presence before a run');
    await ui.shot('rc3-liveness.0-empty-canvas');

    lane.script([
      { op: 'gate', name: 'started' },
      { op: 'think', text: 'The person wants a simple kanban board.' },
      { op: 'gate', name: 'thought' },
      { op: 'plan', entries: PLAN(0) },
      {
        op: 'tool',
        id: 'r1',
        title: `Read ${CANVAS}`,
        kind: 'read',
        path: CANVAS,
      },
      { op: 'gate', name: 'read' },
      { op: 'done', id: 'r1', path: CANVAS },
      { op: 'plan', entries: PLAN(1) },
      {
        op: 'tool',
        id: 'w1',
        title: `Write ${CANVAS}`,
        kind: 'edit',
        path: CANVAS,
        input: { content: KANBAN },
      },
      { op: 'gate', name: 'write' },
      { op: 'edit', path: CANVAS, content: KANBAN },
      { op: 'done', id: 'w1', path: CANVAS },
      { op: 'gate', name: 'landed' },
      {
        op: 'say',
        text: 'Done — a kanban board with To do, In progress and Done is on the canvas.',
      },
    ]);
    await ui.ask(PROMPT);

    // 1 - the run has started, nothing written yet: the ghost + AI cursor where the first artboard lands
    await until(() => ghost(ui), 'the drafting ghost the moment the run starts', 20_000);
    assert.match(await ghostLabel(ui), /AI is drafting/);
    assert.equal(await ui.tid('ai-drafting-cursor').count(), 1, 'the AI cursor sits on the ghost');
    assert.equal(await ui.tid('empty-canvas').count(), 0, 'the invitation stepped aside');
    assert.deepEqual(await ui.artboards(), [], 'nothing written yet');
    await until(() => ui.vis('ai-working').count(), 'the working line');
    // a non-English ask has no verb we know: the run's headline is the plain "AI is working" (never a guess)
    assert.equal(await line(ui), 'AI is working');
    await ui.shot('rc3-liveness.1-presence');
    lane.gate('started');

    // 2 - thinking
    await until(
      async () => (await line(ui)) === 'AI is thinking',
      'the line to say "AI is thinking"'
    );
    lane.gate('thought');

    // 3 - reading the canvas: a name, never a path; the plan step under it
    await until(
      async () => (await line(ui)) === 'AI is reading Untitled',
      'the line to say "AI is reading Untitled"'
    );
    assert.match(await working(ui), /Step 1 of 3/);
    assert.doesNotMatch(await working(ui), /\.design|\/|tsx/, 'no path in the working line');
    assert.equal(await ghost(ui), 1, 'the ghost stays while AI reads');
    await ui.shot('rc3-liveness.2-reading');
    lane.gate('read');

    // 4 - the write is in flight: the line and the ghost name the artboard being drawn, before it lands
    await until(
      async () => (await line(ui)) === 'AI is drawing Kanban board',
      'the line to say "AI is drawing Kanban board"'
    );
    assert.match(await working(ui), /Step 2 of 3/);
    await until(
      async () => (await ghostLabel(ui)) === 'AI is drawing Kanban board',
      'the ghost to take the artboard name'
    );
    assert.deepEqual(await ui.artboards(), [], 'still nothing on the canvas');
    await ui.shot('rc3-liveness.3-drawing');
    lane.gate('write');

    // 5 - the artboard lands: the ghost goes, the artboard wears the run's ring
    await until(
      async () => (await ui.artboards()).includes('kanban'),
      'the kanban artboard on the canvas'
    );
    await until(async () => (await ghost(ui)) === 0, 'the ghost to go when the artboard lands');
    await until(
      () =>
        ui.inFrame(() => {
          const r = document.querySelector('[data-testid="ai-ring-kanban"]');
          return r && r.getAttribute('data-state') === 'running';
        }),
      'a ring on the kanban artboard while the run is live'
    );
    await sleep(800);
    await ui.shot('rc3-liveness.4-first-artboard');
    lane.gate('landed');

    // 6 - done: the line and the ghost are gone, the result card says what landed
    await until(() => ui.tid('ai-result').count(), 'the result card', 30_000);
    await until(async () => (await ui.vis('ai-working').count()) === 0, 'the working line to go');
    assert.equal(await ghost(ui), 0);
    assert.equal(
      await ui.tid('empty-canvas').count(),
      0,
      'no invitation over a canvas with an artboard'
    );
    await sleep(500);
    await ui.shot('rc3-liveness.5-done');
    assert.deepEqual(ui.errors, [], 'no page errors');
  });

  test('a stopped run takes the ghost away and the empty canvas invites again', async () => {
    // a fresh empty canvas in the same project
    lane.write('.design/ui/Second.tsx', BLANK);
    const ui2 = await lane.open('ui/Second.tsx');
    await ui2.ready(0);
    await sleep(3500);
    lane.script([
      { op: 'think', text: 'Thinking about columns.' },
      { op: 'gate', name: 'hold' },
    ]);
    await ui2.ask(PROMPT);
    await until(() => ui2.tid('ai-drafting').count(), 'the ghost on the second canvas', 20_000);
    await until(() => ui2.vis('ai-stop').count(), 'Stop on the working line');
    await ui2.vis('ai-stop').first().click();
    await until(
      async () => (await ui2.tid('ai-drafting').count()) === 0,
      'the ghost to go on Stop'
    );
    await until(() => ui2.tid('empty-canvas').count(), 'the empty-canvas card back');
    await ui2.shot('rc3-liveness.6-stopped');
    lane.gate('hold');
  });
});
