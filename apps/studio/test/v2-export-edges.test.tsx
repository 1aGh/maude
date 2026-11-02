// S8.9 — Export edge states (09 ex-edges): who gets the sheet (per role) and what it says while AI is
// still changing the artboard. Slice decision Q1: Can comment sees the sheet with ONE line; Can view
// has no sheet (the server's 403 is S9.9 — pinned below against the real access classifier).
//
// Two halves: the pure models (no DOM) and the real sheet under happy-dom + React.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { writeCapability } from '../access/request.ts';
import { ACCESS_LINE_COMMENT, exportAccess } from '../client/v2/export/access-line.jsx';
import {
  aiHint,
  aiOnTarget,
  clockTime,
  HANDOFF_NEEDS_EDIT,
  VERSION_NOW_NOTIME,
  VERSION_WAIT,
  versionNowTitle,
} from '../client/v2/export/sections/version.jsx';
import { setExportPeople } from '../client/v2/export/use-export-spec.js';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const FILE = '.design/ui/combine.tsx';
const run = (over: Record<string, unknown> = {}) => ({
  runId: 'r_aaaaaaaa',
  state: 'running',
  actor: 'you',
  label: 'Make the date bigger',
  leases: [{ canvas: `path:${FILE}`, artboard: 'a1', token: 1 }],
  waiting: [],
  ...over,
});
const view = (over: Record<string, unknown> = {}) => ({
  seq: 1,
  mine: [run()],
  others: [],
  needsYou: 0,
  live: 1,
  ...over,
});

describe('who may export: one answer per role', () => {
  // the four roles the project has: owner and member edit; viewer = Can comment; observer = Can view
  const roles: Array<[string, { canEdit: boolean; role: string }, string]> = [
    ['owner', { canEdit: true, role: 'owner' }, 'edit'],
    ['member', { canEdit: true, role: 'member' }, 'edit'],
    ['viewer', { canEdit: false, role: 'viewer' }, 'comment'],
    ['observer', { canEdit: false, role: 'observer' }, 'view'],
  ];
  test.each(roles)('%s', (_name, access, level) => {
    const a = exportAccess(access);
    expect(a.level).toBe(level);
    expect(a.canExport).toBe(level !== 'view');
    expect(a.canHandoff).toBe(level === 'edit');
    expect(a.line).toBe(level === 'comment' ? ACCESS_LINE_COMMENT : null);
  });

  test('a desktop project (no access object) is the owner’s', () => {
    expect(exportAccess(null)).toEqual({
      level: 'edit',
      canExport: true,
      canHandoff: true,
      line: null,
    });
  });

  test('the line is the decided one, in the product’s words', () => {
    expect(ACCESS_LINE_COMMENT).toBe(
      'You can comment on this project. Exporting is fine — it makes a copy and changes nothing.'
    );
  });

  test('the server agrees with the sheet: every export route is the EXPORT class (403 for Can view is S9.9)', () => {
    for (const p of ['/_api/export', '/_api/export-jobs', '/_api/export-jobs/download'])
      expect(writeCapability(p)).toBe('export');
  });
});

