// V2-4.9 — one studio, seven shells: the v2 shell parity contract.
//
// client/v2/shell/shell-parity.js derives, for desktop · local browser · cloud owner / member / viewer ·
// local read-only link · embed, which chrome each shell has and — for every absence — the one line of why.
// This file pins four things:
//
//   1. the table itself (shape, the probe's seven shells, a reason for every absence, the committed JSON
//      the desktop e2e reads is not stale);
//   2. the table against the REAL components — the Share cluster and the left panel are rendered per shell
//      and must carry exactly the testids the table lists;
//   3. the two lead decisions: a read-only session gets Settings › General (and nothing of the Mac's), and a
//      cloud tab says where the AI chat lives instead of staying silent;
//   4. the embed is governed: `set-mode { preview, caps: none }` rides the V2-4.3b lane.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import { PROBE_IDS } from '../../../scripts/v2-manifest/reach-rules.mjs';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { holds } from '../actions/resolve.ts';
import { initialMode, MODE_TOOLS, NO_CAPS, visibleSlots } from '../bridge/canvas-modes.ts';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import { DockSlot } from '../client/shell/dock.jsx';
import { actionSearchRows, settingsSearchRows } from '../client/v2/search/search-model.js';
import { rowShown, SETTINGS_ROWS, sectionsFor } from '../client/v2/settings/settings-model.js';
import { capsFor, setModeMessage } from '../client/v2/shell/canvas-mode.js';
import { ModeSwitch } from '../client/v2/shell/mode-switch.jsx';
import { panelAvailable } from '../client/v2/shell/panel-availability.js';
import { buildProjectMenu, menuCtx } from '../client/v2/shell/project-menu-model.js';
import { accessStatus, saveStatus } from '../client/v2/shell/save-status.js';
import { ShareCluster } from '../client/v2/shell/share-cluster.jsx';
import {
  buildParity,
  CONDITIONAL_ROWS,
  PARTS,
  parityFor,
  SHELL_IDS,
  SHELLS,
  shellIdOf,
} from '../client/v2/shell/shell-parity.js';

const STUDIO = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(STUDIO, rel), 'utf8');
const COMMITTED = JSON.parse(read('client/v2/shell/shell-parity.json'));
const noop = () => {};

type Part = { present: boolean; why?: string; [k: string]: unknown };
const part = (id: string, name: string) =>
  (parityFor(id).parts as unknown as Record<string, Part>)[name];
const NOT_EMBED = SHELL_IDS.filter((id) => id !== 'embed');
const VIEWERS = ['cloud-viewer', 'viewer'];
const EDITORS = ['desktop', 'browser', 'cloud-owner', 'cloud-member'];

describe('the table', () => {
  test('the seven shells are the nothing-deleted probe’s, in its order', () => {
    expect(SHELL_IDS).toEqual(PROBE_IDS);
  });

  test('the committed shell-parity.json is the table (run `bun scripts/gen-shell-parity.mjs`)', () => {
    expect(COMMITTED).toEqual(JSON.parse(JSON.stringify(buildParity())));
  });

  test('every shell has every part, and every absence says why', () => {
    for (const id of SHELL_IDS) {
      const parts = parityFor(id).parts as unknown as Record<string, Part>;
      expect(Object.keys(parts).sort(), id).toEqual([...PARTS].sort());
      for (const name of PARTS) {
        const p = parts[name];
        expect(typeof p.present, `${id}/${name}`).toBe('boolean');
        if (!p.present)
          expect(String(p.why ?? '').length, `${id}/${name} says why`).toBeGreaterThan(8);
      }
    }
  });

  test('a running shell names itself from what it can read — the e2e’s identification', () => {
    for (const s of SHELLS) {
      const by = s.by as {
        embed?: boolean;
        native?: boolean;
        cloudRole?: string | null;
        readOnly?: boolean;
      };
      expect(shellIdOf(by), s.id).toBe(s.id);
    }
    // the hub's Can view role (`observer`) is the viewer chrome, minus every toolbar
    expect(shellIdOf({ cloudRole: 'observer', readOnly: true })).toBe('cloud-viewer');
    expect(shellIdOf({ native: true, cloudRole: 'owner' })).toBeNull();
  });

  test('the embed has no chrome at all — only a governed canvas', () => {
    const parts = parityFor('embed').parts as unknown as Record<string, Part>;
    for (const name of PARTS) if (name !== 'canvas') expect(parts[name].present, name).toBe(false);
    expect(parts.canvas).toMatchObject({
      present: true,
      governed: true,
      setMode: { mode: 'preview', caps: NO_CAPS },
    });
  });
});

