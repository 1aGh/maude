// S10.19 (13 · ds-advanced, 06 · ad-ds) — Design system › Advanced and Check the system in the inspector's empty
// place. Pinned: the words of every line (computed by the server, drawn as given), the fold's contents (mono only
// there), what the buttons send, that a stored answer is judged before it is drawn, that a browser tab has no
// Reveal in Finder, the host against the REAL routes and engine, and the nothing-deleted row it closes
// (`A-design-system-folder-path`).
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import { type AccessClaim, resolveAccess } from '../access/scope.ts';
import { DsAdvanced } from '../client/v2/ds/advanced.jsx';
import {
  onDsAdvancedRequest,
  requestDsAdvanced,
  resetDsAdvancedBus,
} from '../client/v2/ds/advanced-bus.js';
import { loadAdvanced, revealSystem, runCheck } from '../client/v2/ds/advanced-host.jsx';
import {
  ADVANCED_WORDS,
  askAiText,
  checkRows,
  checkToast,
  modesLine,
  ranWords,
  revealRel,
  usedByLine,
} from '../client/v2/ds/advanced-model.js';
import { CheckCard } from '../client/v2/ds/check-card.jsx';
import { createDsRoutes } from '../routes/ds.ts';
import { createDsCheckRoutes } from '../routes/ds-check.ts';
import { ACCENT, cleanup, DS, DS_PATH, makeProject, type Project } from './_ds-engine-fixture.ts';

afterAll(cleanup);
afterEach(resetDsAdvancedBus);

const NOW = Date.parse('2026-10-20T10:00:00Z');
const CHECK = {
  format: 'maude.ds-system-check',
  v: 1,
  ds: 'studio',
  at: new Date(NOW - 60_000).toISOString(),
  lines: [
    {
      id: 'contrast',
      ok: false,
      title: 'Contrast',
      text: '41 of 42 text pairs pass, Light and Dark',
    },
    {
      id: 'pair',
      ok: false,
      title: 'Quiet on Well',
      text: 'Dark: 4.2:1 — large text only',
      show: '--fg-3',
    },
    { id: 'complete', ok: true, title: 'Complete', text: '7 sections, both modes, reduced motion' },
    {
      id: 'schema',
      ok: true,
      title: 'Schema',
      text: 'Follows the schema — switches cleanly with any system that does',
    },
  ],
};
const FILES = {
  format: 'maude.ds-system-files',
  v: 1,
  ds: 'studio',
  folder: 'system/studio/',
  css: {
    file: 'colors_and_type.css',
    present: true,
    text: ':root {\n  --page: #fff;\n  …  /* 94 more */\n}',
  },
  json: { file: 'tokens.json', present: true, text: '{\n  "alias": {}\n}' },
  files: [
    { kind: 'folder', names: ['system/studio/'], depth: 0 },
    { kind: 'file', names: ['colors_and_type.css', 'tokens.json'], depth: 1 },
    { kind: 'folder', names: ['preview/'], note: '38 specimen pages', depth: 1 },
  ],
  history: [
    {
      rev: 'a'.repeat(64),
      action: 'publish',
      who: 'You',
      kind: 'person',
      text: 'Accent → Deeper azure · 4 canvases updated',
      at: new Date(NOW - 120_000).toISOString(),
    },
    {
      rev: 'b'.repeat(64),
      action: 'keep',
      who: 'Claude Code',
      kind: 'file',
      text: 'Quiet and Corner M, kept from the file',
      at: null,
    },
  ],
  converted: true,
};
const VALUE = {
  ds: 'studio',
  label: 'Studio site',
  canvases: 5,
  modes: { light: 'light', dark: 'dark' },
  files: FILES,
  check: CHECK,
  busy: false,
  note: null,
  native: true,
};
const html = (value = VALUE, actions: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<DsAdvanced value={value} actions={actions} now={NOW} />);