describe('AI still changing the artboard — the model', () => {
  const scope = { activeCanvas: FILE };
  test('a run of mine on the picked artboard', () => {
    const w = aiOnTarget(view(), { ...scope, scope: 'selection', artboards: ['a1'] });
    expect(w).toEqual({ working: true, mine: true, label: 'Make the date bigger', who: null });
  });
  test('the active artboard stands in for an empty selection', () => {
    expect(
      aiOnTarget(view(), { ...scope, scope: 'selection', artboards: [], activeArtboardId: 'a1' })
        .working
    ).toBe(true);
  });
  test('another artboard, or a run that is only waiting in line, is not "changing this artboard"', () => {
    expect(aiOnTarget(view(), { ...scope, scope: 'selection', artboards: ['zzz'] }).working).toBe(
      false
    );
    expect(
      aiOnTarget(view({ mine: [run({ state: 'waiting', leases: [] })] }), {
        ...scope,
        scope: 'canvas',
      }).working
    ).toBe(false);
  });
  test('This canvas: any artboard of it counts; Folder and Whole project never do', () => {
    expect(aiOnTarget(view(), { ...scope, scope: 'canvas' }).working).toBe(true);
    expect(aiOnTarget(view(), { ...scope, scope: 'folder' }).working).toBe(false);
    expect(aiOnTarget(view(), { ...scope, scope: 'project' }).working).toBe(false);
  });
  test('someone else’s AI is named, and is not waitable', () => {
    const v = view({
      mine: [],
      others: [
        {
          runId: 'r_bbbbbbbb',
          actor: 'Tereza',
          state: 'running',
          label: 'Blue button',
          artboards: [{ canvas: `path:${FILE}`, artboard: 'a1' }],
          waitingFor: [],
        },
      ],
    });
    const w = aiOnTarget(v, { ...scope, scope: 'selection', artboards: ['a1'] });
    expect(w.working).toBe(true);
    expect(w.mine).toBe(false);
    expect(w.who).toBe('Tereza');
  });
  test('words: the hint, and "From 14:05" when the time is known', () => {
    expect(aiHint('Make the date bigger')).toBe(
      'AI is changing this artboard right now — “Make the date bigger”.'
    );
    expect(aiHint(null, 'Tereza')).toBe('Tereza’s AI is changing this artboard right now.');
    const t = new Date(2026, 9, 6, 14, 5).getTime();
    expect(clockTime(t)).toBe('14:05');
    expect(versionNowTitle(t)).toBe('From 14:05');
    expect(versionNowTitle(null)).toBe(VERSION_NOW_NOTIME);
  });
});

// ── the sheet ────────────────────────────────────────────────────────────────────────────────────
interface Call {
  method: string;
  url: string;
  body?: { v?: number; spec?: Record<string, unknown> };
}
let calls: Call[] = [];
const realFetch = globalThis.fetch;
const EST = {
  counts: { selection: 1, canvas: 3, folder: null, project: null },
  files: 1,
  bytes: 1_100_000,
  seconds: 1,
  lane: 'this-mac',
  byKind: { digital: { artboards: 1, files: 1, format: 'png' } },
  skipped: [],
};
function stubFetch() {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/_api/export-history')) return json({ history: [] });
    if (url.endsWith('/_api/export-estimate')) return json(EST);
    if (url.endsWith('/_api/export-jobs')) return json({ jobId: 'job-1' }, 202);
    return json({}, 404);
  }) as typeof fetch;
}

let root: Root | null = null;
let host: HTMLElement | null = null;
beforeEach(() => {
  try {
    localStorage.clear();
  } catch {}
  setExportPeople([]);
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  globalThis.fetch = realFetch;
});

const tick = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const click = async (sel: string) => {
  const el = $(sel);
  expect(el !== null).toBe(true);
  await act(async () => {
    el?.click();
    await tick(10);
  });
};
const posts = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/_api/export-jobs'));

async function mountSheet(props: Record<string, unknown> = {}) {
  stubFetch();
  const { ExportSheet } = await import('../client/v2/export/export-sheet.jsx');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <ExportSheet
        mode="export"
        activePath={FILE}
        designRel=".design"
        exportLane="local"
        hasSelection
        selectedArtboards={['a1']}
        selectionLabel="Pozvánka · story"
        onClose={() => {}}
        {...props}
      />
    );
    await tick();
  });
  await act(async () => {
    await tick();
  });
}