describe('the menu: one tree, per-shell rows derived from the registry', () => {
  const rows = (id: string) => (part(id, 'menu').rows as string[]) ?? [];

  test('Settings and the Share / Export / History / Help entries are in every shell with a pill', () => {
    for (const id of NOT_EMBED)
      for (const row of [
        'settings.open',
        'share.open',
        'export.open',
        'history.open',
        'help.shortcuts',
      ])
        expect(rows(id), `${id} ${row}`).toContain(row);
  });

  test('“Back to Home”: the Home tab on the desktop, the dashboard in a cloud tab, absent elsewhere', () => {
    expect(part('desktop', 'back-to-home')).toMatchObject({ present: true, opens: 'the Home tab' });
    for (const id of ['cloud-owner', 'cloud-member', 'cloud-viewer'])
      expect(part(id, 'back-to-home'), id).toMatchObject({
        present: true,
        label: 'Back to Home',
        opens: 'the cloud dashboard',
      });
    for (const id of ['browser', 'viewer', 'embed'])
      expect(part(id, 'back-to-home').present, id).toBe(false);
    expect(CONDITIONAL_ROWS['nav.home']).toBeTruthy(); // …and a hub with no dashboard leaves it out
  });

  test('“Sign in as another account” is the desktop’s and a cloud tab’s (a cloud tab’s ends the session)', () => {
    for (const id of ['desktop', 'cloud-owner', 'cloud-member', 'cloud-viewer'])
      expect(rows(id), id).toContain('account.switch');
    for (const id of ['browser', 'viewer']) expect(rows(id), id).not.toContain('account.switch');
  });

  test('a cloud tab has no Resync / Download all (the hub refuses them); a local shell does', () => {
    for (const id of ['cloud-owner', 'cloud-member', 'cloud-viewer'])
      for (const r of ['sync.resync', 'sync.download-all'])
        expect(rows(id), `${id} ${r}`).not.toContain(r);
    for (const id of ['desktop', 'browser'])
      for (const r of ['sync.resync', 'sync.download-all'])
        expect(rows(id), `${id} ${r}`).toContain(r);
    // S11.15: a read-only session keeps Download all and loses Resync (a Can edit write; 06 ad-edge-where)
    expect(rows('viewer')).toContain('sync.download-all');
    expect(rows('viewer')).not.toContain('sync.resync');
    const absent = (COMMITTED.shells['cloud-member'].parts.menu.absent ?? {}) as Record<
      string,
      string
    >;
    expect(absent['sync.resync']).toMatch(/hub refuses/);
  });

  // V2-4 gate (roles): the rows V2-4.9 found a Can comment viewer still offered. Editors keep every one.
  const VIEWER_ABSENT: [string, string][] = [
    ['canvas.new', 'creates a canvas in this project (V2-1.7 §5.9)'],
    ['video.assemble', 'writes a new video canvas'],
    ['select.all-annotations', 'annotations are selected to change them; annotate is Can edit'],
    ['artboard.new-desktop', 'inserts into the open canvas'],
    ['artboard.new-laptop', 'inserts into the open canvas'],
    ['artboard.new-tablet', 'inserts into the open canvas'],
    ['artboard.new-mobile', 'inserts into the open canvas'],
    ['artboard.new-a4', 'inserts into the open canvas'],
    ['artboard.new-letter', 'inserts into the open canvas'],
  ];
  const VIEWER_GREYED: [string, string][] = [
    ['edit.undo', 'the stack holds edits only; ⌘Z says the denial line'],
    ['edit.redo', 'as Undo'],
    [
      'edit.cut',
      'its canvas branch cuts annotations (⌘X stays WebKit’s, for the comment composer)',
    ],
    ['edit.paste', 'its canvas branch pastes annotations (⌘V stays WebKit’s)'],
    ['edit.paste-properties', 'writes styles'],
  ];
  const VIEWER_KEPT = ['project.new', 'project.open', 'edit.copy', 'edit.copy-properties'];
  test('a Can comment viewer is not offered an edit (V2-4 gate roles pass)', () => {
    for (const id of VIEWERS) {
      const m = COMMITTED.shells[id].parts.menu;
      const absent = (m.absent ?? {}) as Record<string, string>;
      for (const [r, why] of VIEWER_ABSENT) {
        expect(m.rows, `${id} ${r}: ${why}`).not.toContain(r);
        expect(absent[r], `${id} ${r}`).toMatch(/needs edit rights/);
      }
      for (const [r, why] of VIEWER_GREYED) {
        expect(m.rows, `${id} ${r}`).toContain(r);
        expect(m.disabled, `${id} ${r}: ${why}`).toContain(r);
      }
      for (const r of VIEWER_KEPT) expect(m.rows, `${id} ${r}`).toContain(r);
    }
    for (const id of EDITORS) {
      const m = COMMITTED.shells[id].parts.menu;
      for (const [r] of [...VIEWER_ABSENT, ...VIEWER_GREYED]) {
        expect(m.rows, `${id} ${r}`).toContain(r);
        expect(m.disabled, `${id} ${r}`).not.toContain(r);
      }
    }
  });

  test('the table’s rows are what the pill’s own model builds', () => {
    for (const id of NOT_EMBED) {
      const by = parityFor(id).by as {
        native: boolean;
        cloudRole: string | null;
        readOnly: boolean;
      };
      const ctx = menuCtx({
        native: by.native,
        cloudTab: !!by.cloudRole,
        readOnly: by.readOnly,
        canvasOpen: true,
      });
      const flat: string[] = [];
      const walk = (ns: Array<{ type: string; id?: string; children?: unknown[] }>) => {
        for (const n of ns) {
          if (n.type === 'item') flat.push(n.id as string);
          if (n.type === 'sub') walk(n.children as never);
        }
      };
      walk(
        buildProjectMenu(ctx, {
          // a cloud tab: no sync runtime of its own, and no process / folder to copy (S11.15)
          hidden: by.cloudRole
            ? [
                'diag.address',
                'diag.process',
                'diag.project-folder',
                'sync.resync',
                'sync.download-all',
              ]
            : [],
        }) as never
      );
      expect(new Set(flat), id).toEqual(new Set(rows(id)));
    }
  });
});

