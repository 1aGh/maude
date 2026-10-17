// The reachability probe's rules (Phase 4 gate,
// apps/studio/client/v2/contracts/V2-4-gate-nothing-deleted.md): where a row / kept target must be
// reachable, how a hook is recognised, how evidence becomes reachability.json. Pure — no browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  actionProbes,
  hookMatcher,
  hookProbes,
  LOCAL_PROBES,
  PROBE_IDS,
  rowProbes,
  seenIn,
  summarize,
} from '../v2-manifest/reach-rules.mjs';

const ROLE_RANK = { view: 0, comment: 1, edit: 2, owner: 3 };
// the registry's own predicate semantics, reduced to what these fixtures use
const isVisible = (a, ctx) =>
  (!a.visible?.shell || a.visible.shell.includes(ctx.shell)) &&
  (!a.visible?.minRole || ROLE_RANK[ctx.role] >= ROLE_RANK[a.visible.minRole]);
const actions = new Map([
  ['nav.home', { id: 'nav.home', visible: { shell: ['desktop'] } }],
  ['canvas.rename', { id: 'canvas.rename', visible: { minRole: 'edit' } }],
  ['view.minimap', { id: 'view.minimap' }],
]);
const deps = { settingsLocal: new Set(['A-figma-token']), actions, isVisible };

test('a settings row the model marks local is required only in the local shells', () => {
  assert.deepEqual(rowProbes({ id: 'A-figma-token', home: 'setc', v2: {} }, deps), LOCAL_PROBES);
});

test("a row naming an action follows the registry's visible predicate", () => {
  assert.deepEqual(rowProbes({ id: 'A-x', home: 'menu', v2: { action: 'nav.home' } }, deps), [
    'desktop',
  ]);
  const rename = rowProbes({ id: 'A-y', home: 'canv', v2: { action: 'canvas.rename' } }, deps);
  assert.ok(rename.includes('cloud-member'));
  assert.ok(!rename.includes('cloud-viewer') && !rename.includes('viewer'));
});

test('editor-only homes exempt the viewer probes; embed is never implied', () => {
  const p = rowProbes({ id: 'A-z', home: 'insp', v2: {} }, deps);
  assert.ok(!p.includes('viewer') && !p.includes('cloud-viewer') && !p.includes('embed'));
  const menu = rowProbes({ id: 'A-m', home: 'menu', v2: {} }, deps);
  assert.ok(menu.includes('viewer') && !menu.includes('embed'));
});

test('an explicit v2.reach wins; §B rows default to the local shells', () => {
  assert.deepEqual(rowProbes({ id: 'A-q', home: 'insp', v2: { reach: ['embed'] } }, deps), [
    'embed',
  ]);
  assert.deepEqual(rowProbes({ id: 'D8', home: 'Comments panel', v2: {} }, deps), LOCAL_PROBES);
  assert.deepEqual(rowProbes({ id: 'D19', home: 'native', v2: {} }, deps), ['desktop']);
});

test('a kept action is required wherever the registry shows it', () => {
  assert.deepEqual(actionProbes(actions.get('nav.home'), isVisible), ['desktop']);
  assert.equal(
    actionProbes(actions.get('view.minimap'), isVisible).length,
    PROBE_IDS.length - 1 // all but embed
  );
});

test('a kept hook is required where v1 showed it, else in the local shells', () => {
  const seen = new Map([['canvas-list', new Set(['browser', 'viewer'])]]);
  assert.deepEqual(hookProbes('canvas-list', seen), ['browser', 'viewer']);
  assert.deepEqual(hookProbes('sync-panel', seen), LOCAL_PROBES);
});

test('hooks: plain testids, patterns, optional parts, data-tour, selectors, prose', () => {
  assert.deepEqual(hookMatcher({ hook: 'project-pill', kind: 'testid' }), {
    testid: 'project-pill',
  });
  const pat = new RegExp(
    hookMatcher({ hook: 'project-menu-row-<action-id>', kind: 'testid' }).testidRe
  );
  assert.ok(pat.test('project-menu-row-sync.resync'));
  assert.ok(!pat.test('project-menu-row-'));
  const opt = new RegExp(
    hookMatcher({ hook: 'home-search-row-<pid>-<slug>[-<artboard>]', kind: 'testid' }).testidRe
  );
  assert.ok(opt.test('home-search-row-l1-ui-home') && opt.test('home-search-row-l1-ui-home-hero'));
  assert.deepEqual(hookMatcher({ hook: 'inspector', kind: 'data-tour' }), { tour: 'inspector' });
  assert.deepEqual(
    hookMatcher({ hook: '.dc-annot-ctx (+ -sw, -fs-trigger, -fs-item, -fs-px)', kind: 'selector' }),
    { css: ['.dc-annot-ctx'] }
  );
  assert.deepEqual(hookMatcher({ hook: '.dc-mm / .dc-zoom-tb', kind: 'selector' }), {
    css: ['.dc-mm', '.dc-zoom-tb'],
  });
  assert.equal(hookMatcher({ hook: 'Inspector field labels', kind: 'selector' }), null);
});

test('evidence → reachability: every required probe, menu row or ⌘K for actions, n/a elsewhere', () => {
  const ev = (testids, palette = {}) => ({ ok: true, testids, tours: [], css: [], palette });
  const evidence = {
    desktop: { menu: ev(['project-menu-row-view.minimap', 'settings-figma']) },
    browser: { palette: ev([], { 'view.minimap': true }), shell: ev(['settings-figma']) },
  };
  const doc = summarize({
    evidence,
    subjects: {
      rows: [
        { id: 'A-minimap', need: ['desktop', 'browser'], hook: null, action: 'view.minimap' },
        {
          id: 'A-figma',
          need: ['desktop', 'browser', 'cloud-owner'],
          hook: 'settings-figma',
          action: null,
        },
        { id: 'A-empty', need: ['desktop'], hook: null, action: null },
      ],
      targets: [],
    },
    hooksByName: new Map(),
    taken: 'test',
    bundle: 'test',
  });
  assert.equal(doc.rows['A-minimap'], true);
  assert.match(doc.rows['A-figma'], /not reached in cloud-owner$/);
  assert.match(doc.rows['A-empty'], /no v2 home yet/);
  assert.equal(doc.perShell.desktop.rows['A-minimap'], 'ok: menu (menu row)');
  assert.equal(doc.perShell.browser.rows['A-minimap'], 'ok: palette (⌘K)');
  assert.equal(doc.perShell.viewer.rows['A-minimap'], 'n/a');
});

test('evidence collected before a failed step still counts', () => {
  const failed = {
    ok: false,
    err: 'click timeout',
    testids: ['canvases-advanced'],
    tours: [],
    css: [],
  };
  assert.ok(seenIn(failed, 'canvases-advanced'));
  const doc = summarize({
    evidence: { desktop: { 'left-canvases': failed } },
    subjects: {
      rows: [],
      targets: [{ id: 'testid:canvases-advanced', need: ['desktop'], hook: 'canvases-advanced' }],
    },
    hooksByName: new Map(),
    taken: 'test',
    bundle: 'test',
  });
  assert.equal(doc.targets['testid:canvases-advanced'], true);
  assert.equal(doc.openers.desktop['left-canvases'], 'failed: click timeout');
});
