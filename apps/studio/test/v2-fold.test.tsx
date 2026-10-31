// V2-4.10 — the Fold component: one quiet "› Advanced" row, remembered per panel per Mac across projects.
//
// Done when: fold state persists; Reset in Settings › Advanced (that half is in v2-settings.test.tsx).
// Here: the store (persistence through the REAL prefs route's validator + writer on a temp file, per
// panel, openAll / closeAll / reset), the component's a11y and "children absent when closed", every
// migrated fold still rendering its old testid, and the two ⌘K handlers.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createFoldStore, FOLD_DEFAULTS, FOLD_PANELS } from '../client/v2/fold/fold-store.js';
import { readUiPrefs, validateUiPrefsPatch, writeUiPrefs } from '../ui-prefs.ts';

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');

// ── the store, over the real prefs file ─────────────────────────────────────────────────────────
let dir = '';
let prevPath: string | undefined;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'maude-fold-'));
  prevPath = process.env.MAUDE_UI_PREFS_PATH;
  process.env.MAUDE_UI_PREFS_PATH = join(dir, 'prefs.json');
});
beforeEach(() => {
  rmSync(join(dir, 'prefs.json'), { force: true });
});
afterAll(() => {
  if (prevPath === undefined) {
    delete process.env.MAUDE_UI_PREFS_PATH;
  } else {
    process.env.MAUDE_UI_PREFS_PATH = prevPath;
  }
  rmSync(dir, { recursive: true, force: true });
});

/** What POST /_api/ui-prefs does with a body, minus the HTTP: validate, then merge over the file. */
function viaPrefsRoute(body: Record<string, unknown>) {
  const v = validateUiPrefsPatch(body);
  if (!v.ok) throw new Error(`prefs route refused: ${v.error}`);
  writeUiPrefs(v.patch);
}
const diskStore = () => createFoldStore({ persist: viaPrefsRoute });

describe('the fold store persists per panel per Mac', () => {
  test('a choice survives a re-create (the next page / the next project window)', () => {
    const a = diskStore();
    expect(a.get('left.canvases')).toBe(false);
    a.set('left.canvases', true);
    const b = createFoldStore();
    b.hydrate(readUiPrefs());
    expect(b.get('left.canvases')).toBe(true);
  });

  test('each panel keeps its own choice: opening one leaves the others as they were', () => {
    const a = diskStore();
    a.set('left.canvases', true);
    a.set('diagnostics', true);
    a.set('left.canvases', false);
    const b = createFoldStore();
    b.hydrate(readUiPrefs());
    expect(b.get('left.canvases')).toBe(false);
    expect(b.get('diagnostics')).toBe(true);
    expect(b.get('inspector')).toBe(false);
  });

  test('every reserved panel id is accepted by the prefs route (the Inspector one too)', () => {
    for (const id of FOLD_PANELS) {
      expect(validateUiPrefsPatch({ fold: { [id]: true } }).ok, id).toBe(true);
    }
  });

  test('a fresh Mac: EVERY Advanced fold is closed (rc.1 finding 5), the "?" sheet’s too', () => {
    const s = createFoldStore();
    expect(s.openIds()).toEqual([]);
    expect(FOLD_PANELS.some((id) => s.get(id))).toBe(false);
    expect(FOLD_DEFAULTS).toEqual({});
  });
});

describe('open all / close all / reset', () => {
  test('openAll opens every panel, closeAll folds every panel, in one write each', () => {
    const writes: Array<Record<string, boolean>> = [];
    const s = createFoldStore({ persist: (p) => writes.push(p.fold) });
    s.openAll();
    expect(FOLD_PANELS.every((id) => s.get(id))).toBe(true);
    expect(Object.keys(writes[0]).sort()).toEqual([...FOLD_PANELS].sort());
    s.closeAll();
    expect(FOLD_PANELS.some((id) => s.get(id))).toBe(false);
    expect(writes.length).toBe(2);
  });

  test('reset returns every fold to a fresh Mac’s, and an id seen later is covered too', () => {
    const s = diskStore();
    s.set('inspector', true);
    s.set('future.panel', true);
    s.closeAll();
    s.openAll();
    s.reset();
    expect(s.openIds()).toEqual([]);
    expect(s.get('future.panel')).toBe(false);
    const b = createFoldStore();
    b.hydrate(readUiPrefs());
    expect(b.openIds()).toEqual([]);
  });

  test('only what changed is written, and nothing at all when nothing did', () => {
    const writes: Array<Record<string, boolean>> = [];
    const s = createFoldStore({ persist: (p) => writes.push(p.fold) });
    s.set('settings', true);
    expect(s.set('settings', true)).toBe(false);
    s.openAll();
    expect(writes[0]).toEqual({ settings: true });
    expect(writes[1]).not.toHaveProperty('settings');
  });
});