describe('the Share cluster, rendered per shell', () => {
  function cluster(id: string) {
    const by = parityFor(id).by as { native: boolean; cloudRole: string | null; readOnly: boolean };
    const role = by.cloudRole ?? undefined;
    const caps = capsFor({ canEdit: !by.readOnly, role });
    const ctx = menuCtx({
      native: by.native,
      cloudTab: !!by.cloudRole,
      readOnly: by.readOnly,
      canvasOpen: true,
    });
    return renderToStaticMarkup(
      <ShareCluster
        faces={[]}
        status={saveStatus({ linked: !!by.cloudRole })}
        access={accessStatus({ canEdit: !by.readOnly, role })}
        ctx={ctx}
        run={noop}
        canShare
        mode={initialMode(caps)}
        modeSlot={<ModeSwitch mode={initialMode(caps)} caps={caps} onSelect={noop} canPresent />}
      />
    );
  }
  const has = (html: string, testid: string) => html.includes(`data-testid="${testid}"`);

  test('every testid the table lists is on screen — and the action is Share OR Ask to edit, never both', () => {
    for (const id of NOT_EMBED) {
      const html = cluster(id);
      const sc = part(id, 'share-cluster') as unknown as { testids: string[]; action: string };
      for (const t of sc.testids) expect(has(html, t), `${id} ${t}`).toBe(true);
      expect(has(html, 'share-cluster-share'), id).toBe(!VIEWERS.includes(id));
      expect(has(html, 'share-cluster-ask'), id).toBe(VIEWERS.includes(id));
      expect(
        html.includes(`>${sc.action}<`) || html.includes(sc.action),
        `${id} ${sc.action}`
      ).toBe(true);
    }
  });

  test('a viewer says what it can do (Can comment) and has Viewing, not a greyed Edit', () => {
    for (const id of VIEWERS) {
      const html = cluster(id);
      expect(html, id).toContain('Can comment');
      expect(has(html, 'palette-mode-viewing'), id).toBe(true);
      expect(has(html, 'palette-mode-edit'), id).toBe(false);
    }
    for (const id of EDITORS) {
      const html = cluster(id);
      expect(has(html, 'palette-mode-edit'), id).toBe(true);
      expect(has(html, 'palette-mode-viewing'), id).toBe(false);
      expect(html, id).not.toContain('Can comment');
    }
  });

  test('the mode switch carries the segments the table says', () => {
    for (const id of NOT_EMBED) {
      const html = cluster(id);
      const ms = part(id, 'mode-switch') as unknown as { testids: string[] };
      for (const t of ms.testids) expect(has(html, t), `${id} ${t}`).toBe(true);
    }
  });
});

