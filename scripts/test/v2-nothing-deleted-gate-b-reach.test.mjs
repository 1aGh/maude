// Wave-B gate, nothing-deleted reach (branch gate-b-reach): what the 12:57 pass on feat lost, pinned so a wave-B
// move can never again turn a reachable home into an "open" line without a red test. No browser.
//   (a) the probe's openers followed the UI that wave B moved (Figma sheet, the long-video badge, the ⌃-wheel point)
//   (b) hooks whose only emitter is mounted nowhere are `moves`, never `stable`
//   (c) wave-B files are v2 code, not v1 entry points; a native-only home is required in the native shell only
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CAP } from '../../apps/studio/client/v2/timeline/advanced/video-cap.js';
import { isV2Code } from '../v2-manifest/map-entries.mjs';
import { OPENERS, resolveOpener } from '../v2-manifest/openers.mjs';
import { rowProbes } from '../v2-manifest/reach-rules.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const opener = (id) => OPENERS.find((o) => o.id === id);

test('the Figma import opener answers the routes the v2 sheet calls and walks link → pick → summary', () => {
  const o = opener('dialog-figma-import-run');
  const w = resolveOpener(o);
  // FigmaSheet reads the page's frames from /_api/figma/frames and writes through /_api/figma/import-frames
  assert.equal(w.routes['/_api/figma/frames'].surface, 'design');
  assert.ok(w.routes['/_api/figma/frames'].frames.length > 0);
  assert.ok(w.routes['/_api/figma/import-frames'].artboards > 0);
  assert.equal(w.routes['/_api/figma/import'], undefined, 'the v1 route is gone');
  const clicks = o.steps.map((s) => s.click ?? s.waitFor).filter(Boolean);
  assert.ok(clicks.some((c) => c.includes('figma-import-run')));
  assert.ok(clicks.some((c) => c.includes('figma-import-summary')));
  // a link Figma refuses reads the same way: the frames route answers the failure
  assert.equal(
    resolveOpener(opener('dialog-figma-import-bad')).routes['/_api/figma/frames'].ok,
    false
  );
});

test('the video fixture is past the long-video cap and the opener opens Advanced through its badge', () => {
  const src = read('scripts/v2-manifest/probe-reach.mjs');
  const frames = Number(
    src.match(/<VideoComp component=\{ReelCut\} durationInFrames=\{(\d+)\}/)?.[1]
  );
  assert.ok(
    frames > DEFAULT_CAP,
    `${frames} frames must pass the ${DEFAULT_CAP}-frame default cap`
  );
  const seqs = [...src.matchAll(/<Sequence from=\{(\d+)\} durationInFrames=\{(\d+)\}>/g)];
  assert.equal(Math.max(...seqs.map((m) => Number(m[1]) + Number(m[2]))), frames);
  const steps = opener('video-timeline').steps;
  assert.ok(steps.some((s) => s.click?.includes('timeline-long-badge')));
});

test('a reach step can wait for a screen instead of a clock, and the click wait outlasts a busy machine', () => {
  const src = read('scripts/v2-manifest/probe-reach.mjs');
  assert.match(src, /step\.waitFor/);
  assert.match(src, /LOAD_MS = (\d+)/);
  assert.ok(Number(src.match(/LOAD_MS = (\d+)/)[1]) >= 8000);
  assert.deepEqual(
    opener('acp-comments').steps.find((s) => s.waitFor)?.waitFor,
    '[data-testid="chat-qa-implement-comments"]'
  );
  // a failed opener gets a second attempt before it counts as unreachable
  assert.match(src, /const again = await runOpener/);
});

test('an opener leaves with nothing selected, after its last look at the page (the selection outlives a page)', () => {
  const src = read('scripts/v2-manifest/probe-reach.mjs');
  const esc = src.indexOf("last.keyboard.press('Escape')");
  assert.ok(esc > 0, 'the probe presses Esc before it closes the page');
  // in the `finally` (so a failed opener leaves clean too): after the screenshot / eval hooks that look at the page,
  // before the context closes
  assert.ok(esc > src.indexOf('PROBE_FRAME_EVAL'), 'after the last look at the page');
  assert.ok(esc < src.indexOf('await ctx.close();'), 'before the page closes');
  assert.match(src, /PROBE_LEAVE_SELECTED/);
});

