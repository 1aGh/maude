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
  toolRoles,
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

// ── tool reach: a tool is required only where its slot's minRole lets the role in ────────────────
const slotId = (s) => (s.tool === 'move' ? 'tool.select' : `tool.${s.tool ?? s.panel}`);
const modeTools = {
  edit: {
    slots: [
      { tool: 'move', minRole: 'edit' },
      { tool: 'hand', minRole: 'edit' },
    ],
  },
  preview: {
    slots: [
      { tool: 'browse', minRole: 'view' },
      { tool: 'comment', minRole: 'comment' },
      { tool: 'pen', minRole: 'edit', tips: ['pen', 'highlighter', 'eraser'] },
    ],
  },
  viewing: {
    slots: [
      { tool: 'inspect', minRole: 'view' },
      { tool: 'comment', minRole: 'comment' },
    ],
  },
};
const roles = toolRoles(modeTools, slotId);
const toolDeps = { ...deps, toolRoles: roles };
const toolActions = new Map(
  ['tool.select', 'tool.browse', 'tool.comment', 'tool.highlighter', 'tool.rect'].map((id) => [
    id,
    { id },
  ])
);

test('toolRoles: the lowest minRole across modes; tips inherit; an unlisted tool is edit', () => {
  assert.equal(roles.get('tool.comment'), 'comment');
  assert.equal(roles.get('tool.browse'), 'view');
  assert.equal(roles.get('tool.select'), 'edit');
  assert.equal(roles.get('tool.highlighter'), 'edit'); // a Marker tip
  assert.equal(roles.get('toolbar-slot-browse'), 'view');
});

test('a tool action is required only in the shells whose role reaches its slot', () => {
  const need = (id) => actionProbes(toolActions.get(id), isVisible, roles);
  assert.ok(need('tool.select').includes('cloud-member'));
  assert.ok(
    !need('tool.select').includes('viewer') && !need('tool.select').includes('cloud-viewer')
  );
  assert.ok(need('tool.browse').includes('viewer') && need('tool.browse').includes('cloud-viewer'));
  assert.ok(need('tool.comment').includes('viewer'));
  assert.ok(!need('tool.highlighter').includes('viewer'));
  assert.ok(!need('tool.rect').includes('cloud-viewer')); // no slot: the rest are edit
  assert.ok(need('tool.rect').includes('desktop'));
});

test('a row whose action or hook is a tool follows the same rule', () => {
  const sel = rowProbes({ id: 'A-s', home: 'menu', v2: { action: 'tool.select' } }, toolDeps);
  assert.ok(sel.includes('cloud-owner'));
  assert.ok(!sel.includes('viewer') && !sel.includes('cloud-viewer'));
  const hand = rowProbes({ id: 'A-b', home: 'menu', v2: { action: 'tool.browse' } }, toolDeps);
  assert.ok(hand.includes('viewer'));
  const hook = rowProbes(
    { id: 'A-h', home: 'menu', v2: { testid: 'toolbar-slot-move' } },
    toolDeps
  );
  assert.ok(hook.includes('cloud-owner') && !hook.includes('viewer'));
});

test('a key-only action ⌘K leaves out is reached through the "?" sheet row', () => {
  const ev = (testids) => ({ ok: true, testids, tours: [], css: [], palette: {} });
  const doc = summarize({
    evidence: { browser: { shortcuts: ev(['shortcuts-row-object.nudge']), canvas: ev([]) } },
    subjects: {
      rows: [],
      targets: [
        { id: 'action:object.nudge', need: ['browser'], action: 'object.nudge', hook: null },
        { id: 'action:ai.draw-mark', need: ['browser'], action: 'ai.draw-mark', hook: null },
      ],
    },
    hooksByName: new Map(),
    taken: 'now',
    bundle: 'test',
  });
  assert.equal(doc.targets['action:object.nudge'], true);
  assert.equal(doc.perShell.browser.targets['action:object.nudge'], 'ok: shortcuts ("?" sheet)');
  assert.match(doc.targets['action:ai.draw-mark'], /not reached in browser/);
});

test('a hook that only one kind of shell draws is required there, whatever v1 showed', () => {
  const seen = new Map([['team-projects', new Set(['browser'])]]);
  assert.deepEqual(hookProbes('settings-github-signin', seen), ['desktop']);
  assert.deepEqual(hookProbes('team-projects', seen), ['desktop']); // the name beats the golden
  assert.deepEqual(hookProbes('chat-composer', seen), ['desktop']);
  assert.deepEqual(hookProbes('.chat-input', seen), ['desktop']);
  assert.ok(!hookProbes('share-open-app', seen).includes('desktop'));
  assert.deepEqual(hookProbes('sync-offline', seen), LOCAL_PROBES); // an unnamed hook keeps the default
});

test('an action whose v2 home is a control inside a sheet is reached through ACTION_SURFACE', () => {
  const ev = (testids) => ({ ok: true, testids, tours: [], css: [], palette: {} });
  const doc = summarize({
    evidence: {
      desktop: { export: ev(['export-recent-again-0', 'settings-check-updates']), canvas: ev([]) },
    },
    subjects: {
      rows: [],
      targets: [
        { id: 'action:export.rerun-last', need: ['desktop'], action: 'export.rerun-last', hook: null },
        { id: 'action:app.check-updates', need: ['desktop'], action: 'app.check-updates', hook: null },
        { id: 'action:help.ai-readiness', need: ['desktop'], action: 'help.ai-readiness', hook: null },
      ],
    },
    hooksByName: new Map(),
    taken: 'now',
    bundle: 'test',
  });
  assert.equal(doc.targets['action:export.rerun-last'], true); // "Export again" on a Recent row
  assert.equal(doc.targets['action:app.check-updates'], true); // Settings > Advanced > Update
  assert.match(doc.targets['action:help.ai-readiness'], /not reached in desktop/); // its row is not on screen here
});