describe('the left panel and the right islands', () => {
  test('Canvases · Layers · Assets in every shell with chrome — a reader inspects, it does not just look', () => {
    for (const id of NOT_EMBED) {
      const lp = part(id, 'left-panel') as unknown as { tabs: string[] };
      expect(lp.tabs, id).toEqual(['tree', 'layers', 'assets']);
      const html = renderToStaticMarkup(
        <DockSlot
          side="left"
          width={300}
          open
          ids={lp.tabs}
          activeId="tree"
          onPick={noop}
          onFold={noop}
          floating
        >
          <aside className="st-sidebar" />
        </DockSlot>
      );
      for (const t of lp.tabs) expect(html, `${id} ${t}`).toContain(`data-testid="panel-tab-${t}"`);
    }
  });

  test('Inspector, Comments and History are in every shell with chrome (read-only means cannot change, not cannot see)', () => {
    for (const id of NOT_EMBED)
      for (const p of ['inspector', 'comments', 'history'])
        expect(part(id, p).present, `${id} ${p}`).toBe(true);
    for (const id of VIEWERS) expect(part(id, 'inspector').readOnly, id).toBe(true);
  });

  test('the AI chat island is the desktop’s alone; nobody else mounts the agent', () => {
    for (const id of SHELL_IDS) {
      const native = id === 'desktop';
      expect(part(id, 'ai-chat').present, id).toBe(native);
    }
    expect(panelAvailable('assistant', { native: true, viewerMode: true })).toBe(false);
    expect(panelAvailable('assistant', { native: false })).toBe(false);
    expect(panelAvailable('inspector', { viewerMode: true })).toBe(true);
    expect(panelAvailable('layers', { layersMode: 'inspector' })).toBe(false);
    expect(panelAvailable('sync', {})).toBe(false); // the dock's Sync panel is retired (S11.12b)
  });

  test('the dock hook asks the same rule the table does', () => {
    const hook = read('client/hooks/use-palette-and-panels.jsx');
    expect(hook).toContain("from '../v2/shell/panel-availability.js'");
    expect(hook).toContain('panelAvailableIn(id,');
  });
});