describe('the words', () => {
  test('used by, modes, ran-ago', () => {
    expect(usedByLine(5)).toBe('5 canvases');
    expect(usedByLine(1)).toBe('1 canvas');
    expect(usedByLine(0)).toBe('No canvases yet');
    expect(usedByLine(null)).toBeNull();
    // the board's "Studio site · 5 canvases": the project says whose canvases they are
    expect(usedByLine(5, 'Studio site')).toBe('Studio site · 5 canvases');
    expect(usedByLine(0, 'Studio site')).toBe('No canvases yet');
    expect(modesLine({ light: 'light', dark: 'dark' })).toBe('Light · Dark');
    expect(modesLine({ light: 'light', dark: null })).toBe('Light');
    expect(ranWords(CHECK, NOW)).toBe('ran 1 min ago');
    expect(ranWords(null, NOW)).toBe(ADVANCED_WORDS.neverRan);
  });

  test('a stored answer is judged before it is drawn', () => {
    const rows = checkRows({
      lines: [
        null,
        { title: 7 },
        { id: 'pair', ok: 'yes', title: 'x'.repeat(500), text: 'y'.repeat(500), show: '--ok-name' },
        { id: 'nonsense', ok: true, title: 'A', text: 'b', show: 'not a token"] x' },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ok: false, show: '--ok-name' });
    expect(rows[0]?.title).toHaveLength(120);
    expect(rows[0]?.text).toHaveLength(240);
    expect(rows[1]).toMatchObject({ id: 'pair', show: null });
    expect(checkRows(undefined)).toEqual([]);
    expect(checkRows({ lines: 'nope' })).toEqual([]);
  });

  test('the toast after a run leads with what is not well', () => {
    expect(checkToast(CHECK)).toBe('Contrast: 41 of 42 text pairs pass, Light and Dark');
    expect(checkToast({ lines: [{ id: 'schema', ok: true, title: 'Schema', text: 'ok' }] })).toBe(
      'Schema: ok'
    );
    expect(checkToast(null)).toBe(ADVANCED_WORDS.failed);
  });

  test('reveal stays inside the project; Ask AI hands over a request, nothing more', () => {
    expect(revealRel('.design', 'system/studio/')).toBe('.design/system/studio');
    expect(revealRel('.design/', 'system/studio')).toBe('.design/system/studio');
    expect(revealRel('.design', '../../etc')).toBeNull();
    expect(revealRel('.design', '')).toBeNull();
    expect(askAiText('studio', 'Studio site')).toContain('/design:critic --system-only');
    expect(askAiText('studio', 'Studio site')).toContain(
      'maude design ds check-system studio --json'
    );
  });
});

describe('the panel', () => {
  test('the system, how many canvases follow it, its modes and the check button', () => {
    const m = html();
    expect(m).toContain('data-testid="ds-advanced"');
    expect(m).toContain('Studio site');
    expect(m).toContain('Design system');
    expect(m).toContain('5 canvases');
    expect(m).toContain('Light · Dark');
    expect(m).toContain('data-testid="ds-check-button"');
    expect(m).toContain('Check the system');
    expect(html({ ...VALUE, busy: true })).toContain('Checking…');
    expect(html({ ...VALUE, note: ADVANCED_WORDS.refused })).toContain(
      'You can’t check this design system.'
    );
  });

  test('rc.1 finding 5: Advanced starts closed (every Advanced fold does); the check card closes the column after the history', () => {
    const m = html({ ...VALUE, project: 'Studio site' });
    expect(m).toMatch(/<details[^>]*data-testid="ds-advanced-fold"/);
    expect(m).not.toMatch(/<details[^>]*data-testid="ds-advanced-fold"[^>]*open/);
    expect(m).toContain('Studio site · 5 canvases');
    expect(m.indexOf('data-testid="ds-history"')).toBeLessThan(m.indexOf('critic panel'));
    expect(m.indexOf('data-testid="ds-flow"')).toBeLessThan(m.indexOf('data-testid="ds-history"'));
  });

  test('the card: a row a line, the one that is short offers Show, and the AI review is the last word', () => {
    const m = html(VALUE, { show: () => {}, askAi: () => {} });
    expect(m).toContain('ran 1 min ago');
    expect(m).toContain('41 of 42 text pairs pass, Light and Dark');
    expect(m).toContain('Quiet on Well');
    expect(m).toContain('Dark: 4.2:1 — large text only');
    expect(m).toContain('7 sections, both modes, reduced motion');
    expect(m).toContain('data-testid="ds-check-show-1"');
    expect(m).not.toContain('data-testid="ds-check-show-0"');
    expect(m).toContain('critic panel: a11y · completeness · keeper');
    expect(m).toContain('Ask AI to review');
    // without the shell to run them, neither button is drawn
    const bare = renderToStaticMarkup(<CheckCard check={CHECK} now={NOW} />);
    expect(bare).not.toContain('Show');
    expect(bare).not.toContain('Ask AI to review');
    expect(renderToStaticMarkup(<CheckCard check={null} />)).toBe('');
  });

  test('the fold holds the tokens file, the folder, the handoff and Reveal in Finder; mono is only in there', () => {
    const m = html();
    const fold = m.slice(
      m.indexOf('data-testid="ds-advanced-fold"'),
      m.indexOf('data-testid="ds-flow"')
    );
    expect(fold).toContain('Tokens · files');
    expect(fold).toContain('data-testid="ds-advanced-seg-css"');
    expect(fold).toContain('data-testid="ds-advanced-seg-json"');
    expect(fold).toContain('data-file="colors_and_type.css"');
    expect(fold).toContain('…  /* 94 more */');
    expect(fold).toContain('data-testid="ds-advanced-files"');
    expect(fold).toContain('system/studio/');
    expect(fold).toContain('38 specimen pages');
    expect(fold).toContain('Hand off tokens');
    expect(fold).toContain('⇧⌘H');
    expect(fold).toContain('data-testid="ds-reveal-files"');
    // mono belongs to the fold (and the one quiet line under the check); nothing else is set in it
    const outside = m.replace(fold, '');
    expect(outside.match(/dsa-mono/g)).toHaveLength(1);
    expect(outside).toContain('critic panel');
  });

  test('a browser tab has no Finder: Reveal in Finder is absent, not dead', () => {
    expect(html({ ...VALUE, native: false })).not.toContain('ds-reveal-files');
  });

  test('which way changes flow, in the drawing’s three lines', () => {
    const m = html();
    expect(m).toContain('Which way changes flow');
    expect(m).toContain('Design system canvas');
    expect(m).toContain('where designers edit. It writes the files.');
    expect(m).toContain('what code, Claude Code and other agents read.');
    expect(m).toContain(
      'comes back as a review: Keep or Undo. A clash keeps both until one is picked.'
    );
  });

  test('version history: newest first, whose hand, and Restore… opens it', () => {
    const m = html();
    expect(m).toContain('Version history');
    expect(m).toContain('Accent → Deeper azure · 4 canvases updated');
    expect(m).toContain('2 min ago');
    expect(m).toContain('Claude Code');
    expect(m).toContain('data-testid="ds-history-restore"');
    const none = html({ ...VALUE, files: { ...FILES, history: [] } });
    expect(none).toContain('Nothing published yet.');
    expect(none).not.toContain('ds-history-restore');
  });

  test('nothing to draw without a system', () => {
    expect(renderToStaticMarkup(<DsAdvanced value={null} actions={null} />)).toBe('');
  });
});

describe('the host, against the real routes', () => {
  const claims: Record<string, AccessClaim> = {
    owner: { v: 1, role: 'owner' },
    view: { v: 1, role: 'observer' },
  };
  function wire(p: Project, who: keyof typeof claims = 'owner') {
    const deps = {
      engine: () => p.engine,
      access: () => resolveAccess(claims[who]),
      person: async () => ({ name: 'Michal' }),
    };
    const specs = [...createDsRoutes(deps), ...createDsCheckRoutes(deps)];
    return (async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? 'GET';
      const spec = specs.find((s) => s.method === method && s.path === url.split('?')[0]);
      if (!spec) throw new Error(`no ${method} ${url}`);
      return spec.handle(
        new Request(`http://localhost${url}`, {
          method,
          ...(init?.body
            ? { body: init.body, headers: { 'content-type': 'application/json' } }
            : {}),
        }),
        {}
      );
    }) as unknown as typeof fetch;
  }

  test('what the panel reads is what the routes serve; a run keeps the card, a viewer cannot start one', async () => {
    const p = await makeProject();
    const got = await loadAdvanced(DS, wire(p));
    expect(got).toMatchObject({
      ds: DS,
      check: null,
      files: { folder: `${DS_PATH}/`, converted: true },
    });
    expect(got?.files.css.text).toContain('--accent');
    expect(got?.files.history).toEqual([]);
    // a published change is a row of the system's own history, in the hand that made it
    const f = wire(p);
    const post = (url: string, body: object) =>
      f(url, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());
    await post('/_api/ds/pending', {
      ds: DS,
      tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
    });
    const review = (await post('/_api/ds/publish', { ds: DS, dryRun: true })) as {
      expectHead: string | null;
    };
    await post('/_api/ds/publish', { ds: DS, expectHead: review.expectHead });
    const after = await loadAdvanced(DS, wire(p));
    expect(after?.files.history[0]).toMatchObject({
      action: 'publish',
      who: 'Michal',
      kind: 'person',
    });

    const ran = await runCheck(DS, wire(p));
    expect(ran.ok).toBe(true);
    const again = await loadAdvanced(DS, wire(p));
    expect(again?.check).toMatchObject({ ds: DS, format: 'maude.ds-system-check' });
    expect(checkRows(again?.check).length).toBeGreaterThan(0);

    const refused = await runCheck(DS, wire(p, 'view'));
    expect(refused).toMatchObject({
      ok: false,
      code: 'forbidden',
      message: ADVANCED_WORDS.refused,
    });
    // a viewer still reads the last answer
    expect((await loadAdvanced(DS, wire(p, 'view')))?.check).not.toBeNull();
    expect(await loadAdvanced('nope', wire(p))).toBeNull();
  });

  test('Reveal in Finder asks the Mac app for the system’s folder, and says so in a tab with no Mac app', async () => {
    const seen: string[] = [];
    const cfg = {
      designRel: '.design',
      designSystems: [{ name: 'studio', path: 'system/studio' }],
    };
    const ok = await revealSystem(cfg, 'studio', {
      revealPath: async (rel: string) => (seen.push(rel), { ok: true }),
    } as never);
    expect(ok).toEqual({ ok: true });
    expect(seen).toEqual(['.design/system/studio']);
    const browser = await revealSystem(cfg, 'studio', {
      revealPath: async () => ({ ok: false, reason: 'browser' }),
    } as never);
    expect(browser).toEqual({
      ok: false,
      message: 'Open this project in the Mac app to work with its files.',
    });
    expect((await revealSystem(cfg, 'unknown', {} as never)).ok).toBe(false);
  });
});