test('the ⌃-wheel zoom does not press where the first-run hint and the toasts stack', () => {
  const src = read('scripts/v2-manifest/probe-reach.mjs');
  const at = src.match(
    /page\.mouse\.move\(box\.x \+ box\.width \* ([\d.]+), box\.y \+ box\.height - 130\)/
  );
  assert.ok(at, 'the zoom point is a fraction of the width');
  assert.ok(Number(at[1]) < 0.3, 'left of the centred hint / toast stack');
});

test('a hook whose only emitter is mounted nowhere is never `stable`', () => {
  const hooks = JSON.parse(read('apps/studio/client/testids.json'));
  // SyncPanel.jsx / SourceConflictPanel.jsx stay as files, mounted nowhere (S11.12b): a `stable` hook produced by
  // them has no element for the probe to find and would stay an open line of the audit forever
  const unmounted = hooks.filter(
    (h) =>
      /client\/panels\/(SyncPanel|SourceConflictPanel)\.jsx$/.test(h.producer?.file ?? '') &&
      h.v2 === 'stable'
  );
  assert.deepEqual(
    unmounted.map((h) => h.hook),
    []
  );
  for (const hook of [
    'source-conflict-panel',
    'source-conflict-keep-mine',
    '.sp-note / .sp-note-dot',
  ]) {
    const h = hooks.find((x) => x.hook === hook);
    assert.equal(h.v2, 'moves', hook);
    assert.match(h.notes, /Diagnostics > Sync/);
  }
});

test('wave-B files are v2 code, not v1 entry points; a v1 panel file still is one', () => {
  const late = (file) => ({ id: `testid:${file}#x/y`, file, kind: 'testid' });
  assert.ok(isV2Code(late('apps/studio/ds/board/ds-bar.tsx')));
  assert.ok(isV2Code(late('apps/studio/ds/board/outline.tsx')));
  assert.ok(isV2Code(late('apps/studio/asset-upload-bars.tsx')));
  assert.ok(!isV2Code(late('apps/studio/client/panels/SourceConflictPanel.jsx')));
});

test('"Sign in again" is a native-shell home: required in the desktop probe only', () => {
  const nd = JSON.parse(read('apps/studio/client/v2/nothing-deleted.json'));
  const row = nd.rows.find((r) => r.id === 'A-sign-in-again-when-sync-stops');
  const need = rowProbes(row, {
    settingsLocal: new Set(),
    actions: new Map(),
    isVisible: () => true,
  });
  // sync-details-model.js `signIn: refused && !cloud && native`
  assert.deepEqual(need, ['desktop']);
  assert.match(
    read('apps/studio/client/v2/diagnostics/sync-details/sync-details-model.js'),
    /signIn: refused && !cloud && native/
  );
});

test('the Preview openers fit the canvas first and press near the element corner (a clean page opens at 100 % on Pricing, a b-roll player over the Hero)', () => {
  for (const id of ['preview-comment', 'preview-inspect']) {
    const steps = OPENERS.find((o) => o.id === id).steps;
    const fit = steps.findIndex((s) => s.frameKey === 'Meta+0');
    const hit = steps.findIndex((s) => s.frameClick?.includes('home-hero') && s.at);
    assert.ok(fit >= 0 && hit > fit, id);
  }
  assert.match(read('scripts/v2-manifest/probe-reach.mjs'), /position: step\.at/);
});

test('a reset connection to the fixture server does not crash the pass (the /_config route asks again, then aborts)', () => {
  const src = read('scripts/v2-manifest/probe-reach.mjs');
  assert.match(src, /res = await route\.fetch\(\)\.catch\(\(\) => null\)/);
  assert.match(src, /if \(!res\) return route\.abort\(\)/);
});

test('openers do not lean on the layout an earlier opener left: AI setup is stubbed, a board opens the Inspector itself', () => {
  const ai = OPENERS.find((o) => o.id === 'diag-ai');
  const w = resolveOpener(ai);
  const claude = w.routes['/_api/preflight'].items.find((i) => i.id === 'claude');
  // found (the "Found at" row) and waiting for a sign-in (the Sign in to Claude button)
  assert.ok(claude.resolvedPath && claude.action === 'signin');
  const steps = OPENERS.find((o) => o.id === 'inspector-artboard').steps;
  const open = steps.findIndex(
    (s) => s.key === 'Shift+Meta+I' && s.unless?.includes('inspector-panel')
  );
  assert.ok(open > steps.findIndex((s) => s.frameClick?.includes('dc-artboard-label')));
  assert.ok(open < steps.findIndex((s) => s.ensureOpen?.includes('fold-inspector-toggle')));
});
