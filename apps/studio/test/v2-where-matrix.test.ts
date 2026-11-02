// S11.15 — the context matrix (06 · ad-edge-where): ten Advanced rows × five places, held to the code.
//
// The matrix (client/v2/advanced/where-matrix.js) is data. This file computes every cell FROM THE SURFACE'S
// OWN CODE — the registry's `visible` / `enabled` through the real project menu, `fileMenuItems`,
// `buildShareLinks`, `sheetView`, `hiddenMenuIds` + `menuStatuses`, `advancedAccess`, `gitSurface`,
// `sectionsFor`, `saveStatus` — and fails on the first row that disagrees. Then, for everything the matrix
// hides from Can comment, it asks the server's own gate (access/request.ts `writeCapability`, access/roles.ts
// `can`) and expects the refusal: hidden is not refused, and refused is not hidden.
//
// Two cells are OPEN QUESTIONS (OPEN below): the code and the proposed canvas disagree on something that
// changes behaviour, so each is pinned at what the code does today and handed back for a decision. The pin
// goes red the day either side moves.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeCapability } from '../access/request.ts';
import { can } from '../access/roles.ts';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { isVisible } from '../actions/resolve.ts';
import { buildShareLinks, normalizeOpenPath } from '../client/share-link.js';
import {
  CONTEXT_IDS,
  cellText,
  hiddenRows,
  isReadOnlyFacts,
  ROW_IDS,
  WHERE_CONTEXTS,
  WHERE_FACTS,
  WHERE_ROWS,
  whereCell,
} from '../client/v2/advanced/where-matrix.js';
import { hiddenMenuIds, menuStatuses } from '../client/v2/diagnostics/diagnostics-model.js';
import { gitSurface } from '../client/v2/history/git-model.js';
import { advancedAccess } from '../client/v2/inspector/advanced.jsx';
import { fileMenuItems } from '../client/v2/left-panel/canvas-file-menu.js';
import { sectionsFor } from '../client/v2/settings/settings-model.js';
import { sheetView } from '../client/v2/share/share-model.js';
import { buildProjectMenu, menuCtx } from '../client/v2/shell/project-menu-model.js';
import { accessStatus, saveStatus } from '../client/v2/shell/save-status.js';

type Facts = (typeof WHERE_FACTS)[keyof typeof WHERE_FACTS];
type Got = { kind: string; label?: string };

const show = (label?: string): Got =>
  label === undefined ? { kind: 'show' } : { kind: 'show', label };

// ── the registry, through the real project menu ─────────────────────────────────────────────────────────

const ctxOf = (f: Facts) =>
  menuCtx({
    native: f.native,
    cloudTab: f.cloudTab,
    readOnly: isReadOnlyFacts(f),
    canvasOpen: true,
    linkedHub: f.linked,
    online: f.online,
  });

/** The syncStatus the shell holds in each place: a linked project's payload (with a file plane), or none. */
const syncStatusOf = (f: Facts) =>
  f.linked ? { state: f.online ? 'online' : 'offline', queuedOps: 0, files: {} } : null;

interface MenuNode {
  type: string;
  id?: string;
  label?: string;
  disabled?: boolean;
  children?: MenuNode[];
  advanced?: boolean;
  status?: { word: string };
}

function diagnosticsAdvanced(f: Facts) {
  const cloud = f.cloudTab ? { role: f.role } : null;
  const ctx = ctxOf(f);
  const hidden = hiddenMenuIds({ cloud, syncStatus: syncStatusOf(f) });
  const status = menuStatuses({
    syncStatus: syncStatusOf(f),
    wsConnected: true,
    cloud,
    info: { address: 'localhost:4399', pid: 4242, folder: '/Users/x/p' },
  });
  const model = buildProjectMenu(ctx, { hidden, status }) as MenuNode[];
  const diag = model.find((n) => n.type === 'sub' && n.label === 'Diagnostics');
  const adv = diag?.children?.find((n) => n.type === 'sub' && n.advanced);
  const rows = new Map((adv?.children ?? []).map((n) => [n.id, n]));
  return { rows, server: (diag?.children ?? []).find((n) => n.id === 'diag.server') };
}