describe('the bus', () => {
  test('a request made before the host mounted waits and is handed over', () => {
    expect(requestDsAdvanced({ kind: 'check', ds: 'studio' })).toBe(false);
    const got: unknown[] = [];
    const off = onDsAdvancedRequest((r: unknown) => got.push(r));
    expect(got).toEqual([{ kind: 'check', ds: 'studio' }]);
    expect(requestDsAdvanced({ kind: 'reveal' })).toBe(true);
    off();
    expect(got).toHaveLength(2);
  });
});

describe('the nothing-deleted row it closes', () => {
  const root = path.join(import.meta.dir, '..');
  const nd = JSON.parse(readFileSync(path.join(root, 'client/v2/nothing-deleted.json'), 'utf8'));
  const row = nd.rows.find((r: { id: string }) => r.id === 'A-design-system-folder-path');

  test('the folder path is the head of the Advanced files list, and the old files group stays', () => {
    // the row keeps the testid the headless boot can see; the new home is named in `where` and drawn under ds-advanced-files
    expect(row.v2.testid).toBe('canvases-ds-files');
    expect(row.v2.where).toContain('Design system › Advanced › Files');
    const ids = JSON.parse(readFileSync(path.join(root, 'client/testids.json'), 'utf8')) as {
      hook: string;
    }[];
    for (const hook of ['ds-advanced-files', 'ds-advanced-folder', 'canvases-ds-files'])
      expect(ids.some((h) => h.hook === hook)).toBe(true);
    // the frozen v1 entry still resolves to the row
    expect(nd.map['testid:studio/client/tree/tree.jsx#sidebar/tree/canvases-ds-files']).toBe(
      'A-design-system-folder-path'
    );
    const m = html();
    expect(m).toContain('data-testid="ds-advanced-folder"');
    expect(m).toContain(`system/studio/`);
  });
});
