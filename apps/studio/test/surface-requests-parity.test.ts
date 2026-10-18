// S1.17 — surface = substrate for the version history and the Trash: the UI path and the verb
// path of every history / Trash registry action hit the SAME route with the SAME body.
//
// The one source is history/surface-requests.ts. This test (1) runs each verb against a recording
// studio and compares the request it sent with the builder's, (2) checks every named route is a
// real, registered route with that method, (3) pins the registry: a history.* / trash.* action is
// either in the table below or in the short, ratcheting list of actions that make no request of
// their own, and (4) fails a client/v2 file that names one of these write routes without going
// through the builders — the history panel (S1.14/S1.15) and Trash view (S1.8) will be held to it.

import { afterEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  nameRequest,
  restoreRequest,
  SURFACE_WRITE_ROUTES,
  type SurfaceRequest,
  trashClearRequest,
  trashListRequest,
  trashRestoreRequest,
} from '../history/surface-requests.ts';
import { fakeStudio, json, type Seen } from './_fake-studio.ts';

const STUDIO = join(import.meta.dir, '..');
const manifest = JSON.parse(readFileSync(join(STUDIO, 'actions.manifest.json'), 'utf8')) as {
  actions: { id: string; agent?: { path: string; verb?: string } }[];
};

const CANVAS = '.design/ui/home.tsx';

/** registry action → the verb call that is its agent path, and the request the UI makes. */
const SURFACE: Record<string, { verb: string; args: string[]; request: SurfaceRequest }> = {
  'history.restore': {
    verb: 'history',
    args: ['restore', 'ui/home.tsx', 'r11'],
    request: restoreRequest({ path: CANVAS, at: 'r11' }),
  },
  'history.restore-artboard': {
    verb: 'history',
    args: ['restore', 'ui/home.tsx', 'r11', '--artboard', 'hero'],
    request: restoreRequest({ path: CANVAS, at: 'r11', artboard: 'hero' }),
  },
  'history.restore-object': {
    verb: 'history',
    args: ['restore', 'ui/home.tsx', 'r11', '--element', 'hero/cta'],
    request: restoreRequest({ path: CANVAS, at: 'r11', element: 'hero/cta' }),
  },
  'history.go-back': {
    verb: 'history',
    args: ['restore', 'ui/home.tsx', '@last-good'],
    request: restoreRequest({ path: CANVAS, at: '@last-good' }),
  },
  'history.name': {
    verb: 'history',
    args: ['name', 'ui/home.tsx', 'r11', 'Hero pass'],
    request: nameRequest({ path: CANVAS, at: 'r11', name: 'Hero pass' }),
  },
  'view.trash': {
    verb: 'trash',
    args: ['list'],
    request: trashListRequest(),
  },
  'trash.restore': {
    verb: 'trash',
    args: ['restore', 'canvas:e1'],
    request: trashRestoreRequest('canvas:e1'),
  },
  'trash.clear': {
    verb: 'trash',
    args: ['clear', '--yes'],
    request: trashClearRequest(),
  },
};

/**
 * history.* / trash.* actions that make no request of their own, with why. Only ever shrinks:
 * the panel's reads (S1.14) are read projections the verbs reach through their own GET routes.
 */
const NO_OWN_REQUEST: Record<string, string> = {
  'history.open': 'opens the panel; the read verb is `history list`',
  'history.filter': 'the person’s own panel filter (human view-pref)',
  'history.view-version': 'a read: `history show` — GET, no body',
  'history.compare': 'a read: `history diff` — GET, no body',
  'history.compare-pictures':
    'looking at two renders (human view-pref); the words are `history diff`',
};

let studio: ReturnType<typeof fakeStudio> | null = null;
afterEach(() => {
  studio?.stop();
  studio = null;
});

const everything = (s: Seen) => {
  if (s.path === '/_api/trash') return json({ ok: true, items: [], canClear: true, seq: 1 });
  if (s.path.startsWith('/_api/trash/') || s.path.startsWith('/_api/project/'))
    return json({ ok: true, status: 'accepted', path: 'ui/home.tsx', cleared: [] });
};

describe('surface = substrate: history + Trash (S1.17)', () => {
  for (const [id, row] of Object.entries(SURFACE)) {
    test(`${id}: the verb makes the request the UI makes`, async () => {
      studio = fakeStudio(everything);
      const r = await studio.run(row.verb, row.args);
      expect({ id, code: r.code, stderr: r.stderr }).toEqual({ id, code: 0, stderr: '' });
      // the request that matters: the last one (restore-by-path reads the list first)
      const sent = studio.seen.at(-1);
      expect({
        method: sent?.method,
        route: sent?.path,
        body: sent?.method === 'GET' ? undefined : sent?.body,
      }).toEqual({
        method: row.request.method,
        route: row.request.route,
        body: row.request.body,
      });
    });
  }

  test('every route a builder names is registered with that method (routes/*.ts)', () => {
    const src = readdirSync(join(STUDIO, 'routes'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(join(STUDIO, 'routes', f), 'utf8'))
      .join('\n');
    const missing = Object.entries(SURFACE)
      .filter(([, { request }]) => {
        const re = new RegExp(
          `method: '${request.method}',\\s*path: '${request.route.replace(/\//g, '\\/')}'`
        );
        return !re.test(src);
      })
      .map(([id]) => id);
    expect(missing).toEqual([]);
  });

  test('registry: every history.* / trash.* action is covered or named as having no request', () => {
    const ids = manifest.actions
      .map((a) => a.id)
      .filter((id) => id.startsWith('history.') || id.startsWith('trash.') || id === 'view.trash');
    const uncovered = ids.filter((id) => !(id in SURFACE) && !(id in NO_OWN_REQUEST));
    expect(uncovered).toEqual([]);
    // ratchet: the exemptions name real actions (a removed action leaves the list too)
    const stale = Object.keys(NO_OWN_REQUEST).filter((id) => !ids.includes(id));
    expect(stale).toEqual([]);
    expect(Object.keys(NO_OWN_REQUEST).length).toBeLessThanOrEqual(5);
  });

  test('a covered action’s agent path is the verb the test runs', () => {
    const wrong: string[] = [];
    for (const [id, row] of Object.entries(SURFACE)) {
      const a = manifest.actions.find((x) => x.id === id);
      const want = `maude design ${row.verb}`;
      // trash.clear is human-only in the registry (decision:maude/v2-lead-trash-clear-human-only):
      // its verb is the owner's own terminal path, not an agent's.
      if (id === 'trash.clear') {
        if (a?.agent?.path !== 'human') wrong.push(id);
        continue;
      }
      if (a?.agent?.path !== 'cli' || !a.agent.verb?.startsWith(want)) wrong.push(id);
    }
    expect(wrong).toEqual([]);
  });

  test('client/v2 reaches the write routes only through the builders', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name === 'contracts' || name === 'node_modules') continue;
          walk(p);
          continue;
        }
        if (!/\.(jsx?|tsx?)$/.test(name) || /\.test\./.test(name)) continue;
        const text = readFileSync(p, 'utf8');
        if (
          SURFACE_WRITE_ROUTES.some((r) => text.includes(r)) &&
          !text.includes('surface-requests')
        )
          offenders.push(p.slice(STUDIO.length + 1));
      }
    };
    walk(join(STUDIO, 'client', 'v2'));
    expect(offenders).toEqual([]);
  });
});
