// usage: node states.mjs <dark|light> [filter-regex] [port]
import * as d from './drv.mjs';

const theme = process.argv[2] ?? 'dark';
const filter = new RegExp(process.argv[3] ?? '.');
const port = process.argv[4] ?? '4431';
const BASE = `http://127.0.0.1:${port}`;
const N = (s) => new RegExp(`^${s}$`);

/** click a snapshot ref (works inside iframes) by a line pattern */
function refClick(re, { nth = 0 } = {}) {
  const lines = d.ab('snapshot', '-i').out.split('\n').filter((l) => re.test(l));
  const l = lines[nth];
  if (!l) return false;
  const m = l.match(/ref=(e\d+)/);
  return m ? d.ab('click', `@${m[1]}`).code === 0 : false;
}
const fresh = () => {
  d.open(BASE);
  // panels hidden by an earlier state stay hidden across reloads
  const shown = d.ev(`[...document.querySelectorAll('[role=tab]')].some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0})`);
  if (shown !== true) {
    d.clickName(/^Open Canvases$/);
    d.sleep(700);
    const again = d.ev(`[...document.querySelectorAll('[role=tab]')].some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0})`);
    if (again !== true) console.log('WARN panels not shown', again);
  }
};
const canvas = (name) => {
  fresh();
  const r = d.clickName(N(name));
  d.sleep(2600);
  return r.ok;
};
const key = (k) => {
  d.press(k);
  d.sleep(500);
};
const esc = () => {
  d.press('Escape');
  d.sleep(250);
  d.press('Escape');
  d.sleep(250);
};
const selectArtboard = () => refClick(/button "Artboard /) && (d.sleep(700), true);

const S = [];
const st = (name, fn) => S.push([name, fn]);

// ---- shell with no canvas ----
st('shell-empty', () => fresh());
st('left-layers', () => (fresh(), d.clickName(N('Layers')), d.sleep(500)));
st('left-assets', () => (fresh(), d.clickName(N('Assets')), d.sleep(900)));
st('left-new-canvas', () => (fresh(), d.clickName(/^New canvas$/), d.sleep(600)));
st('left-kind-chip', () => (fresh(), d.clickName(/^Video, 6/), d.sleep(400)));
st('left-search', () => (fresh(), d.ab('fill', '[aria-label="Search canvases"]', 'vid'), d.sleep(500)));
st('left-sort-menu', () => (fresh(), d.clickName(/sort canvases/), d.sleep(400)));
st('left-row-actions', () => (fresh(), d.clickName(/^Actions for Smoke/), d.sleep(400)));
st('left-advanced', () => (fresh(), d.clickName(/^Advanced$/), d.sleep(500)));
st('whatsnew-all', () => (fresh(), d.clickName(/^See all/), d.sleep(600)));
st('project-menu', () => (fresh(), d.clickName(/project menu/), d.sleep(500)));
for (const m of ['File', 'Edit', 'View', 'Help'])
  st(`menu-${m}`, () => (fresh(), d.clickName(/project menu/), d.sleep(400), d.clickName(new RegExp(`^${m}`)), d.sleep(500)));
st('palette', () => (fresh(), key('Meta+k'), d.sleep(500)));
st('palette-typed', () => (fresh(), key('Meta+k'), d.ab('keyboard', 'type', 'exp'), d.sleep(600)));
st('settings', () => (fresh(), key('Meta+,'), d.sleep(700)));
st('keyboard-sheet', () => (fresh(), key('Shift+/'), d.sleep(600)));
st('present-options-off', () => (fresh(), d.clickName(/^Hide panels$/), d.sleep(500)));
st('whatsnew-toast-dismiss', () => (fresh(), d.sleep(300)));

// ---- canvas open (Smoke) ----
st('canvas-smoke', () => canvas('Smoke'));
st('canvas-smoke-artboard', () => (canvas('Smoke'), selectArtboard()));
st('canvas-smoke-object', () => (canvas('Smoke'), selectArtboard(), refClick(/heading "Maude desktop E2E"/), d.sleep(800)));
st('canvas-smoke-share', () => (canvas('Smoke'), d.clickName(/^Share$/), d.sleep(900)));
st('canvas-smoke-export', () => (canvas('Smoke'), key('Meta+Shift+e'), d.sleep(900)));
st('canvas-smoke-history', () => (canvas('Smoke'), d.clickName(/project menu/), d.sleep(300), d.clickName(/^File/), d.sleep(300), d.clickName(/Version history/), d.sleep(900)));
st('canvas-smoke-palette', () => (canvas('Smoke'), key('Meta+k'), d.sleep(500)));
st('canvas-smoke-present-options', () => (canvas('Smoke'), d.clickName(/^Present options$/), d.sleep(500)));
st('canvas-smoke-preview', () => (canvas('Smoke'), d.clickName(/^Preview/), d.sleep(900)));
st('canvas-smoke-layers', () => (canvas('Smoke'), selectArtboard(), d.clickName(N('Layers')), d.sleep(700)));
st('canvas-smoke-assets', () => (canvas('Smoke'), d.clickName(N('Assets')), d.sleep(900)));
st('canvas-smoke-more', () => (canvas('Smoke'), refClick(/button "More"/), d.sleep(500)));
for (const t of ['Pen (P)', 'Shape (R)', 'Image (I)', 'Component'])
  st(`tool-${t.split(' ')[0]}`, () => (canvas('Smoke'), refClick(new RegExp(`button "${t.replace(/[()]/g, '\\$&')}`)), d.sleep(700)));
st('tool-frame-sizes', () => (canvas('Smoke'), key('f'), d.sleep(700)));
st('tool-text-added', () => (canvas('Smoke'), selectArtboard(), key('t'), key('Enter'), d.sleep(900)));
st('canvas-zoom-menu', () => (canvas('Smoke'), d.clickName(/^Zoom /), d.sleep(500)));
st('canvas-smoke-inspector', () => (canvas('Smoke'), selectArtboard(), d.sleep(400)));
st('canvas-smoke-minimap-comment', () => (canvas('Smoke'), key('c'), d.sleep(500)));
st('canvas-ai-chat', () => (canvas('Smoke'), key('Meta+j'), d.sleep(1200)));
st('canvas-comments', () => (canvas('Smoke'), key('Meta+Alt+c'), d.sleep(900)));

// ---- print / video ----
st('canvas-print', () => (canvas('Print'), selectArtboard()));
for (const v of ['Video', 'VideoClipInspect', 'VideoMusic', 'VideoEdit', 'VideoFormats', 'VideoTranscript', 'Cut', 'Export'])
  st(`canvas-${v}`, () => canvas(v));
st('video-clip-timeline', () => (canvas('VideoClipInspect'), refClick(/Open timeline/), d.sleep(1200)));
st('video-clip-selected', () => (canvas('VideoClipInspect'), refClick(/Artboard Clip/), d.sleep(900)));

// ---- empty project (port 4432) ----
st('empty-shell', () => fresh());
st('empty-new-door', () => (fresh(), d.sleep(500)));
st('empty-share-cluster', () => (fresh(), d.clickName(/^Share$/), d.sleep(500)));
// ---- view-only / newer format (port 4434) ----
st('fmt3-shell', () => (fresh(), d.sleep(800)));
st('fmt3-canvas-smoke', () => canvas('Smoke'));
st('fmt3-canvas-artboard', () => (canvas('Smoke'), selectArtboard()));
st('fmt3-project-menu', () => (fresh(), d.clickName(/project menu/), d.sleep(500)));
st('fmt3-comments', () => (canvas('Smoke'), key('c'), d.sleep(500)));
st('fmt3-update-click', () => (canvas('Smoke'), d.clickName(/Update Maude to edit/), d.sleep(900)));
st('fmt3-share', () => (canvas('Smoke'), d.clickName(/^Share$/), d.sleep(900)));
st('fmt3-sync-pill', () => (fresh(), d.clickName(/Local project|Not saved|Saved/), d.sleep(700)));
// ---- more reach (new since 8cd1e3e9a) ----
st('assets-add-menu', () => (canvas('Smoke'), d.clickName(N('Assets')), d.sleep(700), d.clickTid('assets-add'), d.sleep(600)));
st('assets-link-sheet', () => (canvas('Smoke'), d.clickName(N('Assets')), d.sleep(700), d.clickTid('assets-add'), d.sleep(500), d.clickName(/from a link/i), d.sleep(700)));
st('assets-link-typed', () => (canvas('Smoke'), d.clickName(N('Assets')), d.sleep(700), d.clickTid('assets-add'), d.sleep(500), d.clickName(/from a link/i), d.sleep(500), d.ab('keyboard', 'type', 'https://example.com/a.png'), d.sleep(500)));
st('assets-generate', () => (canvas('Smoke'), d.clickName(N('Assets')), d.sleep(700), d.clickTid('assets-generate'), d.sleep(800)));
st('assets-generate-run', () => (canvas('Smoke'), d.clickName(N('Assets')), d.sleep(700), d.clickTid('assets-generate'), d.sleep(600), d.ab('keyboard', 'type', 'a red apple'), key('Enter'), d.sleep(1200)));
st('inspector-text', () => (canvas('Smoke'), selectArtboard(), refClick(/heading "Maude desktop E2E"/), d.sleep(700)));
st('inspector-sticky', () => (canvas('Smoke'), selectArtboard(), refClick(/Sticky seed text/), d.sleep(800)));
st('inspector-standalone', () => (canvas('Smoke'), selectArtboard(), refClick(/Standalone seed/), d.sleep(800)));
st('inspector-card', () => (canvas('Smoke'), selectArtboard(), refClick(/First card body/), d.sleep(800)));
st('comments-panel-view', () => (canvas('Smoke'), d.clickName(/project menu/), d.sleep(300), d.clickName(/^View/), d.sleep(300), d.clickName(/^Comments/), d.sleep(900)));
st('exports-panel-view', () => (canvas('Smoke'), d.clickName(/project menu/), d.sleep(300), d.clickName(/^View/), d.sleep(300), d.clickName(/^Exports/), d.sleep(900)));
st('view-advanced', () => (canvas('Smoke'), d.clickName(/project menu/), d.sleep(300), d.clickName(/^View/), d.sleep(300), d.clickName(/^Advanced/), d.sleep(700)));
st('help-menu-open', () => (canvas('Smoke'), d.clickName(/project menu/), d.sleep(300), d.clickName(/^Help/), d.sleep(600)));
st('canvas-row-menu-open', () => (canvas('Smoke'), d.clickName(/^Actions for Smoke/), d.sleep(500)));
st('canvas-pin-hint', () => (canvas('Smoke'), d.clickName(/^Pin Smoke/), d.sleep(500)));
st('minimap-on', () => (canvas('Smoke'), key('Meta+Alt+m'), d.sleep(600)));
st('video-lane-select', () => (canvas('VideoMusic'), refClick(/Open timeline/), d.sleep(1200), refClick(/Music|lane/i), d.sleep(600)));
st('video-timeline-vm', () => (canvas('VideoMusic'), refClick(/Open timeline/), d.sleep(1400)));
st('video-timeline-cut', () => (canvas('Cut'), refClick(/Open timeline/), d.sleep(1400)));
st('video-timeline-transcript', () => (canvas('VideoTranscript'), refClick(/Open timeline/), d.sleep(1400)));
st('video-preview-play', () => (canvas('Video'), d.clickName(/^Preview/), d.sleep(900)));
st('print-inspector', () => (canvas('Print'), selectArtboard(), d.sleep(400)));
st('present-run', () => (canvas('Smoke'), d.clickName(/^Present$/), d.sleep(1500)));
st('empty-canvas-door', () => (fresh(), d.sleep(300)));
const menuItem = (top, item) => (canvas('Smoke'), d.clickName(/project menu/), d.sleep(300), top && (d.clickName(new RegExp(`^${top}`)), d.sleep(300)), d.clickName(item), d.sleep(900));
st('sheet-import-figma', () => menuItem('File', /^Import from Figma/));
st('sheet-import-brand', () => menuItem('File', /^Import a brand/));
st('sheet-assemble', () => menuItem('File', /^Assemble clips/));
st('sheet-handoff', () => menuItem('File', /^Handoff to production/));
st('sheet-move-to', () => menuItem('File', /^Move to/));
st('sheet-rename', () => menuItem('File', /^Rename canvas/));
st('sheet-new-project', () => menuItem('File', /^New project/));
st('sheet-duplicate', () => menuItem('File', /^Duplicate canvas/));
st('sheet-close-canvas', () => menuItem('File', /^Close canvas/));
st('menu-edit-open', () => menuItem('Edit', /^Undo|^Redo/));
st('help-whats-new', () => menuItem('Help', /What.s new/));
st('help-guides', () => menuItem('Help', /^Tour|^Guides|^Start tour|Keyboard/));
st('settings-general', () => (canvas('Smoke'), key('Meta+,'), d.sleep(700)));
st('settings-advanced', () => (canvas('Smoke'), key('Meta+,'), d.sleep(700), d.clickName(/^Advanced$/), d.sleep(800)));
st('share-advanced', () => (canvas('Smoke'), d.clickName(/^Share$/), d.sleep(800), d.clickName(/^Advanced/), d.sleep(700)));
st('history-advanced', () => (canvas('Smoke'), key('Alt+Meta+h'), d.sleep(900), d.clickName(/^Advanced/), d.sleep(700)));
st('export-advanced', () => (canvas('Smoke'), key('Meta+Shift+e'), d.sleep(900), d.clickName(/^Advanced/), d.sleep(700)));
st('export-other', () => (canvas('Smoke'), key('Meta+Shift+e'), d.sleep(900), d.clickName(/^Other/), d.sleep(700)));
st('face-popover', () => (canvas('Smoke'), d.clickName(/in a browser/), d.sleep(600)));
st('context-menu-artboard', () => (canvas('Smoke'), d.ab('click', '[title="Smoke"]', '--button', 'right'), d.sleep(400)));
st('tool-comment', () => (canvas('Smoke'), key('c'), d.sleep(300), d.ab('click', 'body'), d.sleep(500)));
st('tool-sticky', () => (canvas('Smoke'), key('n'), d.sleep(600)));
st('tool-marker-arrow', () => (canvas('Smoke'), key('a'), d.sleep(600)));
st('mode-preview-toolbar', () => (canvas('Smoke'), key('Alt+Meta+p'), d.sleep(900)));
st('layers-tab-selected', () => (canvas('Smoke'), selectArtboard(), refClick(/Sticky seed text/), d.clickName(N('Layers')), d.sleep(700)));
st('sticky-menu', () => (canvas('Smoke'), selectArtboard(), refClick(/Sticky seed text/), key('Enter'), d.sleep(600)));
st('left-new-canvas-row', () => (fresh(), d.clickName(/^New canvas$/), d.sleep(800)));
st('left-new-folder', () => (fresh(), d.clickName(/^New folder$/), d.sleep(800)));
st('left-canvas-rename', () => (fresh(), d.clickName(/^Actions for Cut/), d.sleep(400), d.clickName(/^Rename/), d.sleep(600)));
st('left-canvas-trash-confirm', () => (fresh(), d.clickName(/^Actions for Cut/), d.sleep(400), d.clickName(/^Move to the trash|^Trash|^Delete/), d.sleep(700)));
st('left-trash-view', () => (fresh(), d.clickTid('canvases-trash'), d.sleep(700)));
st('assets-details', () => (canvas('Smoke'), d.clickName(N('Assets')), d.sleep(700), d.clickTid('assets-tile'), d.sleep(800)));
st('assets-describe', () => (canvas('Smoke'), d.clickName(N('Assets')), d.sleep(700), d.clickName(/Describe/), d.sleep(700)));
st('assets-link-door', () => (canvas('Smoke'), d.clickName(N('Assets')), d.sleep(700), d.clickTid('assets-add-link'), d.sleep(700)));
st('assets-link-door-typed', () => (canvas('Smoke'), d.clickName(N('Assets')), d.sleep(700), d.clickTid('assets-add-link'), d.sleep(500), d.ab('keyboard', 'type', 'https://example.com/a.png'), d.sleep(500)));
st('assets-generate-nokey', () => (canvas('Smoke'), d.clickName(N('Assets')), d.sleep(700), d.clickTid('assets-generate'), d.sleep(500), d.clickName(/Generate/i), d.sleep(900)));
const diag = (item) => (canvas('Smoke'), d.clickName(/project menu/), d.sleep(300), d.clickName(/^Diagnostics/), d.sleep(500), d.clickName(item), d.sleep(1000));
st('diag-sync', () => diag(/^Sync/));
st('diag-server', () => diag(/^Server/));
st('diag-ai-setup', () => diag(/^AI setup/));
st('diag-logs', () => diag(/^Logs/));
st('diag-advanced', () => diag(/^Advanced/));
st('diag-all-checks', () => (diag(/^AI setup/), d.clickName(/^All checks/), d.sleep(700)));
st('diag-logs-filter-ai', () => (diag(/^Logs/), d.clickName(/^AI$/), d.sleep(500)));
st('diag-logs-filter-typed', () => (diag(/^Logs/), d.ab('fill', 'input[placeholder="Filter"]', 'server'), d.sleep(500)));
st('diag-recheck', () => (diag(/^AI setup/), d.clickName(/^Re-check|^Check again/), d.sleep(1500)));
st('comment-placed', () => (canvas('Smoke'), key('c'), d.sleep(300), refClick(/button "Artboard /), d.sleep(900)));
st('comment-typed', () => (canvas('Smoke'), key('c'), d.sleep(300), refClick(/button "Artboard /), d.sleep(700), d.ab('keyboard', 'type', 'Make this bigger'), d.sleep(500)));
st('fmt3-comment-placed', () => (canvas('Smoke'), key('c'), d.sleep(300), refClick(/button "Artboard /), d.sleep(900)));
// ---- native shell stub (AB_SESSION=native AB_INIT=tauri-stub.js) ----
st('native-shell', () => canvas('Smoke'));
st('native-ai-ask', () => (canvas('Smoke'), d.clickName(/^Ask AI/), d.sleep(1500)));
st('native-ai-typed', () => (canvas('Smoke'), d.clickName(/^Ask AI/), d.sleep(1200), d.ab('keyboard', 'type', 'make it bolder'), d.sleep(500)));
st('native-ai-advanced', () => (canvas('Smoke'), d.clickName(/^Ask AI/), d.sleep(1200), d.clickName(/^Advanced/), d.sleep(800)));
st('native-ai-slash', () => (canvas('Smoke'), d.clickName(/^Ask AI/), d.sleep(1200), d.ab('keyboard', 'type', '/'), d.sleep(700)));
st('native-ai-attach', () => (canvas('Smoke'), d.clickName(/^Ask AI/), d.sleep(1200), d.clickName(/Attach|Add/), d.sleep(600)));
st('native-settings-connections', () => (canvas('Smoke'), key('Meta+,'), d.sleep(700), d.clickName(/Connections/), d.sleep(900)));
st('native-project-menu', () => (canvas('Smoke'), d.clickName(/project menu/), d.sleep(500)));
st('native-menu-Diagnostics', () => (canvas('Smoke'), d.clickName(/project menu/), d.sleep(400), d.clickName(/^Diagnostics/), d.sleep(600)));
// ---- design system project (port 4433) ----
st('ds-left-system', () => (fresh(), d.clickName(/^Advanced$/), d.sleep(500)));
st('ds-ds-menu', () => (fresh(), d.clickName(/Design systems?/), d.sleep(600)));
st('ds-preview-menu', () => (canvas('Home'), d.clickName(/^Present options$/), d.sleep(600)));
st('ds-canvas-home-artboard', () => (canvas('Home'), selectArtboard()));
st('ds-shell', () => (fresh(), d.sleep(800)));
st('ds-left', () => (fresh(), d.sleep(500)));
st('ds-canvas-home', () => canvas('Home'));
st('ds-open-system', () => (fresh(), d.clickName(/Acme|Design system/), d.sleep(2800)));

const only = process.argv[5] === 'list';
if (!only) {
  d.ab('set', 'viewport', '1600', '1000');
  d.ab('set', 'media', 'reduced-motion');
}
if (!only) console.log('theme now', d.setTheme(BASE, theme));
const t0 = Date.now();
for (const [name, fn] of S) {
  if (!filter.test(name)) continue;
  if (only) {
    console.log(name);
    continue;
  }
  try {
    fn();
  } catch (e) {
    console.log(`ERR ${name} ${e}`);
    continue;
  }
  d.shot(`${theme}-${name}`);
  d.scan(name, theme);
  esc();
}
console.log('done', Math.round((Date.now() - t0) / 1000), 's');
