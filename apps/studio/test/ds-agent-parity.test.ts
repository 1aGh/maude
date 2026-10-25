// S10.21 — rule 14 for the design system: every `ds.*` action a person can take, the AI can take too, and both land
// the SAME versioned files. Per the action's declared agent kind (actions/agents.ts):
//   · cli  — the UI leg (the client write function the button calls, against project A's real route table) and the
//            verb leg (`execDsPlan(planDsVerb(words))` through project B's studio) leave identical `.design/` trees
//            (versioned files only; `_*` runtime state skipped; times, action ids and the tmp root normalised).
//   · file (canvas-tsx) — the edit op the button posts ≡ the hand edit the registry's `agent` text describes.
//   · exempt — navigation, a human-only door, or nothing to write; each named with its reason, matched to its kind.
// A coverage assertion holds DS_ACTIONS ≡ cases ∪ exempt ∪ elsewhere, so a new ds.* action is a red test until it is
// placed. Real routes, real engine, a real local home (the in-process kernel); never this repo's `.design`.
import { afterAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { LOCAL_OWNER } from '../access/request.ts';
import { AGENT_PATHS } from '../actions/agents.ts';
import { DS_ACTIONS } from '../actions/defs/ds.ts';
import { runCheck } from '../client/v2/ds/advanced-host.jsx';
import { convertSystems, restoreSystemFolder } from '../client/v2/ds/convert-model.js';
import { setDefaultSystem } from '../client/v2/ds/default-write.js';
import {
  canvasUpdateNow,
  clearTokenNow,
  restoreTokenNow,
  trashedTokenItems,
} from '../client/v2/ds/door-write.js';
import {
  addColourNow,
  applyNearestNow,
  fixContrastNow,
  trashTokenNow,
} from '../client/v2/ds/edge-write.js';
import {
  linkLibrary,
  loadLibraryReview,
  takeLibraryUpdate,
  unlinkLibrary,
} from '../client/v2/ds/library-host.jsx';
import {
  finishMaking,
  makeSystem,
  mixDirections,
  useDirection,
} from '../client/v2/ds/make-write.js';
import { writeMaster } from '../client/v2/ds/master-write.js';
import { loadReach } from '../client/v2/ds/reach-data.js';
import { renameSystem } from '../client/v2/ds/rename-write.js';
import { cancelReview, publishReview, pushOverride } from '../client/v2/ds/review-host.jsx';
import { loadSwitchReview, runSwitch } from '../client/v2/ds/switch-host.jsx';
import { switchRows } from '../client/v2/ds/switch-model.js';
import { writeToken } from '../client/v2/ds/token-write.js';
import { writeOutside, writePick } from '../client/v2/ds/truth-host.jsx';
import { writeInstanceUpdate } from '../client/v2/ds/update-available.jsx';
import { fetchDsState } from '../client/v2/ds/use-ds-state.js';
import { execCheckPlan, planCheckVerb } from '../ds/check-system-verb.ts';
import { execDsPlan, planDsVerb } from '../ds/ds-verb.ts';
import type { DsLibrary } from '../ds/library.ts';
import { sha256Hex } from '../ds/revision.ts';
import { EDIT_OPS } from '../edit-ops/dispatch.ts';
import type { ResolvedEditOp } from '../edit-ops/types.ts';
import { createDsUsage } from '../index/ds-usage.ts';
import { createDsRoutes } from '../routes/ds.ts';
import { createDsCheckRoutes } from '../routes/ds-check.ts';
import {
  ACCENT,
  cleanup,
  DS,
  DS_PATH,
  makeProject,
  PERSON,
  type Project,
  TOKENS_CSS,
} from './_ds-engine-fixture.ts';
import { GRANT, LIB, linked, linkingProject, URL_, V2 } from './_ds-library-hub.ts';
import { switchProject } from './_ds-switch-fixture.ts';

afterAll(cleanup);

/* ------------------------------------------------------------------ the two studios */

interface World {
  p: Project;
  lib?: DsLibrary;
  /** the hub the library talks to (a fake one; never a real hub) */
  hub?: { head: string | null };
}

/** The route table a running studio serves for `w` (ds + ds-check), as a fetch. Relative URLs are the page's. */
function studio(w: World) {
  const usage = () =>
    createDsUsage({
      designRoot: () => w.p.designRoot,
      canvases: () =>
        w.p.engine
          .systems()
          .flatMap((s) => w.p.engine.canvasesOf(s.name).map((rel) => ({ rel, ds: s.name }))),
      persist: false,
    });
  const deps = {
    engine: () => w.p.engine,
    access: () => LOCAL_OWNER,
    person: async () => ({ name: PERSON.name }),
    usage,
    ...(w.lib ? { library: () => w.lib as DsLibrary } : {}),
  };
  const specs = [...createDsRoutes(deps), ...createDsCheckRoutes(deps)];
  const last: { body: unknown; sent: unknown } = { body: null, sent: null };
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://127.0.0.1:1');
    const method = init?.method ?? 'GET';
    const spec = specs.find((s) => s.method === method && s.path === u.pathname);
    if (!spec) return new Response(JSON.stringify({ code: 'no-route' }), { status: 404 });
    if (method === 'POST') last.sent = init?.body ? JSON.parse(String(init.body)) : null;
    const res = await spec.handle(new Request(u.toString(), init as RequestInit), {});
    const text = await res.clone().text();
    try {
      last.body = JSON.parse(text);
    } catch {
      last.body = text;
    }
    return res;
  }) as unknown as typeof fetch;
  return { fetchImpl, studio: { base: 'http://127.0.0.1:1' }, last };
}