describe('the store never trusts the disk and never loses a choice made this page', () => {
  test('junk in prefs.json is ignored', () => {
    const s = createFoldStore();
    s.hydrate({
      fold: { 'left.canvases': 'yes', ['__proto__']: true, 'bad id!': true, help: false },
    });
    expect(s.get('left.canvases')).toBe(false);
    expect(s.get('help')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    s.hydrate(null);
    s.hydrate({ fold: [true] });
  });

  test('a late disk read does not overwrite what was just opened', () => {
    const s = createFoldStore();
    s.set('settings', true);
    s.hydrate({ fold: { settings: false, diagnostics: true } });
    expect(s.get('settings')).toBe(true);
    expect(s.get('diagnostics')).toBe(true);
  });

  test('a page with no prefs file keeps the choice in memory', () => {
    const s = createFoldStore({
      persist: () => {
        throw new Error('no prefs route');
      },
    });
    s.set('settings', true);
    expect(s.get('settings')).toBe(true);
  });

  test('subscribers hear a change once, an unchanged set not at all', () => {
    const s = createFoldStore();
    let n = 0;
    const off = s.subscribe(() => n++);
    s.set('settings', true);
    s.set('settings', true);
    expect(n).toBe(1);
    off();
    s.set('settings', false);
    expect(n).toBe(1);
  });
});

// ── the component ────────────────────────────────────────────────────────────────────────────────
describe('the fold component', () => {
  const realFetch = globalThis.fetch;
  let posts: string[] = [];
  const roots: Root[] = [];
  let AdvancedFold: typeof import('../client/v2/fold/advanced-fold.jsx').AdvancedFold;
  let foldStore: typeof import('../client/v2/fold/use-fold.js').foldStore;

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    ({ AdvancedFold } = await import('../client/v2/fold/advanced-fold.jsx'));
    ({ foldStore } = await import('../client/v2/fold/use-fold.js'));
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    GlobalRegistrator.unregister();
  });
  beforeEach(() => {
    posts = [];
    globalThis.fetch = (async (_u: string, init?: { body?: string }) => {
      if (init?.body) posts.push(init.body);
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;
    foldStore.reset();
    posts = [];
  });
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
  });

  const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const click = (el: Element | null) => {
    if (!el) throw new Error('missing element');
    return act(async () => {
      el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
  };
  async function mount(el: React.ReactElement) {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(el));
    return { host, root };
  }

  test('closed: one button, aria-expanded false, nothing controlled, children not rendered', async () => {
    await mount(
      <AdvancedFold panel="inspector">
        <p data-testid="inner">raw</p>
      </AdvancedFold>
    );
    const btn = q('fold-inspector-toggle');
    expect(btn?.tagName).toBe('BUTTON');
    expect(btn?.getAttribute('type')).toBe('button');
    expect(btn?.getAttribute('aria-expanded')).toBe('false');
    expect(btn?.hasAttribute('aria-controls')).toBe(false);
    expect(btn?.textContent).toBe('Advanced');
    expect(q('inner')).toBeNull();
    expect(q('fold-inspector-body')).toBeNull();
  });

  test('open: aria-expanded true, aria-controls names the body that exists, children render', async () => {
    await mount(
      <AdvancedFold panel="inspector">
        <p data-testid="inner">raw</p>
      </AdvancedFold>
    );
    await click(q('fold-inspector-toggle'));
    const btn = q('fold-inspector-toggle');
    expect(btn?.getAttribute('aria-expanded')).toBe('true');
    const body = q('fold-inspector-body');
    expect(body?.id).toBeTruthy();
    expect(btn?.getAttribute('aria-controls')).toBe(body?.id as string);
    expect(document.getElementById(body?.id as string)).toBe(body);
    expect(q('inner')?.textContent).toBe('raw');
    expect(q('fold-inspector')?.getAttribute('data-open')).toBe('true');
    await click(btn);
    expect(q('inner')).toBeNull();
  });

  test('the choice is written to the prefs file per panel, and is there when the panel mounts again', async () => {
    const one = await mount(
      <AdvancedFold panel="left.canvases">
        <p data-testid="inner">raw</p>
      </AdvancedFold>
    );
    await click(q('fold-left.canvases-toggle'));
    expect(posts).toEqual([JSON.stringify({ fold: { 'left.canvases': true } })]);
    await act(async () => one.root.unmount());
    roots.length = 0;
    document.body.innerHTML = '';
    await mount(
      <AdvancedFold panel="left.canvases">
        <p data-testid="inner">raw</p>
      </AdvancedFold>
    );
    expect(q('inner')).not.toBeNull();
    // …and a different panel was never opened
    await mount(<AdvancedFold panel="settings" testid="other" />);
    expect(q('other')?.getAttribute('data-open')).toBeNull();
  });

  test('"Open all" and "Close all" move a mounted fold', async () => {
    await mount(
      <AdvancedFold panel="inspector">
        <p data-testid="inner">raw</p>
      </AdvancedFold>
    );
    await act(async () => {
      foldStore.openAll();
    });
    expect(q('inner')).not.toBeNull();
    await act(async () => {
      foldStore.closeAll();
    });
    expect(q('inner')).toBeNull();
  });

  test('the caller can keep its own testids and classes (the markup is the same)', async () => {
    await mount(
      <AdvancedFold
        panel="settings"
        testid="my-fold"
        buttonTestid="my-btn"
        classes={{ root: 'r', btn: 'b', ch: 'c', body: 'bd' }}
        label="Hub, commands"
      >
        x
      </AdvancedFold>
    );
    expect(q('my-fold')?.className).toBe('k-adv r');
    expect(q('my-btn')?.className).toBe('k-adv-btn b');
    expect(q('my-btn')?.textContent).toBe('Hub, commands');
    await click(q('my-btn'));
    expect(document.querySelector('.bd')?.textContent).toBe('x');
  });

  test('a controlled fold follows its caller, not the store', async () => {
    let toggled = 0;
    await mount(
      <AdvancedFold panel="settings" open={false} onToggle={() => toggled++}>
        x
      </AdvancedFold>
    );
    await click(q('fold-settings-toggle'));
    expect(toggled).toBe(1);
    expect(q('fold-settings-body')).toBeNull();
    expect(foldStore.get('settings')).toBe(false);
  });

  test('reduced motion: the chevron only animates under no-preference', () => {
    const css = read('client/v2/fold/fold.css');
    const media = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(media).toBeGreaterThan(-1);
    const first = css.indexOf('transition');
    expect(first).toBeGreaterThan(media);
  });
});