// ── one probe per row: what the surface's own code says in this place ───────────────────────────────────

const PROBES: Record<string, (f: Facts) => Got> = {
  'save-status': (f) => {
    if (isReadOnlyFacts(f)) {
      const a = accessStatus({ canEdit: false, role: 'viewer' });
      return show(a?.word);
    }
    const s = saveStatus({ linked: f.linked, online: f.online, phase: f.linked ? 'synced' : null });
    return show(s.word);
  },

  'reveal-open': (f) => {
    const role = f.role;
    const items = fileMenuItems({ role, native: f.native }).map((i: { id: string }) => i.id);
    const ctx = ctxOf(f);
    const reg = ['canvas.reveal-in-finder', 'canvas.open-in-editor'].map((id) =>
      isVisible(ACTIONS_BY_ID.get(id as never) as never, ctx)
    );
    // the menu and the registry (⌘K) must say the same thing about the two native doors
    expect(reg.every(Boolean), 'registry vs menu').toBe(items.includes('reveal'));
    if (items.includes('reveal')) return show();
    if (items.includes('open-mac-app')) {
      const label = fileMenuItems({ role, native: f.native }).find(
        (i: { id: string }) => i.id === 'open-mac-app'
      )?.label;
      return { kind: 'swap', label };
    }
    return { kind: 'hidden' };
  },

  terminal: (f) => {
    const def = ACTIONS_BY_ID.get('chat.open-in-terminal' as never);
    return isVisible(def as never, ctxOf(f)) ? show() : { kind: 'hidden' };
  },

  'this-mac-link': (f) => {
    const links = buildShareLinks({
      rel: normalizeOpenPath('ui/a.tsx', '.design'),
      shell: f.cloudTab ? 'cloud' : f.native ? 'native' : 'local',
      location: { origin: 'https://alligators.cloud.maude.sh', pathname: '/' },
      linkedHubUrl: f.linked ? 'https://alligators.cloud.maude.sh' : undefined,
      project: 'alligators',
      localUrl: 'http://localhost:4399',
      readOnly: isReadOnlyFacts(f),
    });
    return links.local ? show() : { kind: 'hidden' };
  },

  'link-rules': (f) => {
    const ro = isReadOnlyFacts(f);
    const posture = f.linked
      ? {
          linked: true,
          reachable: f.online,
          access: { roles: ['member', 'owner'], scopes: ['project'], links: true, requests: false },
          you: { invite: !ro },
        }
      : { linked: false };
    const me = f.linked ? { role: f.role, caps: { invite: !ro, edit: !ro } } : null;
    const v = sheetView({ posture, me, target: { rel: 'ui/a.tsx', label: 'a' }, project: 'x' });
    if (!v.linked) return { kind: 'swap' };
    if (!v.reachable) return { kind: 'greyed' };
    return v.showLinkRow || v.canInvite ? show() : { kind: 'hidden' };
  },

  'diag-values': (f) => {
    const { rows, server } = diagnosticsAdvanced(f);
    const values = ['diag.address', 'diag.process', 'diag.project-folder'];
    if (values.every((id) => rows.has(id))) return show();
    if (values.every((id) => !rows.has(id)) && server?.status?.word)
      return { kind: 'swap', label: server.status.word };
    return { kind: 'hidden' };
  },

  'resync-download': (f) => {
    const { rows } = diagnosticsAdvanced(f);
    const resync = rows.get('sync.resync');
    const download = rows.get('sync.download-all');
    if (!resync && !download) return { kind: 'hidden' };
    if (!resync && download) return { kind: 'swap', label: 'Download all only' };
    if (resync?.disabled || download?.disabled) return { kind: 'greyed' };
    return show();
  },

  'raw-css': (f) => {
    const a = advancedAccess(
      { readOnly: isReadOnlyFacts(f) },
      f.role === 'comment' ? 'viewer' : null
    );
    if (!a.canCode) return { kind: 'hidden' };
    return a.canEdit ? show() : { kind: 'readonly' };
  },

  git: (f) => {
    const s = gitSurface({
      role: f.role,
      native: f.native,
      cellManaged: f.cloudTab,
      cloudManaged: false,
      repo: f.repo,
      online: f.online,
    }) as { mode: string; canWrite: boolean; publishWaits?: boolean };
    if (s.mode !== 'full') return { kind: 'hidden' };
    return s.publishWaits ? { kind: 'greyed' } : show();
  },

  'settings-this-mac': (f) => {
    const sections = sectionsFor(f.cloudTab ? { role: f.role } : null, isReadOnlyFacts(f));
    return sections.some((s: { id: string }) => s.id === 'advanced') ? show() : { kind: 'hidden' };
  },
};