describe('the toolbars, per mode and role', () => {
  test('editors: Edit + Preview; viewers: Viewing + Preview with Hand and Comment — never a greyed tool', () => {
    for (const id of EDITORS) {
      const t = part(id, 'toolbars') as unknown as {
        role: string;
        modes: Record<string, string[]>;
      };
      expect(Object.keys(t.modes), id).toEqual(['edit', 'preview']);
      expect(t.modes.edit, id).toEqual(visibleSlots('edit', 'edit').map((s) => s.label));
      expect(t.modes.edit, id).toContain('Select');
    }
    for (const id of VIEWERS) {
      const t = part(id, 'toolbars') as unknown as {
        role: string;
        modes: Record<string, string[]>;
      };
      expect(Object.keys(t.modes), id).toEqual(['viewing', 'preview']);
      expect(t.modes.viewing, id).toEqual(['Hand', 'Comment']);
      expect(t.modes.preview, id).toEqual(['Hand', 'Comment']);
    }
  });

  test('Can view (the hub’s observer) has no toolbar at all; the embed neither', () => {
    for (const mode of ['edit', 'viewing', 'preview'] as const)
      expect(visibleSlots(mode, 'view'), mode).toEqual([]);
    expect(MODE_TOOLS.present.hidden).toBe(true);
  });
});

