import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { base } from './fx.mjs';

// Fixture: the e2e project + 75 small canvases in 5 folders + Wide (21 artboards) + Uniformy-2027 (Czech artboard names).
export const fixture = base;
export const keepState = false;
export const noRename = false;
const D = '11-projects-and-navigation';

const SEARCH = {
  groups: [
    { pid: 'l1111111111111111', name: 'Studio site', place: 'tab', rows: [
      { key: 'ui/Mobile-detail.tsx', name: 'Mobile — detail', group: 'canvases', kind: 'web', meta: 'ui', boards: 4 },
      { key: 'ui/Homepage.tsx#mobile', name: 'Mobile', group: 'artboards', kind: 'web', meta: '' },
    ] },
    { pid: 'l2222222222222222', name: 'Portfolio 2026', place: 'closed', rows: [
      { key: 'ui/Mobilni-app.tsx', name: 'Mobilní app — case study', group: 'canvases', kind: 'web', meta: 'ui', boards: 12 },
    ] },
  ],
};
export const page = {
  stub: `
  window.__TAURI__ = { core: {
    invoke: async (cmd, args) => {
      const m = localStorage.getItem('__g4mode');
      if (cmd === 'index_search') return ${JSON.stringify(SEARCH)};
      if (cmd === 'take_tabs_restored' && m === 'restored') { localStorage.removeItem('__g4mode'); return { count: 20 }; }
      if (cmd === 'take_pending_navigate' && m === 'deeplink') { localStorage.removeItem('__g4mode'); return { canvas: 'ui/Uniformy-2027.tsx', artboard: 'a-story' }; }
      if (cmd === 'take_link_opened' && m === 'linkopened') { localStorage.removeItem('__g4mode'); return { name: 'Alligators brand' }; }
      return null;
    }, Channel: class { constructor() {} } }, event: { listen: async () => () => {} } };`,
};

const art = (id, label, w = 300, h = 380) => `        <DCArtboard id="${id}" label="${label}" width={${w}} height={${h}}>
          <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", color: "#111", background: "#dfe3ea", height: "100%" }}><h2 style={{ margin: 0 }}>${label}</h2></div>
        </DCArtboard>`;
export async function prepare(project) {
  const ui = join(project, '.design/ui');
  rmSync(join(project, '.design/_canvas-state'), { recursive: true, force: true });
  for (const f of ['2026', 'club-web', 'print', 'social', 'legacy']) {
    mkdirSync(join(ui, f), { recursive: true });
    for (let i = 1; i <= 15; i++) {
      const n = `${f[0].toUpperCase()}${f.slice(1)}-${String(i).padStart(2, '0')}`;
      writeFileSync(join(ui, f, `${n}.tsx`), `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";\nexport default function C() {\n  return (\n    <DesignCanvas>\n      <DCSection id="s" title="${n}">\n${art('a0', n, 200, 140)}\n      </DCSection>\n    </DesignCanvas>\n  );\n}\n`);
    }
  }
  const many = Array.from({ length: 21 }, (_, i) => art(`a${i}`, `Artboard ${i + 1}`, 200, 160)).join('\n');
  writeFileSync(join(ui, 'Wide.tsx'), `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";\nexport default function W() {\n  return (\n    <DesignCanvas>\n      <DCSection id="s" title="Combine campaign">\n${many}\n      </DCSection>\n    </DesignCanvas>\n  );\n}\n`);
  const names = [['a-home', 'Domácí dres 2027'], ['a-away', 'Venkovní dres 2027'], ['a-helmet', 'Helma z boku'], ['a-pants-home', 'Kalhoty doma'], ['a-pants-away', 'Kalhoty venku'], ['a-story', 'Pozvánka · story']];
  writeFileSync(join(ui, 'Uniformy-2027.tsx'), `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";\nexport default function U() {\n  return (\n    <DesignCanvas>\n      <DCSection id="s" title="Uniformy">\n${names.map(([id, l]) => art(id, l)).join('\n')}\n      </DCSection>\n    </DesignCanvas>\n  );\n}\n`);
}

