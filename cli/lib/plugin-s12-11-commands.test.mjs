// S12.11 — pins for the commands the words pass rewired (not just reworded).
//
// The words ratchet (plugin-v2-words.test.mjs) keeps the old strings out. These pins keep the
// behaviour that replaced them:
//   - /design:draw spawns draw-critic on a hand-off, like every critic;
//   - /design:import reads the reconstruct verdict from the hand-off result and never rewrites
//     _active.json (the studio owns it);
//   - /design:setup-docs treats a project with no canvases as valid;
//   - /design:chat attaches to an in-app chat through `claude --resume`, with no v1 shortcut.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, 'plugins', 'design', rel), 'utf8');

test('S12.11: /design:draw writes a hand-off for draw-critic and checks its result', () => {
  const draw = read('commands/draw.md');
  assert.match(draw, /handoff\/draw-critic-<n>\.in\.json/, 'draw-critic gets an in hand-off');
  assert.match(draw, /maude design check <output>/, 'the result is checked before it is read');
  assert.match(draw, /result\.verdict/, 'the verdict is read from the hand-off result');
  assert.doesNotMatch(
    draw,
    /^mark_path:\s/m,
    'the ad-hoc prompt block (mark_path:) is no longer the way draw-critic is spawned'
  );
});

test('S12.11: /design:import reads the reconstruct verdict from the hand-off result', () => {
  const imp = read('commands/import.md');
  assert.match(imp, /jq -r '\.result\.verdict\.converged'/);
  assert.doesNotMatch(
    imp,
    /jq -r '\.converged'/,
    'the strict top-level file is the no-hand-off shape; the loop now spawns on a hand-off'
  );
  assert.match(imp, /handoff\/reconstruct-critic-\$ROUND\.in\.json/);
  assert.match(imp, /handoff\/reconstruct-agent-\$ROUND\.in\.json/);
});

test('S12.11: /design:import does not rewrite the studio-owned _active.json', () => {
  const imp = read('commands/import.md');
  assert.doesNotMatch(imp, /jq [^\n]*\.active\s*=/, 'no jq write to _active.json');
  assert.match(imp, /maude design screenshot --canvas "\$CANVAS_REL"/);
});

test('S12.11: setup-docs says a project with no canvases is valid', () => {
  const docs = read('commands/setup-docs.md');
  assert.match(docs, /No canvases is valid/);
  assert.match(docs, /No canvases yet/);
  const init = read('commands/init.md');
  assert.match(init, /A project with no canvases is valid/);
});

test('S12.11: /design:chat opens the AI chat panel and attaches through claude --resume', () => {
  const chat = read('commands/chat.md');
  assert.match(chat, /AI chat panel/);
  assert.match(chat, /claude --resume <session id>/);
});

test('S12.11: hub-workspace and self-host name the four roles', () => {
  for (const rel of ['commands/hub-workspace.md', 'skills/self-host/SKILL.md']) {
    const text = read(rel);
    for (const role of ['Can view', 'Can comment', 'Can edit', 'Owner']) {
      assert.ok(text.includes(role), `${rel} names the role "${role}"`);
    }
  }
});