/** POST one route body (setup steps and the doors the client has no writer for). */
async function post(w: World, route: string, body: unknown) {
  const res = await studio(w).fetchImpl(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/* ------------------------------------------------------------------ the on-disk result */

function walk(root: string, rel = '', out: Record<string, string> = {}): Record<string, string> {
  let names: string[] = [];
  try {
    names = readdirSync(path.join(root, rel));
  } catch {
    return out;
  }
  for (const n of names.sort()) {
    if (n.startsWith('_')) continue; // runtime state (DDR-115): never versioned
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(path.join(root, r)).isDirectory()) walk(root, r, out);
    else out[r] = readFileSync(path.join(root, r), 'utf8');
  }
  return out;
}

/** The versioned `.design/` tree, with what differs run to run (times, action ids, the tmp root) normalised. */
function snapshot(p: Project): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const [rel, text] of Object.entries(walk(p.designRoot)))
    raw[rel] = text
      .split(p.root)
      .join('<root>')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<iso>')
      .replace(/"(at|actionId|writeId)":\s*("[^"]*"|\d+|null)/g, '"$1":"…"');
  // A revision id is the sha256 of its body, and a body can carry a time (a trashed token's `at`): two projects
  // that did the same thing a few ms apart hold different ids. Name each revision by its body with every id and
  // time taken out, so the comparison is over what the revisions SAY.
  const ids = new Map<string, string>();
  for (const rel of Object.keys(raw)) {
    const m = /revisions\/([0-9a-f]{64})\.json$/.exec(rel);
    if (m)
      ids.set(
        m[1],
        `rev:${sha256Hex((raw[rel] as string).replace(/[0-9a-f]{64}/g, '#')).slice(0, 12)}`
      );
  }
  const swap = (t: string) =>
    t
      .replace(/[0-9a-f]{64}/g, (h) => ids.get(h) ?? h)
      .replace(/"sha256":\s*"[0-9a-f]{64}"/g, '"sha256":"…"');
  const out: Record<string, string> = {};
  for (const [rel, text] of Object.entries(raw)) out[swap(rel)] = swap(text);
  return out;
}