export async function run(h) {
  const { page, sleep, project } = h;
  const ls = async (k, v) => page.evaluate(([a, b]) => localStorage.setItem(a, b), [k, v]);
  await sleep(1500);
  // ── the panel: design system row, pinned, sort ──
  await h.open('ui-uniformy-2027', 2500);
  await page.locator('[data-testid="canvas-pin-ui-uniformy-2027"]').first().click({ force: true }).catch(() => {});
  await sleep(300);
  await page.locator('[data-testid="canvas-pin-ui-wide"]').first().click({ force: true }).catch(() => {});
  await sleep(500);
  await h.click('canvases-sort').catch(() => {});
  await h.step('pn-organise', D, 'pin two canvases (row pin), open the sort menu', async () => {});
  await h.esc(2);
  // ── rename in place / move ──
  await h.step('pn-move', D, 'row menu › Rename (inline edit)', async () => {
    await page.locator('[data-testid="canvas-row-ui-wide"]').first().click({ button: 'right' });
    await sleep(500);
    await page.locator('[data-testid="canvas-menu-rename"]').first().dispatchEvent('click');
    await sleep(700);
  });
  await h.esc(2);
  // ── jump: 21 artboards ──
  await h.open('ui-wide', 3000);
  await h.step('pn-jump', D, 'open Wide (21 artboards), expand the row’s artboard list (jump toggle)', async () => {
    await page.locator('[data-testid="canvas-jump-toggle-ui-wide"]').first().click({ force: true });
    await sleep(900);
  });
  await page.locator('[data-testid="canvas-jump-toggle-ui-wide"]').first().click({ force: true }).catch(() => {});
  // ── trash ──
  await h.step('pn-trash', D, 'row menu › Move to trash, then the Trash row opened', async () => {
    await page.locator('[data-testid="canvas-row-ui-wide"]').first().click({ button: 'right' });
    await sleep(500);
    await page.locator('[data-testid="canvas-menu-trash"]').first().dispatchEvent('click');
    await sleep(1200);
    await h.click('canvases-trash-row');
    await sleep(900);
  }, { notice: true });
  await h.esc(2);
  await h.click('canvases-trash-row').catch(() => {});
  // ── ⌘K: across projects (stubbed shell index_search), artboards by name ──
  await h.open('ui-uniformy-2027', 2500);
  await h.step('pn-k-across', D, '⌘K "mobil": STUBBED Tauri index_search answers two other projects (browser lane has no Rust shell)', async () => {
    await page.keyboard.press('Meta+k');
    await sleep(500);
    await page.keyboard.type('mobil');
    await sleep(1200);
  });
  await h.esc(3);
  await h.step('pn-k-close', D, '⌘K "domaci dres" (no accents) on a canvas of Czech artboard names', async () => {
    await page.keyboard.press('Meta+k');
    await sleep(500);
    await page.keyboard.type('domaci dres');
    await sleep(1000);
  });
  await h.esc(3);
  // ── deep link / restart toast (stubbed shell one-shots) ──
  await ls('__g4mode', 'deeplink');
  await page.reload();
  await sleep(5000);
  await h.step('pn-deeplink', D, 'STUBBED take_pending_navigate {canvas, artboard} (what the shell parks for a maude:// link)', async () => {}, { notice: true });
  await ls('__g4mode', 'restored');
  await page.reload();
  await sleep(4000);
  await h.step('pn-relaunch', D, 'STUBBED take_tabs_restored {count: 20}: the toast the window shows after a restart (the 20 tabs themselves are the native strip)', async () => {}, { notice: true });
  // ── version history ──
  await h.open('ui-uniformy-2027', 2500);
  const f = join(project, '.design/ui/Uniformy-2027.tsx');
  const { readFileSync } = await import('node:fs');
  for (const t of ['Kalhoty doma', 'Kalhoty doma v2']) {
    writeFileSync(f, readFileSync(f, 'utf8').replace(/Kalhoty doma( v2)?/g, t));
    await sleep(2500);
  }
  await page.keyboard.press('Alt+Meta+h');
  await sleep(1500);
  await h.step('pn-history', D, 'edit the canvas file twice (auto-snapshots), ⌥⌘H Version history', async () => {});
}