describe('the sheet per role', () => {
  test('owner and member: the sheet as drawn — no access line, no AI line without a run', async () => {
    for (const role of ['owner', 'member']) {
      await mountSheet({ access: { canEdit: true, role }, aiRuns: view({ mine: [], live: 0 }) });
      expect($('[data-testid="export-sheet"]') !== null).toBe(true);
      expect($('[data-testid="export-access-line"]')).toBeNull();
      expect($('[data-testid="export-ai-hint"]')).toBeNull();
      expect($('[data-testid="export-row-version"]')).toBeNull();
      act(() => root?.unmount());
      host?.remove();
    }
  });

  test('viewer (Can comment): the same sheet with one line on top; Handoff needs Can edit', async () => {
    await mountSheet({
      access: { canEdit: false, role: 'viewer' },
      aiRuns: view({ mine: [], live: 0 }),
    });
    expect($('[data-testid="export-sheet"]') !== null).toBe(true);
    expect(text('[data-testid="export-access-line"]')).toBe(ACCESS_LINE_COMMENT);
    // the format row and Export are all there
    expect($('[data-testid="export-format-png"]') !== null).toBe(true);
    expect(
      $('[data-testid="export-submit"]') !== null ||
        $('[data-testid="export-submit-label"]') !== null
    ).toBe(true);
    await click('[data-testid="export-other"]');
    const row = $('[data-testid="export-format-shadcn"]');
    expect(row?.getAttribute('data-reason')).toBe('Needs Can edit');
    expect(row?.getAttribute('aria-disabled')).toBe('true');
  });

  test('observer (Can view): there is no sheet', async () => {
    await mountSheet({ access: { canEdit: false, role: 'observer' } });
    expect($('[data-testid="export-sheet"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Export');
  });

  test('a ⇧⌘H opener cannot land a Can comment person on Handoff', async () => {
    await mountSheet({
      mode: 'handoff',
      access: { canEdit: false, role: 'viewer' },
      aiRuns: view({ mine: [], live: 0 }),
    });
    expect($('[data-testid="export-sheet"]')?.getAttribute('data-mode')).toBe('export');
    expect(HANDOFF_NEEDS_EDIT).toBe('Handoff to production needs Can edit.');
  });
});

describe('the sheet while AI is changing the artboard', () => {
  test('both options, "From 14:05" first and chosen; exporting posts NO wait', async () => {
    const at = new Date(2026, 9, 6, 14, 5).getTime();
    await mountSheet({ aiRuns: view(), lastFinishedAt: at });
    expect(text('[data-testid="export-ai-hint"]')).toBe(
      'AI is changing this artboard right now — “Make the date bigger”.'
    );
    expect(text('[data-testid="export-version-now"]')).toContain('From 14:05');
    expect(text('[data-testid="export-version-now"]')).toContain(
      'The last finished version. Exports now.'
    );
    expect(text('[data-testid="export-version-wait"]')).toContain(VERSION_WAIT);
    expect(text('[data-testid="export-version-wait"]')).toContain(
      'Exports by itself when AI is done.'
    );
    expect($('[data-testid="export-version"]')?.getAttribute('data-value')).toBe('now');
    await click('[data-testid="export-submit"]');
    expect(posts()).toHaveLength(1);
    expect(posts()[0].body?.spec?.wait).toBeUndefined();
  });

  test('"Wait for AI" posts wait:ai on the same spec', async () => {
    await mountSheet({ aiRuns: view() });
    await click('[data-testid="export-version-wait"]');
    expect($('[data-testid="export-version"]')?.getAttribute('data-value')).toBe('ai');
    await click('[data-testid="export-submit"]');
    expect(posts()).toHaveLength(1);
    expect(posts()[0].body?.spec).toMatchObject({
      v: 2,
      scope: 'selection',
      format: 'png',
      wait: 'ai',
    });
  });

  test('the run ends while the sheet is open: the choice goes away and nothing waits', async () => {
    await mountSheet({ aiRuns: view() });
    await click('[data-testid="export-version-wait"]');
    // the same sheet, re-rendered with the run gone
    const { ExportSheet } = await import('../client/v2/export/export-sheet.jsx');
    await act(async () => {
      root?.render(
        <ExportSheet
          mode="export"
          activePath={FILE}
          designRel=".design"
          exportLane="local"
          hasSelection
          selectedArtboards={['a1']}
          aiRuns={view({ mine: [], live: 0 })}
          onClose={() => {}}
        />
      );
      await tick();
    });
    expect($('[data-testid="export-row-version"]')).toBeNull();
    await click('[data-testid="export-submit"]');
    expect(posts()[0].body?.spec?.wait).toBeUndefined();
  });

  test('someone else’s AI: named in the line, no wait offered (this Mac cannot keep that wait)', async () => {
    await mountSheet({
      aiRuns: view({
        mine: [],
        others: [
          {
            runId: 'r_bbbbbbbb',
            actor: 'Tereza',
            state: 'running',
            label: 'Blue button',
            artboards: [{ canvas: `path:${FILE}`, artboard: 'a1' }],
            waitingFor: [],
          },
        ],
      }),
    });
    expect(text('[data-testid="export-ai-hint"]')).toContain(
      'Tereza’s AI is changing this artboard'
    );
    expect($('[data-testid="export-row-version"]')).toBeNull();
  });
});
