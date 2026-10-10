// V2-2.7 — prefs migration (Gate 0 D20): fixture of every old key, the KEY_CLASS tripwire, and the
// adapter's read-old/write-new contract. Nothing here boots a server or touches the real prefs.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrateLocalPrefs, snapshotLegacyKeys } from '../client/prefs-migrate.js';
import { UI_PREFS_DEFAULTS } from '../ui-prefs.ts';
import {
  diffPrefs,
  isLegacyKey,
  KEY_CLASS,
  LEGACY_VERSION_KEY,
  migratePrefs,
  PREFS_VERSION,
  V1_DEFAULTS,
} from '../ui-prefs-migrate.ts';

const STUDIO = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = (name: string) =>
  JSON.parse(readFileSync(join(STUDIO, 'test', 'fixtures', 'prefs-v1', name), 'utf8'));
const LOCAL: Record<string, string> = fx('local.json');
const DISK = fx('disk.json');
const EXPECTED = fx('expected-v2.json');

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

// ── the tripwire: every storage key the code can touch must be classified ────────────────────────

/** Storage keys named in `src`: first argument of a storage call, or a *_STORE/_KEY/_SEEN/_PREFIX
 *  const (or any const in a file that mentions Storage). Comments are ignored. */
export function scanStorageKeys(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  const found = new Set<string>();
  const norm = (k: string) => {
    const n = k.replace(/\$\{[^}]*\}/g, '*');
    return n.endsWith(':') ? `${n}*` : n;
  };
  const call =
    /(?:getItem|setItem|removeItem|safeStorageGet|safeStorageSet|usePanelSize)\(\s*(['"`])((?:mdcc|maude)-[^'"`]*)\1/g;
  for (const m of code.matchAll(call)) found.add(norm(m[2]));
  const mentionsStorage = /localStorage|sessionStorage/.test(code);
  const assign =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])((?:mdcc|maude)-[^'"`]*)\2/g;
  for (const m of code.matchAll(assign)) {
    if (mentionsStorage || /(STORE|KEY|SEEN|PREFIX)$/.test(m[1])) found.add(norm(m[3]));
  }
  return [...found];
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(STUDIO, p);
    if (/^(node_modules|dist|test|\.|client\/v2|client\/styles)/.test(rel)) continue;
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(js|jsx|ts|tsx|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe('KEY_CLASS tripwire', () => {
  const found = new Map<string, string>(); // key -> first file
  for (const f of sourceFiles(STUDIO)) {
    for (const k of scanStorageKeys(readFileSync(f, 'utf8'))) {
      if (!found.has(k)) found.set(k, relative(STUDIO, f));
    }
  }

  test('the scanner sees the keys it should (so a green tripwire means something)', () => {
    for (const k of [
      'mdcc-theme',
      'maude-sb-w',
      'maude-cloud-role-seen:*',
      'maude-install-id',
      'mdcc-whatsnew-toast-dismissed',
      'maude-annot-hints-v1',
      'maude-undo:*',
      LEGACY_VERSION_KEY,
    ]) {
      expect(found.has(k), `scanner missed ${k}`).toBe(true);
    }
  });

  test('a planted, unclassified key is caught by the scanner', () => {
    expect(scanStorageKeys("localStorage.setItem('maude-new-thing', '1')")).toEqual([
      'maude-new-thing',
    ]);
    expect(scanStorageKeys('const SOME_STORE = "mdcc-another"')).toEqual(['mdcc-another']);
    expect(scanStorageKeys('// localStorage.getItem("maude-in-a-comment")')).toEqual([]);
  });

  test('every storage key in the code is classified in KEY_CLASS', () => {
    const unclassified = [...found].filter(([k]) => !KEY_CLASS[k]).map(([k, f]) => `${k} (${f})`);
    expect(unclassified).toEqual([]);
  });

  test('every classified key still exists (or is marked dead) and carries a reason', () => {
    for (const [k, rule] of Object.entries(KEY_CLASS)) {
      expect(rule.note.length).toBeGreaterThan(10);
      if (rule.class === 'migrate') expect(rule.to, `${k} needs a target`).toBeTruthy();
      if (rule.class !== 'dead')
        expect(found.has(k), `${k} is classified but not in code`).toBe(true);
    }
  });

  test('the fixture holds every shell key a 1.x origin can hold, and nothing else', () => {
    const expand = (k: string) =>
      k.endsWith(':*') ? ['owner', 'member', 'viewer'].map((r) => k.replace('*', r)) : [k];
    const shellKeys = Object.entries(KEY_CLASS)
      .filter(([, r]) => r.class !== 'canvas-origin' && r.class !== 'marker')
      .flatMap(([k]) => expand(k));
    expect(Object.keys(LOCAL).sort()).toEqual(shellKeys.sort());
  });

  test('every fixture key is recognised as legacy by isLegacyKey', () => {
    for (const k of Object.keys(LOCAL)) expect(isLegacyKey(k), k).toBe(true);
    expect(isLegacyKey(LEGACY_VERSION_KEY)).toBe(false);
    expect(isLegacyKey('maude-annot-hints-v1')).toBe(false);
    expect(isLegacyKey('something-else')).toBe(false);
  });
});

// ── the pure core ────────────────────────────────────────────────────────────────────────────────

describe('migratePrefs — fixture of every old key', () => {
  test('a v1 prefs.json plus a full 1.x localStorage becomes exactly the approved v2 shape', () => {
    const { disk2, report } = migratePrefs({
      disk: deepFreeze(clone(DISK)),
      local: deepFreeze(clone(LOCAL)),
    });
    expect(disk2).toEqual(EXPECTED);
    expect(report.fromVersion).toBe(1);
    expect(report.toVersion).toBe(PREFS_VERSION);
  });

  test('disk wins where it has a value; localStorage fills only what disk lacks', () => {
    const { disk2, report } = migratePrefs({ disk: clone(DISK), local: clone(LOCAL) });
    // local says light / minimap on; disk says dark / off
    expect(disk2.theme).toBe('dark');
    expect(disk2.minimap).toBe(false);
    expect([...report.filled].sort()).toEqual(
      [
        'annotations',
        'autoOpenInspector',
        'canvases.showHidden',
        'layersMode',
        'panelsHidden',
        'pin.widths.left',
        'pin.widths.right',
        'zoom',
      ].sort()
    );
  });

  test('it never removes anything and never mutates its input', () => {
    const disk = deepFreeze(clone(DISK));
    const local = deepFreeze(clone(LOCAL));
    const { report } = migratePrefs({ disk, local }); // would throw on a write to frozen input
    expect(report.removed).toEqual([]);
    expect(disk).toEqual(DISK);
    expect(local).toEqual(LOCAL);
  });

  test('it is idempotent, with the same legacy keys and with none', () => {
    const once = migratePrefs({ disk: clone(DISK), local: clone(LOCAL) }).disk2;
    expect(migratePrefs({ disk: clone(once), local: clone(LOCAL) }).disk2).toEqual(once);
    expect(migratePrefs({ disk: clone(once), local: {} }).disk2).toEqual(once);
  });

  test('the seen flags are re-keyed: the v2 tour is unseen however many v1 flags are set', () => {
    const { disk2 } = migratePrefs({ disk: clone(DISK), local: clone(LOCAL) });
    expect(disk2.seen).toEqual({});
    // and a v2 file that already recorded something keeps it
    const kept = migratePrefs({
      disk: { ...clone(DISK), version: 2, seen: { 'v2-tour': true } },
      local: clone(LOCAL),
    }).disk2;
    expect(kept.seen).toEqual({ 'v2-tour': true });
  });

  test('maude-cp-mode migrates nothing, whichever vocabulary it holds', () => {
    for (const v of ['"advanced"', '"designer"', 'garbage', null]) {
      const { disk2 } = migratePrefs({ disk: null, local: { 'maude-cp-mode': v } });
      expect(disk2.fold).toEqual({});
      expect(JSON.stringify(disk2)).not.toMatch(/designer|advanced/);
    }
  });

  test('sidebar-open is inverted into panelsHidden; absent stays absent', () => {
    expect(
      migratePrefs({ disk: null, local: { 'mdcc-sidebar-open': '1' } }).disk2.panelsHidden
    ).toBe(false);
    expect(
      migratePrefs({ disk: null, local: { 'mdcc-sidebar-open': '0' } }).disk2.panelsHidden
    ).toBe(true);
    expect('panelsHidden' in migratePrefs({ disk: null, local: {} }).disk2).toBe(false);
    expect(
      'panelsHidden' in migratePrefs({ disk: null, local: { 'mdcc-sidebar-open': 'x' } }).disk2
    ).toBe(false);
  });

  test('panelSides is carried verbatim from localStorage when disk has none (incl. sync)', () => {
    const { disk2 } = migratePrefs({
      disk: { theme: 'dark' },
      local: {
        'mdcc-panel-sides':
          '{"tree":"right","sync":"left","bad":"middle","__proto__":"left","assistant":"left"}',
      },
    });
    expect(disk2.panelSides).toEqual({ tree: 'right', sync: 'left', assistant: 'left' });
    expect(Object.hasOwn(disk2.panelSides as object, '__proto__')).toBe(false);
  });

  test('pin widths are clamped to what v1 displayed, and junk is ignored', () => {
    const w = (sb: string | null, rp: string | null) =>
      (
        migratePrefs({ disk: null, local: { 'maude-sb-w': sb, 'maude-rp-w': rp } }).disk2.pin as {
          widths: Record<string, number>;
        }
      ).widths;
    expect(w('50', '9000')).toEqual({ left: 200, right: 480 });
    expect(w('abc', '-5')).toEqual({ right: 260 });
    expect(w(null, null)).toEqual({});
  });

  test('fill-if-absent: a second origin never overwrites, it only fills the gaps', () => {
    const first = {
      version: 2,
      ...clone(UI_PREFS_DEFAULTS),
      pin: { on: true, widths: { left: 111 } },
      canvases: { showHidden: false },
      fold: { 'inspector.advanced': true },
      seen: {},
      migratedFrom: 1,
    };
    const { disk2 } = migratePrefs({
      disk: clone(first),
      local: {
        'maude-sb-w': '300',
        'maude-rp-w': '400',
        'mdcc-show-hidden': '1',
        'mdcc-sidebar-open': '0',
      },
    });
    expect(disk2.pin).toEqual({ on: true, widths: { left: 111, right: 400 } });
    expect(disk2.canvases).toEqual({ showHidden: false });
    expect(disk2.panelsHidden).toBe(true);
    expect(disk2.fold).toEqual({ 'inspector.advanced': true });
    expect(disk2.migratedFrom).toBe(1);
  });

  test('a file from a newer build is returned untouched', () => {
    const newer = { version: 3, theme: 'light', brandNew: { a: 1 } };
    const { disk2, report } = migratePrefs({ disk: clone(newer), local: clone(LOCAL) });
    expect(disk2).toEqual(newer);
    expect(report.newer).toBe(true);
  });

  test('a fresh install is not an upgrader: no migratedFrom, v1 defaults, empty homes', () => {
    for (const disk of [null, undefined, {}, clone(UI_PREFS_DEFAULTS)]) {
      const { disk2 } = migratePrefs({ disk, local: {} });
      expect(disk2).toEqual({
        version: 2,
        ...clone(V1_DEFAULTS),
        pin: { on: false, widths: {} },
        fold: {},
        seen: {},
      });
    }
  });

  test('an upgrader is recognised from either side', () => {
    expect(migratePrefs({ disk: null, local: { 'mdcc-theme': 'dark' } }).disk2.migratedFrom).toBe(
      1
    );
    expect(migratePrefs({ disk: { theme: 'light' }, local: {} }).disk2.migratedFrom).toBe(1);
  });

  test('corrupt and partial input never throws and falls back per field', () => {
    for (const disk of [
      'x',
      42,
      [],
      [1],
      true,
      { theme: 'purple', minimap: 'yes', panelSides: 7 },
    ]) {
      const { disk2 } = migratePrefs({
        disk,
        local: {
          'mdcc-theme': 'neon',
          'mdcc-panel-sides': 'not json',
          'mdcc-layers-mode': 'sideways',
          'mdcc-minimap-visible': 'maybe',
          'maude-sb-w': 'NaN',
        },
      });
      expect(disk2.theme).toBe(V1_DEFAULTS.theme);
      expect(disk2.panelSides).toEqual(V1_DEFAULTS.panelSides);
      expect(disk2.layersMode).toBe(V1_DEFAULTS.layersMode);
      expect(disk2.minimap).toBe(V1_DEFAULTS.minimap);
      expect(disk2.version).toBe(2);
    }
  });

  test('the core defaults are the server defaults (drift tripwire)', () => {
    expect(V1_DEFAULTS).toEqual(UI_PREFS_DEFAULTS);
  });

  test('diffPrefs returns only the top-level keys that changed, ignoring key order', () => {
    expect(diffPrefs({ a: 1, b: { x: 1, y: 2 } }, { b: { y: 2, x: 1 }, a: 1 })).toEqual({});
    expect(diffPrefs({ a: 1, b: { x: 1 } }, { a: 1, b: { x: 2 }, c: 3 })).toEqual({
      b: { x: 2 },
      c: 3,
    });
  });
});

// ── the client adapter: read old, write new, delete nothing ──────────────────────────────────────

function fakeStorage(init: Record<string, string>) {
  const m = new Map(Object.entries(init));
  const calls = { set: [] as string[], remove: [] as string[] };
  return {
    calls,
    snapshot: () => Object.fromEntries(m),
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      calls.set.push(k);
      m.set(k, v);
    },
    removeItem: (k: string) => {
      calls.remove.push(k);
      m.delete(k);
    },
  };
}

function fakeServer(disk: object) {
  const posts: object[] = [];
  let gets = 0;
  const fetchImpl = async (url: string, init?: { method?: string; body?: string }) => {
    expect(url).toBe('/_api/ui-prefs');
    if (init?.method === 'POST') {
      posts.push(JSON.parse(init.body as string));
      return { ok: true, json: async () => ({}) };
    }
    gets++;
    return { ok: true, json: async () => clone(disk) };
  };
  return { fetchImpl, posts, gets: () => gets };
}

describe('client adapter (exported, not called in Phase 2)', () => {
  test('snapshotLegacyKeys reads only classified legacy keys, family included', () => {
    const s = fakeStorage({
      ...clone(LOCAL),
      'maude-annot-hints-v1': '{}',
      unrelated: 'x',
      [LEGACY_VERSION_KEY]: '2',
    });
    const snap = snapshotLegacyKeys(s);
    expect(snap).toEqual(LOCAL);
  });

  test('first run: GETs, POSTs only what changed, stamps the per-origin marker, deletes nothing', async () => {
    const storage = fakeStorage(clone(LOCAL));
    const before = storage.snapshot();
    const server = fakeServer(DISK);
    const out = await migrateLocalPrefs({ storage, fetchImpl: server.fetchImpl as never });
    expect(out.status).toBe('migrated');
    expect(server.posts.length).toBe(1);
    const delta = server.posts[0] as Record<string, unknown>;
    expect(delta).toEqual(diffPrefs(DISK, EXPECTED));
    expect('theme' in delta).toBe(false); // unchanged fields are not re-posted
    expect(delta.version).toBe(2);
    // read old / write new: every old key byte-identical, only the marker added
    expect(storage.calls.remove).toEqual([]);
    expect(storage.calls.set).toEqual([LEGACY_VERSION_KEY]);
    expect({ ...storage.snapshot(), [LEGACY_VERSION_KEY]: undefined }).toEqual({
      ...before,
      [LEGACY_VERSION_KEY]: undefined,
    });
    expect(storage.getItem(LEGACY_VERSION_KEY)).toBe(String(PREFS_VERSION));
  });

  test('second run on the same origin does nothing at all', async () => {
    const storage = fakeStorage({ ...clone(LOCAL), [LEGACY_VERSION_KEY]: String(PREFS_VERSION) });
    const server = fakeServer(DISK);
    const out = await migrateLocalPrefs({ storage, fetchImpl: server.fetchImpl as never });
    expect(out.status).toBe('already');
    expect(server.gets()).toBe(0);
    expect(server.posts).toEqual([]);
  });

  test('an already-migrated file and nothing to fill posts nothing, but still stamps the origin', async () => {
    const storage = fakeStorage({ 'mdcc-theme': 'dark' });
    const migrated = migratePrefs({ disk: clone(DISK), local: clone(LOCAL) }).disk2;
    const server = fakeServer(migrated);
    const out = await migrateLocalPrefs({ storage, fetchImpl: server.fetchImpl as never });
    expect(out.status).toBe('migrated');
    expect(server.posts).toEqual([]);
    expect(storage.getItem(LEGACY_VERSION_KEY)).toBe(String(PREFS_VERSION));
  });

  test('a failed GET or POST leaves no marker, so the next boot retries', async () => {
    const a = fakeStorage(clone(LOCAL));
    const r1 = await migrateLocalPrefs({
      storage: a,
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as never,
    });
    expect(r1.status).toBe('error');
    expect(a.getItem(LEGACY_VERSION_KEY)).toBeNull();

    const b = fakeStorage(clone(LOCAL));
    const r2 = await migrateLocalPrefs({
      storage: b,
      fetchImpl: (async (_u: string, init?: { method?: string }) =>
        init?.method === 'POST'
          ? { ok: false, json: async () => ({}) }
          : { ok: true, json: async () => clone(DISK) }) as never,
    });
    expect(r2.status).toBe('error');
    expect(b.getItem(LEGACY_VERSION_KEY)).toBeNull();
  });

  test('storage that throws is survivable', async () => {
    const hostile = {
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const out = await migrateLocalPrefs({
      storage: hostile,
      fetchImpl: fakeServer(DISK).fetchImpl as never,
    });
    expect(['migrated', 'error']).toContain(out.status);
  });
});