const norm = (v: unknown): unknown =>
  JSON.parse(
    JSON.stringify(v ?? null)
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<iso>')
      .replace(/"(at|actionId|writeId)":("[^"]*"|\d+|null)/g, '"$1":"…"')
  );

/* ------------------------------------------------------------------ the cases */

/** The light + dark block of the fixture, with a pair that fails contrast in Dark (`--fg-2` on `--bg-0`). */
const EDGE_CSS = TOKENS_CSS.replace(
  '--fg-0: #111111;',
  '--bg-0: #fbfbf8;\n  --fg-0: #111111;\n  --fg-2: #5a6b60;'
).replace('--fg-0: #eeeeee;', '--bg-0: #141815;\n  --fg-0: #eeeeee;\n  --fg-2: #4d6354;');

const COMPONENTS_JSON = {
  schemaVersion: 1,
  system: DS,
  components: {
    Button: { class: 'btn', export: 'Button', variants: { primary: 'btn--primary', plain: null } },
  },
  typeRoles: { heading: 't-heading', body: 't-body' },
};
const OVERRIDE_CANVAS = `import { Button } from '@maude/ds';\nexport default () => <main><Button data-cd-id="b1" variant="primary" style={{ borderRadius: 6, background: 'tomato' }}>Go</Button></main>;\n`;

const DIRECTION_A = { '--accent': { light: 'oklch(0.5 0.2 30)', dark: 'oklch(0.6 0.2 30)' } };
const DIRECTION_B = { '--accent': { light: 'oklch(0.5 0.2 150)', dark: 'oklch(0.6 0.2 150)' } };
const NOVA = 'nova';

interface Case {
  /** the world both projects start from (default: the converted `acme` project) */
  world?: () => Promise<World>;
  setup?: (w: World) => Promise<void>;
  /** the button: the client's own write function on A */
  ui: (f: typeof fetch, w: World) => Promise<unknown>;
  /** the agent: the words after `maude design ds` on B (a `--set`/`--tokens`/`--grant-file` reads `files`) */
  verb: string[];
  files?: Record<string, unknown>;
  /** an action that writes nothing versioned (a read, the check's `_state/`): compare the answers instead */
  read?: boolean;
}

const waitingAccent = async (w: World) => {
  await w.p.engine.mergePending(DS, {
    tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
    by: PERSON,
  });
};
const linkedWorld = async (): Promise<World> => {
  const L = await linked();
  return { p: L.p, lib: L.lib, hub: L.hub };
};
const linkingWorld = async (): Promise<World> => {
  const L = await linkingProject();
  return { p: L.p, lib: L.lib, hub: L.hub };
};
const making = async (w: World, drafts: Record<string, unknown> = { a: DIRECTION_A }) => {
  await post(w, '/_api/ds/make', { action: 'make', ds: NOVA, label: 'Nova' });
  for (const [direction, tokens] of Object.entries(drafts))
    await post(w, '/_api/ds/make', { action: 'draft', ds: NOVA, direction, tokens });
};

/** The Trash's token row for `css`, built from the state route as the Trash view builds it. */
const trashRow = async (f: typeof fetch, css: string) => {
  const row = trashedTokenItems(await fetchDsState(f)).find((t) => t.css === css);
  if (!row) throw new Error(`no Trash row for ${css}`);
  return row;
};

/** Doors with no client writer. A gap is a finding (named in the hand-back), never silently passed. */
const NO_CLIENT_WRITER: Record<string, string> = {
  // S10.21b wired canvas-update (row menu), restore-token and clear-token (Trash) through door-write.js
  'ds.canvas-leave':
    'open question (S10.21b hand-back) — no canvas or contract row places a standalone "Keep this version"; ' +
    'the review sheet’s untick (ds.publish --leave-out) is the person’s door today',
  'ds.draft': 'by design — the AI writes directions (S10.16a); the person picks one',
};

const CASES: Record<string, Case> = {
  'ds.publish': {
    setup: waitingAccent,
    ui: async (f, w) => {
      const rows = ['ui/Home.tsx', 'ui/Landing.tsx'].map((path) => ({
        path,
        locked: false,
        ticked: path !== 'ui/Landing.tsx',
      }));
      return publishReview({ ds: DS, expectHead: w.p.R0 }, rows, f);
    },
    verb: ['publish', DS, '--leave-out', '.design/ui/Landing.tsx'],
  },
  'ds.cancel-pending': {
    setup: waitingAccent,
    ui: (f) => cancelReview({ ds: DS }, f),
    verb: ['pending', DS, '--cancel'],
  },
  // A Dark value set by hand: it no longer follows (the field the registry's agent text names). The Light edit on a
  // token whose Dark follows is in "Dark follows" below — the engine derives Dark for a Light-only file.
  'ds.set-token': {
    ui: (f) =>
      writeToken({ ds: DS, css: '--x-line-fine', edit: { theme: 'dark', value: '#444444' } }, f),
    verb: ['pending', DS, '--set', 'edit.json'],
    files: {
      'edit.json': {
        tokens: { '--x-line-fine': { dark: '#444444', darkFollows: false } },
        expect: { '--x-line-fine': null },
      },
    },
  },
  'ds.set-dark-follows': {
    ui: (f) => writeToken({ ds: DS, css: '--x-line-fine', edit: { follows: false } }, f),
    verb: ['pending', DS, '--set', 'edit.json'],
    files: {
      'edit.json': {
        tokens: { '--x-line-fine': { darkFollows: false } },
        expect: { '--x-line-fine': null },
      },
    },
  },
  'ds.set-master': {
    setup: async (w) =>
      w.p.write(`${DS_PATH}/components.json`, `${JSON.stringify(COMPONENTS_JSON, null, 2)}\n`),
    ui: (f) =>
      writeMaster({ ds: DS, name: 'Button', edit: { prop: 'border-radius', value: '8px' } }, f),
    verb: ['pending', DS, '--set', 'edit.json'],
    files: {
      'edit.json': { components: { Button: { '.btn': { 'border-radius': { value: '8px' } } } } },
    },
  },
  'ds.review-update': {
    setup: async (w) => {
      w.p.write(`${DS_PATH}/components.json`, `${JSON.stringify(COMPONENTS_JSON, null, 2)}\n`);
      w.p.write('ui/Home.tsx', OVERRIDE_CANVAS);
    },
    ui: (f) =>
      pushOverride(
        {
          ds: DS,
          canvas: 'ui/Home.tsx',
          elementId: 'b1',
          target: { kind: 'component', name: 'Button', variant: 'primary' },
        },
        f
      ),
    verb: ['pending', DS, '--set', 'push.json'],
    files: {
      'push.json': {
        from: {
          canvas: 'ui/Home.tsx',
          elementId: 'b1',
          target: { kind: 'component', name: 'Button', variant: 'primary' },
        },
      },
    },
  },
  'ds.keep-outside': {
    setup: async (w) =>
      w.p.write(
        `${DS_PATH}/colors_and_type.css`,
        TOKENS_CSS.replace(/--fg-0:[^;]+;/, '--fg-0: oklch(0.31 0.02 255);')
      ),
    ui: (f) => writeOutside(DS, 'keep', f),
    verb: ['keep', DS],
  },
  'ds.undo-outside': {
    setup: async (w) =>
      w.p.write(
        `${DS_PATH}/colors_and_type.css`,
        TOKENS_CSS.replace(/--fg-0:[^;]+;/, '--fg-0: oklch(0.31 0.02 255);')
      ),
    ui: (f) => writeOutside(DS, 'undo', f),
    verb: ['undo', DS],
  },
  'ds.pick': {
    setup: async (w) => {
      await waitingAccent(w);
      w.p.write(
        `${DS_PATH}/colors_and_type.css`,
        TOKENS_CSS.replace('oklch(0.55 0.2 255)', 'oklch(0.4 0.1 20)')
      );
    },
    ui: (f) => writePick(DS, '--accent', 'file', f),
    verb: ['pick', DS, '--accent', '--use', 'file'],
  },
  'ds.canvas-update': {
    setup: async (w) => {
      await waitingAccent(w);
      await execDsPlan(planDsVerb(['publish', DS, '--leave-out', 'ui/Landing.tsx']), {
        root: w.p.root,
        ...studio(w),
        by: PERSON,
      });
    },
    // the row menu's Update (canvases-panel.jsx) posts the design-root-relative path
    ui: (f) => canvasUpdateNow({ canvas: 'ui/Landing.tsx' }, f),
    verb: ['canvas', 'update', '.design/ui/Landing.tsx'],
  },
  'ds.canvas-leave': {
    setup: waitingAccent,
    ui: async () => null,
    verb: ['canvas', 'leave', 'ui/Home.tsx'],
  },
  'ds.trash-token': {
    ui: (f) => trashTokenNow({ ds: DS, css: '--x-line-fine', replacement: '--x-line-mid' }, f),
    verb: ['trash', DS, '--x-line-fine', '--replacement', '--x-line-mid'],
  },
  'ds.restore-token': {
    setup: async (w) => {
      await post(w, '/_api/ds/trash', {
        ds: DS,
        css: '--x-line-fine',
        replacement: '--x-line-mid',
      });
    },
    // the Trash's row, read the way the Trash reads it (GET /_api/ds/state → trashedTokenItems)
    ui: async (f) => restoreTokenNow(await trashRow(f, '--x-line-fine'), f),
    verb: ['restore', DS, '--x-line-fine'],
  },
  'ds.clear-token': {
    setup: async (w) => {
      await post(w, '/_api/ds/trash', {
        ds: DS,
        css: '--x-line-fine',
        replacement: '--x-line-mid',
      });
    },
    ui: async (f) => clearTokenNow(await trashRow(f, '--x-line-fine'), f),
    verb: ['clear', DS, '--x-line-fine'],
  },
  'ds.make': {
    ui: (f) => makeSystem({ ds: NOVA, label: 'Nova' }, f),
    verb: ['make', NOVA, '--label', 'Nova'],
  },
  'ds.draft': {
    setup: async (w) => {
      await post(w, '/_api/ds/make', { action: 'make', ds: NOVA, label: 'Nova' });
    },
    ui: async () => null,
    verb: ['draft', NOVA, '--direction', 'a', '--tokens', 'a.json'],
    files: { 'a.json': { tokens: DIRECTION_A } },
  },
  'ds.use-direction': {
    setup: (w) => making(w),
    ui: (f) => useDirection({ ds: NOVA, direction: 'a' }, f),
    verb: ['use', NOVA, 'a'],
  },
  'ds.mix': {
    setup: (w) => making(w, { a: DIRECTION_A, b: DIRECTION_B }),
    ui: (f) => mixDirections({ ds: NOVA, base: 'a', take: { colour: 'b' } }, f),
    verb: ['mix', NOVA, 'a', '--take', 'colour=b'],
  },
  'ds.make-done': {
    setup: async (w) => {
      await making(w);
      await post(w, '/_api/ds/make', { action: 'use', ds: NOVA, direction: 'a' });
    },
    ui: (f) => finishMaking({ ds: NOVA }, f),
    verb: ['done', NOVA],
  },
  'ds.convert': {
    setup: async (w) => {
      const cfg = JSON.parse(w.p.read('config.json') as string);
      cfg.designSystems.push({
        name: 'combine',
        path: 'system/combine',
        themes: ['light', 'dark'],
        themeDefault: 'light',
        rootClass: 'combine',
      });
      w.p.write('config.json', `${JSON.stringify(cfg, null, 2)}\n`);
      w.p.write('system/combine/colors_and_type.css', TOKENS_CSS.replaceAll('acme', 'combine'));
      w.p.write('system/combine/preview/_components.css', '.btn {\n  border-radius: 2px;\n}\n');
    },
    ui: (f) => convertSystems(['combine'], { fetchImpl: f }),
    verb: ['convert', 'combine'],
  },
  'ds.convert-restore': {
    ui: (f) => restoreSystemFolder(DS, { fetchImpl: f }),
    verb: ['convert', DS, '--restore'],
  },
  'ds.set-default': {
    world: async () => ({ p: await switchProject() }),
    ui: (f) => setDefaultSystem('beta', { fetchImpl: f }),
    verb: ['default', 'beta'],
  },
  // P8 round 7 — Rename… (the system's config label)
  'ds.rename': {
    ui: (f) => renameSystem(DS, 'Studio site', { fetchImpl: f }),
    verb: ['rename', DS, 'Studio', 'site'],
  },
  'ds.switch': {
    world: async () => ({ p: await switchProject() }),
    ui: async (f) => {
      const scope = { canvas: 'ui/Home.tsx' };
      const r = await loadSwitchReview({ to: 'beta', scope }, f);
      if (!r.ok) return r;
      return runSwitch({ to: 'beta', scope }, switchRows(r.review), f);
    },
    verb: ['switch', '.design/ui/Home.tsx', '--to', 'beta'],
  },
  'ds.fix-contrast': {
    world: async () => ({ p: await makeProject({ tokensCss: EDGE_CSS }) }),
    ui: (f) => fixContrastNow({ ds: DS, css: '--fg-2' }, f),
    verb: ['fix-contrast', DS, '--fg-2'],
  },
  'ds.add-colour': {
    ui: (f) => addColourNow({ ds: DS, value: '#3b6fe0', label: 'Signal' }, f),
    verb: ['add-colour', DS, '#3b6fe0', '--label', 'Signal'],
  },
  'ds.library-link': {
    world: linkingWorld,
    ui: (f) => linkLibrary(URL_, GRANT, f),
    verb: ['library', 'link', URL_, '--grant-file', 'grant.txt'],
    files: { 'grant.txt': GRANT },
  },
  'ds.library-update': {
    world: linkedWorld,
    setup: async (w) => {
      (w.hub as { head: string | null }).head = V2.id;
    },
    ui: async (f) => {
      const r = await loadLibraryReview(LIB, f);
      if (!r.ok) return r;
      const rows = r.review.canvases.map((c: { path: string }) => ({
        path: c.path,
        locked: false,
        ticked: true,
      }));
      return takeLibraryUpdate({ ds: LIB, review: r.review }, rows, f);
    },
    verb: ['library', 'update', LIB],
  },
  'ds.library-unlink': {
    world: linkedWorld,
    ui: (f) => unlinkLibrary(LIB, f),
    verb: ['library', 'unlink', LIB],
  },
  'ds.show-reach': {
    read: true,
    setup: async (w) =>
      w.p.write(
        'ui/Home.tsx',
        `export default () => <section><h1 style={{ color: 'var(--accent)' }}>Home</h1></section>;\n`
      ),
    ui: (f) => loadReach({ ds: DS, css: '--accent' }, f),
    verb: ['usage', DS, '--css', '--accent'],
  },
  'ds.check-system': {
    read: true,
    ui: (f) => runCheck(DS, f),
    verb: ['check-system', DS],
  },
};

/** The no-writer doors post the route body the registry's `server` names, built from the same words. */
const ROUTE_BODY: Record<string, (w: World) => { route: string; body: unknown }> = {
  'ds.canvas-leave': () => ({
    route: '/_api/ds/canvas',
    body: { canvas: 'ui/Home.tsx', action: 'leave' },
  }),
  'ds.draft': () => ({
    route: '/_api/ds/make',
    body: { action: 'draft', ds: NOVA, direction: 'a', tokens: DIRECTION_A },
  }),
};

/** The tree edits: the op the button posts ≡ the hand edit the registry's `agent.how` describes. */
const TREE_EDITS = ['ds.instance-update', 'ds.use-nearest'] as const;

/** Exempt, with the agent kind the reason rests on (checked against AGENT_PATHS below). */
const EXEMPT: Record<string, { kind: 'navigation' | 'human' | 'none'; why: string }> = {
  'ds.open': { kind: 'navigation', why: 'moves the view (`maude design open`); writes nothing' },
  'ds.go-to': { kind: 'navigation', why: 'moves the view (`maude design open`); writes nothing' },
  'ds.preview': { kind: 'human', why: 'a session-only look; the agent screenshots the canvas URL' },
  'ds.reveal-files': { kind: 'human', why: 'opens Finder on the person’s Mac' },
  'ds.set-theme-preview': {
    kind: 'none',
    why: 'a viewing preference; the agent captures `&dsMode=dark`',
  },
  'ds.handoff-tokens': {
    kind: 'none',
    why: 'the handoff IS tokens.json + colors_and_type.css; nothing written',
  },
};

/** Covered by its own two-studio suite (the in-page ΔE gate needs two headless studios). */
const ELSEWHERE: Record<string, string> = {
  'ds.upgrade':
    'test/ds-upgrade-sheet-flow.test.ts (the verb is `maude design ds-upgrade`, not `ds`)',
};

/* ------------------------------------------------------------------ the legs */

async function verbLeg(c: Case, w: World) {
  const read = (f: string) => {
    const v = c.files?.[f];
    if (v === undefined) throw new Error(`no file ${f}`);
    return typeof v === 'string' ? v : JSON.stringify(v);
  };
  const s = studio(w);
  if (c.verb[0] === 'check-system')
    return execCheckPlan(planCheckVerb(c.verb), { root: w.p.root, ...s });
  return execDsPlan(planDsVerb(c.verb, read), { root: w.p.root, ...s, by: PERSON });
}

async function uiLeg(id: string, c: Case, w: World) {
  const s = studio(w);
  const door = ROUTE_BODY[id];
  if (door) {
    const { route, body } = door(w);
    const r = await post(w, route, body);
    return { said: r.body, raw: r.body, status: r.status };
  }
  const said = await c.ui(s.fetchImpl, w);
  return { said, raw: s.last.body, status: null };
}

describe('every ds.* action: the button ≡ the agent (S10.21, rule 14)', () => {
  for (const [id, c] of Object.entries(CASES)) {
    test(`${id}${NO_CLIENT_WRITER[id] ? ' (route door — no client writer)' : ''}`, async () => {
      const make = c.world ?? (async () => ({ p: await makeProject() }));
      const A = await make();
      const B = await make();
      for (const w of [A, B]) await c.setup?.(w);
      const before = snapshot(A.p);
      expect(snapshot(B.p)).toEqual(before);

      const ui = await uiLeg(id, c, A);
      const verb = await verbLeg(c, B);
      expect({ id, verb: verb.status }).toEqual({ id, verb: 200 });
      if (ui.status !== null) expect({ id, ui: ui.status }).toEqual({ id, ui: 200 });
      else expect({ id, ok: (ui.said as { ok?: boolean } | null)?.ok }).toEqual({ id, ok: true });

      const a = snapshot(A.p);
      const b = snapshot(B.p);
      expect(b).toEqual(a);
      if (c.read) {
        // nothing versioned moved, and the agent read what the button read
        expect(a).toEqual(before);
        expect(norm(verb.body)).toEqual(norm(ui.raw));
      } else {
        // a write that wrote nothing would pass trivially: it must have moved something
        expect(a).not.toEqual(before);
      }
    });
  }

  test('ds.instance-update: the op the button posts ≡ data-ds-rev="head" added after the data-cd-id', async () => {
    const SRC = `import { Button } from '@maude/ds';\nexport default () => <main>\n  <Button data-cd-id="cta" variant="primary">Go</Button>\n  <Button data-cd-id="old" data-ds-rev="${'a'.repeat(64)}">Old</Button>\n</main>;\n`;
    let sent: ResolvedEditOp | null = null;
    const rec = (async (_u: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({ ok: true, writeId: 'w', actionId: null });
    }) as unknown as typeof fetch;
    const op = EDIT_OPS.find((o) => o.id === 'ds.instance-update');
    for (const element of ['cta', 'old']) {
      const r = await writeInstanceUpdate(
        { canvas: 'ui/Home.tsx', ref: { artboard: null, element } },
        rec
      );
      expect(r.ok).toBe(true);
      // the canvas is left out at an old revision (the server puts that in ctx; edit-op dispatch does)
      const req = {
        ...(sent as unknown as ResolvedEditOp),
        params: {},
        ctx: { dsRev: 'b'.repeat(64), variantsOf: () => null },
      } as unknown as ResolvedEditOp;
      expect(req.op).toBe('ds.instance-update');
      const viaOp = op?.apply(SRC, req as never).source;
      // the hand edit: right after its data-cd-id; overwrite the attribute if it has one
      const hand = SRC.replace(
        new RegExp(`data-cd-id="${element}"( data-ds-rev="[^"]*")?`),
        `data-cd-id="${element}" data-ds-rev="head"`
      );
      expect(viaOp).toBe(hand);
    }
  });

  test('ds.use-nearest: the op the button posts ≡ the literal at (line, col) replaced by var(--token)', async () => {
    const SRC = `export default () => (\n  <main>\n    <div data-cd-id="badge" style={{ background: '#3b6fe0', color: '#3b6fe0' }}>Save</div>\n  </main>\n);\n`;
    const line = 3;
    const col = SRC.split('\n')[line - 1].indexOf('#3b6fe0', 0) + 1;
    let sent: ResolvedEditOp | null = null;
    const rec = (async (_u: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
    const finding = { target: { artboard: null, element: 'badge' }, literal: '#3b6fe0', line, col };
    expect(
      (await applyNearestNow({ canvas: 'ui/Home.tsx', finding, css: '--accent' }, rec)).ok
    ).toBe(true);
    const op = EDIT_OPS.find((o) => o.id === 'ds.use-nearest');
    const viaOp = op?.apply(SRC, sent as never).source;
    const lines = SRC.split('\n');
    const L = lines[line - 1];
    lines[line - 1] = `${L.slice(0, col - 1)}var(--accent)${L.slice(col - 1 + '#3b6fe0'.length)}`;
    expect(viaOp).toBe(lines.join('\n'));
  });
});

describe('Dark follows: the engine derives it, so the page and the agent land the same file (S10.21b)', () => {
  /** The agent's plain file on B (`maude design ds pending <ds> --set f.json`). */
  const agentSets = (B: World, file: unknown) =>
    execDsPlan(
      planDsVerb(['pending', DS, '--set', 'f.json'], () => JSON.stringify(file)),
      {
        root: B.p.root,
        ...studio(B),
        by: PERSON,
      }
    );
  const waiting = (w: World, css: string): Record<string, unknown> | null =>
    JSON.parse(w.p.read(`${DS_PATH}/design-system.meta.json`) as string)?.dsPending?.tokens?.[
      css
    ] ?? null;

  test('ds.set-token on Light, Dark following: the page and a Light-only file land the same Dark', async () => {
    const A: World = { p: await makeProject() };
    const B: World = { p: await makeProject() };
    const before = snapshot(A.p);
    const s = studio(A);
    const r = await writeToken(
      { ds: DS, css: '--x-line-fine', edit: { theme: 'light', value: '#cccccc' } },
      s.fetchImpl
    );
    expect(r.ok).toBe(true);
    // the page still sends both (decision v2-S10.21b-page-sends-both): the engine keeps a Dark it is given
    const sent = s.last.sent as { tokens: Record<string, Record<string, string>> };
    expect(Object.keys(sent.tokens['--x-line-fine']).sort()).toEqual(['dark', 'light']);
    // the agent, per agents.ts `ds.set-token`: `tokens[<css>]: <theme>: <value>` — Light only
    const v = await agentSets(B, {
      tokens: { '--x-line-fine': { light: '#cccccc' } },
      expect: { '--x-line-fine': null },
    });
    expect(v.status).toBe(200);
    expect(snapshot(B.p)).toEqual(snapshot(A.p));
    expect(snapshot(A.p)).not.toEqual(before);
  });

  test('ds.set-dark-follows back on: the page and `darkFollows: true` land the same Dark', async () => {
    const A: World = { p: await makeProject() };
    const B: World = { p: await makeProject() };
    for (const w of [A, B])
      await w.p.engine.mergePending(DS, {
        tokens: { '--x-line-fine': { dark: '#202020', darkFollows: false } },
        by: PERSON,
      });
    const before = snapshot(A.p);
    expect(snapshot(B.p)).toEqual(before);
    const r = await writeToken(
      { ds: DS, css: '--x-line-fine', edit: { follows: true } },
      studio(A).fetchImpl
    );
    expect(r.ok).toBe(true);
    const v = await agentSets(B, {
      tokens: { '--x-line-fine': { darkFollows: true } },
      expect: { '--x-line-fine': waiting(B, '--x-line-fine')?.at ?? null },
    });
    expect(v.status).toBe(200);
    expect(snapshot(B.p)).toEqual(snapshot(A.p));
    expect(snapshot(A.p)).not.toEqual(before);
  });

  test('a Dark the entry names itself is kept, never re-derived', async () => {
    const B: World = { p: await makeProject() };
    const v = await agentSets(B, {
      tokens: { '--x-line-fine': { light: '#cccccc', dark: '#010101' } },
      expect: { '--x-line-fine': null },
    });
    expect(v.status).toBe(200);
    expect(waiting(B, '--x-line-fine')?.dark).toBe('#010101');
  });
});

describe('coverage: every ds.* action is placed', () => {
  test('DS_ACTIONS ≡ cases ∪ tree edits ∪ exempt ∪ elsewhere, each once', () => {
    const placed = [
      ...Object.keys(CASES),
      ...TREE_EDITS,
      ...Object.keys(EXEMPT),
      ...Object.keys(ELSEWHERE),
    ];
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed].sort()).toEqual(DS_ACTIONS.map((a) => a.id).sort());
  });

  test('each placement matches the agent kind the registry declares', () => {
    for (const id of Object.keys(CASES)) {
      const a = AGENT_PATHS[id as keyof typeof AGENT_PATHS];
      expect({ id, path: a.agent.path }).toEqual({ id, path: 'cli' });
    }
    for (const id of TREE_EDITS) {
      const a = AGENT_PATHS[id];
      expect({ id, path: a.agent.path, format: (a.agent as { format?: string }).format }).toEqual({
        id,
        path: 'file',
        format: 'canvas-tsx',
      });
    }
    for (const [id, e] of Object.entries(EXEMPT)) {
      const a = AGENT_PATHS[id as keyof typeof AGENT_PATHS];
      const kind =
        a.agent.path === 'cli' && a.agent.verb.startsWith('maude design open ')
          ? 'navigation'
          : a.agent.path === 'human'
            ? 'human'
            : a.effect === 'none'
              ? 'none'
              : 'writes';
      expect({ id, kind }).toEqual({ id, kind: e.kind });
    }
    // the doors without a client writer are named; wiring one makes this list shrink, never silently
    expect(Object.keys(NO_CLIENT_WRITER).sort()).toEqual(Object.keys(ROUTE_BODY).sort());
  });
});