describe('lead decision (b): a cloud tab says where the AI chat lives', () => {
  const desktopCtx = menuCtx({ native: true, canvasOpen: true });
  const cloudCtx = menuCtx({ cloudTab: true, canvasOpen: true });
  const cloudViewerCtx = menuCtx({ cloudTab: true, readOnly: true, canvasOpen: true });
  const browserCtx = menuCtx({ canvasOpen: true });
  const viewerCtx = menuCtx({ readOnly: true, canvasOpen: true });
  const chat = (ctx: ReturnType<typeof menuCtx>) =>
    actionSearchRows(ctx).find((r: { actionId: string }) => r.actionId === 'ai.chat');

  test('⌘K lists “AI chat — in the desktop app”, greyed, in both cloud roles', () => {
    for (const ctx of [cloudCtx, cloudViewerCtx]) {
      const row = chat(ctx);
      expect(row?.name).toBe('AI chat — in the desktop app');
      expect(row?.disabled).toBe(true);
    }
  });

  test('on the desktop it is a plain, enabled “AI chat”', () => {
    const row = chat(desktopCtx);
    expect(row?.name).toBe('AI chat');
    expect(row?.disabled).toBe(false);
  });

  test('a local browser and a read-only link have no cloud story to tell: no row', () => {
    expect(chat(browserCtx)).toBeUndefined();
    expect(chat(viewerCtx)).toBeUndefined();
  });

  test('the table records the row, and the registry predicate is the one place that says so', () => {
    for (const id of ['cloud-owner', 'cloud-member', 'cloud-viewer'])
      expect(
        (part(id, 'ai-chat') as unknown as { search: { row: string; disabled: boolean } }).search
      ).toEqual({
        row: 'AI chat — in the desktop app',
        disabled: true,
      });
    const def = ACTIONS_BY_ID.get('ai.chat');
    expect(holds(def?.visible, cloudCtx)).toBe(true);
    expect(holds(def?.enabled, cloudCtx)).toBe(false);
    expect(holds(def?.enabled, desktopCtx)).toBe(true);
  });

  test('the menu runner answers a click on the greyed row with where it lives, never silence', () => {
    const runner = read('client/v2/shell/menu-runner.js');
    expect(runner).toMatch(
      /'ai\.chat': \(\) => \{\s*if \(!d\.native\) \{\s*d\.toast\('AI chat is in the Maude desktop app\.'\)/
    );
  });
});

describe('lead decision (a): a read-only session has Settings › General', () => {
  test('the model: General only for a read-only session, in every shell; the Mac’s sections stay the desktop owner’s', () => {
    expect(sectionsFor(null).map((s) => s.id)).toEqual(['general', 'connections', 'advanced']);
    expect(sectionsFor(null, true).map((s) => s.id)).toEqual(['general']); // the local read-only link
    expect(sectionsFor({ role: 'viewer' }, true).map((s) => s.id)).toEqual(['general']); // cloud viewer
    expect(sectionsFor({ role: 'owner' }).map((s) => s.id)).toEqual(['general']); // a cloud owner
  });

  test('the table: every shell with a pill has Settings; sections follow the rule', () => {
    for (const id of NOT_EMBED) {
      const s = part(id, 'settings') as unknown as { sections: string[] };
      expect(s.present, id).toBe(true);
      expect(s.sections, id).toEqual(
        id === 'desktop' || id === 'browser' ? ['general', 'connections', 'advanced'] : ['general']
      );
    }
  });

  test('a viewer’s Settings rows are the person’s: theme, Inspector words, canvas and view, panel positions', () => {
    for (const id of VIEWERS) {
      const rows = (part(id, 'settings').rows as Array<{ testid: string; section: string }>).map(
        (r) => r.testid
      );
      for (const t of [
        'settings-theme',
        'settings-inspector-vocabulary',
        'settings-canvas-view',
        'panel-side-<id>',
      ])
        expect(rows, `${id} ${t}`).toContain(t);
      expect(
        (part(id, 'settings').rows as Array<{ section: string }>).every(
          (r) => r.section === 'general'
        ),
        id
      ).toBe(true);
    }
    // the cloud viewer keeps the dashboard link its hub told the tab about; a local link has no account row
    expect(
      rowShown(SETTINGS_ROWS.find((r) => r.testid === 'settings-open-dashboard') as never, {
        cloud: { role: 'viewer' },
        readOnly: true,
      })
    ).toBe(true);
    expect(
      rowShown(SETTINGS_ROWS.find((r) => r.testid === 'settings-open-dashboard') as never, {
        cloud: null,
        readOnly: true,
      })
    ).toBe(false);
  });

  test('⌘K finds no local-machine setting for a read-only session', () => {
    const owner = settingsSearchRows({ cloud: null });
    const viewer = settingsSearchRows({ cloud: null, readOnly: true });
    expect(owner.some((r: { section: string }) => r.section === 'advanced')).toBe(true);
    expect(viewer.length).toBeGreaterThan(0);
    expect(viewer.every((r: { section: string }) => r.section === 'general')).toBe(true);
  });

  test('⌘, opens Settings for a viewer (it used to be swallowed)', () => {
    const keys = read('client/actions/shell-key-handlers.js');
    const body = keys.slice(
      keys.indexOf("'settings.open': (d,"),
      keys.indexOf("'view.timeline-keep-open'")
    );
    expect(body).toContain('d.setSettingsOpen(true)');
    expect(body).not.toContain('viewerMode');
    expect(read('client/app.jsx')).toMatch(
      /<SettingsSheet\s+cloud=\{cfg\.cloud\}\s+readOnly=\{viewerMode\}/
    );
  });
});

// ── the sheet, rendered ─────────────────────────────────────────────────────────────────────────
type Call = { url: string; method: string };
let calls: Call[] = [];
const realFetch = globalThis.fetch;
let SettingsSheet: (props: Record<string, unknown>) => React.ReactElement;
const roots: Root[] = [];
const SHEET_PROPS = {
  theme: 'dark',
  onSetTheme: noop,
  cpMode: 'advanced',
  onSetCpMode: noop,
  minimapVisible: true,
  onToggleMinimap: noop,
  zoomCtlVisible: true,
  onToggleZoomCtl: noop,
  annotationsVisible: true,
  onToggleAnnotations: noop,
  autoOpenInspector: false,
  onToggleAutoOpenInspector: noop,
  hasCanvas: true,
  panelSide: {},
  onSetPanelSide: noop,
  layersMode: 'separate',
  onSetLayersMode: noop,
  onLinkedHub: noop,
  onLocalProject: noop,
  onClose: noop,
};

describe('the Settings sheet, rendered per shell', () => {
  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    SettingsSheet = (await import('../client/v2/settings/settings-sheet.jsx'))
      .default as unknown as typeof SettingsSheet;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    GlobalRegistrator.unregister();
  });
  beforeEach(() => {
    calls = [];
    globalThis.fetch = (async (url: string, init?: { method?: string }) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      return new Response(JSON.stringify({ ok: true, connected: false }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      localStorage.clear();
    } catch {}
  });
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
  });

  async function mountFor(id: string) {
    const by = parityFor(id).by as { native: boolean; cloudRole: string | null; readOnly: boolean };
    const cloud = by.cloudRole
      ? { role: by.cloudRole, dashboardUrl: 'https://cloud.example/dashboard' }
      : null;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(<SettingsSheet {...SHEET_PROPS} cloud={cloud} readOnly={by.readOnly} />)
    );
    await act(async () => new Promise((r) => setTimeout(r, 60)));
  }
  const tabs = () =>
    [...document.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('data-testid'));

  test('the tabs are the table’s sections; the General rows are the table’s rows', async () => {
    for (const id of NOT_EMBED) {
      await mountFor(id);
      const s = part(id, 'settings') as unknown as {
        sections: string[];
        rows: Array<{ testid: string; section: string; conditional?: boolean }>;
      };
      expect(tabs(), id).toEqual(s.sections.map((x) => `settings-tab-${x}`));
      for (const r of s.rows.filter((x) => x.section === 'general' && !x.conditional)) {
        const prefix = r.testid.split('<')[0];
        expect(
          document.querySelector(`[data-testid^="${prefix}"]`),
          `${id} ${r.testid}`
        ).not.toBeNull();
      }
      for (const r of roots.splice(0)) await act(async () => r.unmount());
      document.body.innerHTML = '';
    }
  });

  test('a read-only link asks the host for nothing of the Mac’s — no keychain, engine, sync or account route', async () => {
    for (const id of VIEWERS) {
      calls = [];
      await mountFor(id);
      for (const forbidden of ['/_api/cloud', '/_api/generate', '/_api/figma', '/_api/sync'])
        expect(
          calls.some((c) => c.url.startsWith(forbidden)),
          `${id} ${forbidden}`
        ).toBe(false);
      for (const r of roots.splice(0)) await act(async () => r.unmount());
      document.body.innerHTML = '';
    }
  });

  test('the local read-only link has no “Account” group; the cloud viewer keeps its dashboard link', async () => {
    await mountFor('viewer');
    expect(document.querySelector('[data-testid="settings-account"]')).toBeNull();
    expect(document.querySelector('[data-testid="settings-open-dashboard"]')).toBeNull();
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
    await mountFor('cloud-viewer');
    expect(document.querySelector('[data-testid="settings-open-dashboard"]')).not.toBeNull();
  });
});