/** Cells where the code and the proposed canvas disagree on behaviour — pinned at what the code does today. */
const OPEN: Record<string, Got> = {
  // Download all in a browser tab / for Can comment: the canvas keeps "Download all only", but the route
  // behind it (POST /_api/sync/offline) is a Can edit write and a cloud cell has no sync runtime to run it.
  'resync-download/browser': { kind: 'hidden' },
  // Settings › Advanced for a read-only session: V2-4.9 (settings-model.js head) gives it General only.
  'settings-this-mac/comment': { kind: 'hidden' },
};

// ── tests ───────────────────────────────────────────────────────────────────────────────────────────────

describe('the matrix is complete and shaped like the canvas', () => {
  test('ten rows, five places, every cell a known kind', () => {
    expect(WHERE_ROWS.length).toBe(10);
    expect(WHERE_CONTEXTS.map((c) => c.id)).toEqual([
      'app',
      'browser',
      'comment',
      'local',
      'offline',
    ]);
    for (const row of WHERE_ROWS)
      for (const id of CONTEXT_IDS) {
        const c = whereCell(row.id, id);
        expect(c, `${row.id}/${id}`).toBeTruthy();
        expect(['show', 'hidden', 'swap', 'greyed', 'readonly']).toContain(c?.kind);
        if (c?.kind === 'swap' || c?.kind === 'greyed')
          expect(c.label, `${row.id}/${id}`).toBeTruthy();
      }
    expect(cellText(whereCell('resync-download', 'offline')!)).toBe('greyed:back online');
    expect(Object.keys(WHERE_FACTS).sort()).toEqual([...CONTEXT_IDS].sort());
  });

  test('it says what 06 · ad-edge-where draws (the canvas is the source)', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', '..', '..', '.design', 'ui', 'v2', '06 Advanced.tsx'),
      'utf8'
    );
    const block = src.slice(
      src.indexOf('const WHERE_ROWS'),
      src.indexOf('function EdgeWhereBoard')
    );
    const drawn = [...block.matchAll(/\["([^"]+)", "[^"]+", \[(.*?)\]\],?\n/g)];
    expect(drawn.length).toBe(WHERE_ROWS.length);
    const kindOf = (s: string | undefined) =>
      s === 'hide' ? 'hidden' : s === 'grey' ? 'greyed' : s === 'swap' ? 'swap' : 'show';
    drawn.forEach((m, i) => {
      const row = WHERE_ROWS[i];
      expect(row.label).toBe(m[1]);
      const cells = [...m[2].matchAll(/\{ t: "([^"]+)"(?:, s: "([a-z]+)")? \}/g)];
      expect(cells.length).toBe(5);
      cells.forEach((c, j) => {
        const mine = row.cells[CONTEXT_IDS[j] as keyof typeof row.cells];
        const want = kindOf(c[2]);
        // the canvas draws a read-only cell as a swap ("read-only · Copy CSS")
        const ok = mine.kind === want || (mine.kind === 'readonly' && want === 'swap');
        expect(ok, `${row.id}/${CONTEXT_IDS[j]}: ${cellText(mine)} vs ${c[1]}`).toBe(true);
        if (mine.kind === 'show' && mine.label) expect(mine.label, row.id).toBe(c[1]);
        if (mine.kind === 'swap') expect(mine.label, row.id).toBe(c[1]);
      });
    });
  });
});