// ── every migrated fold keeps its old testid ─────────────────────────────────────────────────────
describe('the folds that existed keep their hooks', () => {
  const realFetch = globalThis.fetch;
  const roots: Root[] = [];
  let foldStore: typeof import('../client/v2/fold/use-fold.js').foldStore;
  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    ({ foldStore } = await import('../client/v2/fold/use-fold.js'));
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    GlobalRegistrator.unregister();
  });
  beforeEach(() => {
    globalThis.fetch = (async () => new Response('{"ok":true}', { status: 200 })) as never;
    foldStore.reset();
  });
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
  });
  const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const click = (el: Element | null) => {
    if (!el) throw new Error('missing element');
    return act(async () => {
      el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
  };
  async function mount(el: React.ReactElement) {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(el));
  }

  test('Canvases › Advanced: canvases-advanced-fold / canvases-advanced, lp-adv classes, left.canvases', async () => {
    const { CanvasesAdvanced, useAdvancedOpen } = await import(
      '../client/v2/left-panel/canvases-advanced.jsx'
    );
    function Panel() {
      const [open, setOpen] = useAdvancedOpen();
      return (
        <CanvasesAdvanced
          open={open}
          onToggle={() => setOpen((v: boolean) => !v)}
          shown={3}
          total={4}
          showTrash={false}
        />
      );
    }
    await mount(<Panel />);
    const fold = q('canvases-advanced-fold');
    const btn = q('canvases-advanced');
    expect(fold?.className).toBe('k-adv lp-adv');
    expect(fold?.getAttribute('data-fold')).toBe('left.canvases');
    expect(btn?.className).toBe('k-adv-btn lp-adv-btn');
    expect(btn?.getAttribute('aria-expanded')).toBe('false');
    expect(q('canvases-hidden-files')).toBeNull();
    await click(btn);
    expect(q('canvases-hidden-files')).not.toBeNull();
    expect(foldStore.get('left.canvases')).toBe(true);
    // the shared "Close all" folds it
    await act(async () => {
      foldStore.closeAll();
    });
    expect(q('canvases-hidden-files')).toBeNull();
  });

  test('"?" sheet: shortcuts-advanced / -toggle, closed on a fresh Mac, and it remembers a fold', async () => {
    const { ShortcutsOverlay } = await import('../client/dialogs/shortcuts-overlay.jsx');
    await mount(<ShortcutsOverlay open onClose={() => {}} />);
    expect(q('shortcuts-advanced')?.className).toBe('k-adv so-adv');
    expect(q('shortcuts-advanced-toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(q('shortcuts-moved')).toBeNull();
    await click(q('shortcuts-advanced-toggle'));
    expect(q('shortcuts-moved')).not.toBeNull();
    expect(foldStore.get('help')).toBe(true);
    await act(async () => {
      foldStore.reset();
    });
    expect(q('shortcuts-moved')).toBeNull();
  });

  test('menu-runner: the two ⌘K handlers open and close every fold, and say so', async () => {
    const { createMenuHandlers, runnableIds } = await import('../client/v2/shell/menu-runner.js');
    const said: string[] = [];
    const h = createMenuHandlers({ toast: (m: string) => said.push(m) });
    expect(runnableIds(h)).toContain('view.advanced-open-all');
    expect(runnableIds(h)).toContain('view.advanced-close-all');
    h['view.advanced-open-all']();
    expect(FOLD_PANELS.every((id) => foldStore.get(id))).toBe(true);
    h['view.advanced-close-all']();
    expect(FOLD_PANELS.some((id) => foldStore.get(id))).toBe(false);
    expect(said).toEqual(['All Advanced sections are open.', 'All Advanced sections are closed.']);
  });
});
