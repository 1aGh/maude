// The "usable, not just mounted" probe shared by both boot gates (V2-2.12):
//   scripts/check-client-boots-source.mjs      (per PR — source server + release bundle + Playwright)
//   apps/desktop/scripts/check-client-boots.mjs (release — packaged .app + agent-browser)
//
// v0.51.1 shipped a blank window; a mounted-but-dead shell (an overlay that swallows input, a
// handler that throws on the first event, a provider that never resolves) would pass a
// "#root has children" gate just as quietly. PROBE is an in-page async expression, so both gate
// engines run the very same steps and get one JSON verdict back:
//   mounted      #root has children
//   menubar      the menubar row is there
//   menuOpens    clicking the File trigger opens its dropdown (role="menu")
//   menuCloses   Escape closes it again
//   paletteOpens ⌘K opens the command palette
//   paletteCloses Escape closes it
//   tree         the project tree (or its loading placeholder) is there
// From Phase 4 on the steps follow the v2 landmarks (project pill → menu, ⌘K → Search, the mode
// switch posts set-mode); the verdict shape stays.
//
// DEAD_SHELL is the planted fault for the gate's own red test (`--plant-dead`): after mount it
// swallows every click and keydown at the window capture phase, so the DOM is all there and
// nothing answers.

export const PROBE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (sel) => document.querySelector(sel);
  const waitFor = async (fn, ms = 1500) => {
    for (let t = 0; t < ms; t += 50) { if (fn()) return true; await sleep(50); }
    return !!fn();
  };
  const key = (k, extra = {}) => {
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra });
    (document.activeElement || document.body).dispatchEvent(ev);
  };
  const v = { mounted: (document.getElementById('root')?.childElementCount ?? 0) > 0 };
  v.menubar = !!q('[data-testid="menubar"]');
  const file = q('[data-testid="menu-file"]');
  if (file) {
    file.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    file.click();
    v.menuOpens = await waitFor(() => !!q('.st-dropdown[role="menu"]'));
    key('Escape');
    v.menuCloses = v.menuOpens ? await waitFor(() => !q('.st-dropdown[role="menu"]')) : false;
  } else {
    v.menuOpens = false;
    v.menuCloses = false;
  }
  document.body.focus();
  key('k', { metaKey: true });
  v.paletteOpens = await waitFor(() => !!q('[aria-label="Command palette"]'));
  key('Escape');
  v.paletteCloses = v.paletteOpens ? await waitFor(() => !q('[aria-label="Command palette"]')) : false;
  v.tree = !!(q('[data-testid="canvas-list"]') || q('[data-testid="tree-loading"]'));
  v.text = (document.body.innerText || '').length;
  v.rootChildren = document.getElementById('root')?.childElementCount ?? -1;
  return JSON.stringify(v);
})()`;

export const STEPS = [
  'mounted',
  'menubar',
  'menuOpens',
  'menuCloses',
  'paletteOpens',
  'paletteCloses',
  'tree',
];

/** The steps that failed, in order (empty = usable). */
export const failedSteps = (verdict) => STEPS.filter((s) => verdict?.[s] !== true);

export const DEAD_SHELL = `(() => {
  const swallow = (e) => { e.stopImmediatePropagation(); e.preventDefault(); };
  const plant = () => {
    for (const t of ['click', 'mousedown', 'pointerdown', 'keydown'])
      window.addEventListener(t, swallow, true);
  };
  if (document.readyState === 'complete') plant();
  else window.addEventListener('load', plant);
})();`;