// ── the embed ───────────────────────────────────────────────────────────────────────────────────
describe('the embed is governed', () => {
  test('the seed carries set-mode { preview, caps: none } and the dgn table accepts it', () => {
    const msg = setModeMessage({ seq: 1, mode: 'preview', caps: NO_CAPS });
    expect(msg).toMatchObject({
      dgn: 'set-mode',
      v: 2,
      mode: 'preview',
      caps: { edit: false, annotate: false, comment: false },
    });
    const spec = DGN_TABLE.s2c['set-mode'];
    expect(spec.parse(msg as unknown as Record<string, unknown>)).toMatchObject({
      mode: 'preview',
      caps: { edit: false, annotate: false, comment: false },
    });
    // the canvas clamps Preview + no caps to itself: nothing to show but the design
    expect(visibleSlots('preview', 'view')).toEqual([]);
  });

  test('embed-view.jsx sends it with a seq that only grows, over the same ladder as the rest of the seed', () => {
    const src = read('client/embed-view.jsx');
    expect(src).toContain("import { NO_CAPS } from '../bridge/canvas-modes.ts'");
    expect(src).toContain("setModeMessage({ seq: ++modeSeq, mode: 'preview', caps: NO_CAPS })");
    // …and it stays inside the seed(), which the ladder re-sends
    const seed = src.slice(src.indexOf('const seed = () =>'), src.indexOf('const loaded = () =>'));
    expect(seed).toContain('setModeMessage(');
  });
});