describe('every row, in every place, is what the matrix says', () => {
  for (const row of WHERE_ROWS)
    for (const ctxId of CONTEXT_IDS) {
      const key = `${row.id}/${ctxId}`;
      test(key, () => {
        const want = whereCell(row.id, ctxId)!;
        const got = PROBES[row.id](WHERE_FACTS[ctxId as keyof typeof WHERE_FACTS]);
        if (key in OPEN) {
          // pinned: the code today, until the open question is answered either way
          expect(got.kind, `${key} (open question)`).toBe(OPEN[key].kind);
          return;
        }
        expect(got.kind, `${key}: matrix ${cellText(want)}`).toBe(want.kind);
        // words are compared where the surface says one: a status word, a swap label, a grey reason
        if (want.kind === 'show' && want.label) expect(got.label, key).toBe(want.label);
        if (want.kind === 'swap' && got.label) expect(got.label, key).toBe(want.label);
      });
    }

  test('every probe exists for every row', () => {
    expect(Object.keys(PROBES).sort()).toEqual([...ROW_IDS].sort());
  });
});

describe('hidden is not refused: what the matrix hides from Can comment, the server refuses', () => {
  const comment = 'viewer'; // Can comment on the wire
  const hiddenFromComment = hiddenRows('comment');

  test('the matrix hides at least git, terminal and the This Mac link from Can comment', () => {
    const ids = hiddenFromComment.map((r) => r.id);
    for (const id of ['git', 'terminal', 'this-mac-link', 'link-rules', 'reveal-open'])
      expect(ids).toContain(id);
  });

  test('each hidden row names a write the gate refuses, or why there is no route', () => {
    for (const row of hiddenFromComment) {
      const named =
        row.serverRoutes.length > 0 ||
        row.native === true ||
        typeof row.noServerCapability === 'string';
      expect(named, `${row.id} names no refusal`).toBe(true);
      for (const route of row.serverRoutes) {
        const cap = writeCapability(route);
        expect(can(comment, cap), `${row.id}: ${route} needs ${cap}`).toBe(false);
        expect(can('observer', cap), `${row.id}: ${route} for Can view`).toBe(false);
        expect(can('member', cap), `${row.id}: ${route} for an editor`).toBe(true);
      }
    }
  });

  test('a read-only cell (raw CSS) and a greyed/swapped write are refused as well', () => {
    for (const id of ['raw-css', 'resync-download', 'git']) {
      const row = WHERE_ROWS.find((r) => r.id === id)!;
      for (const route of row.serverRoutes)
        expect(can(comment, writeCapability(route)), `${id}: ${route}`).toBe(false);
    }
  });

  test('what stays open to Can comment is on purpose and named', () => {
    const git = WHERE_ROWS.find((r) => r.id === 'git')!;
    for (const [route, why] of Object.entries(git.notRefused ?? {})) {
      expect(why).toBeTruthy();
      expect(can(comment, writeCapability(route)), route).toBe(true);
    }
  });

  test('OPEN QUESTION — Download all is shown to Can comment but the gate refuses it (a dead row)', () => {
    // POST /_api/sync/offline is not in SESSION_WRITES, so it is a Can edit write. The canvas keeps
    // "Download all only" for Jonas. Pinned until the owner decides: hide it, or make it a session write.
    expect(can(comment, writeCapability('/_api/sync/offline'))).toBe(false);
  });
});
