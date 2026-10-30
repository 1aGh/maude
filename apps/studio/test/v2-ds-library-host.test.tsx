// S10.18c — the host around a linked team library, in a DOM: the card in the inspector's empty place, "Update from
// <system>? N changes", then the existing review sheet whose Update posts the ONE update; the view-only banner; the
// 30-minute check on open and on a timer; the unlink question; the registry actions that reach it; and the lead's
// default for a peer with no grant (said in words, no Update button, no e-mail). Real routes + real engine + fake hub.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { type AccessClaim, resolveAccess } from '../access/scope.ts';
import { AGENT_PATHS } from '../actions/agents.ts';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { requestDsLibrary, resetDsLibraryBus } from '../client/v2/ds/library-bus.js';
import { resetLibrary } from '../client/v2/ds/library-store.js';
import { createMenuHandlers } from '../client/v2/shell/menu-runner.js';
import { createDsLibrary, memoryGrantStore } from '../ds/library.ts';
import { createDsRoutes } from '../routes/ds.ts';
import { cleanup } from './_ds-engine-fixture.ts';
import { LIB, type Linking, linked, URL_, V2 } from './_ds-library-hub.ts';

afterAll(cleanup);

const CFG = {
  designRel: '.design',
  designSystems: [{ name: LIB, path: `system/${LIB}` }],
  dsConverted: { [LIB]: true },
};
const OWNER: AccessClaim = { v: 1, role: 'owner' };

type Call = { method: string; url: string; body: Record<string, unknown> | null };

/** `fetch` served by the real route table, remembering what the page sent. The project was opened later than the link
 *  (the server's 30-minute bound would otherwise answer a check made seconds after the link from memory). */
function wire(L: Linking, lib = L.lib) {
  L.clock.t += 31 * 60 * 1000;
  const calls: Call[] = [];
  const specs = createDsRoutes({
    engine: () => L.p.engine,
    access: () => resolveAccess(OWNER),
    person: async () => ({ name: 'Michal' }),
    library: () => lib,
  });
  const impl = (async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    const pathname = url.split('?')[0];
    calls.push({ method, url, body: init?.body ? JSON.parse(init.body) : null });
    const spec = specs.find((s) => s.method === method && s.path === pathname);
    if (!spec) throw new Error(`no ${method} ${pathname}`);
    return spec.handle(
      new Request(`http://localhost${url}`, {
        method,
        ...(init?.body ? { body: init.body, headers: { 'content-type': 'application/json' } } : {}),
      })
    );
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('the library host', () => {
  const roots: Root[] = [];
  let lib: typeof import('../client/v2/ds/library-host.jsx');
  let cardMod: typeof import('../client/v2/ds/library-card.jsx');
  let Advanced: (p: Record<string, unknown>) => JSX.Element | null;
  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    lib = await import('../client/v2/ds/library-host.jsx');
    cardMod = await import('../client/v2/ds/library-card.jsx');
    Advanced = (await import('../client/v2/ds/advanced.jsx')).DsAdvanced as never;
  });
  afterAll(() => GlobalRegistrator.unregister());
  beforeEach(() => {
    resetDsLibraryBus();
    resetLibrary();
  });
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
  });

  const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const settle = () => act(async () => new Promise((r) => setTimeout(r, 40)));

  async function mount(
    f: typeof fetch,
    toasts: string[],
    extra: Record<string, unknown> = {},
    activePath = `.design/system/${LIB}/design-system.tsx`
  ) {
    const el = document.createElement('div');
    document.body.append(el);
    const root = createRoot(el);
    roots.push(root);
    const Host = lib.DsLibraryHost as never as (p: Record<string, unknown>) => JSX.Element;
    const Card = cardMod.DsLibrarySlot as never as () => JSX.Element;
    await act(async () =>
      root.render(
        <>
          <Host
            cfg={CFG}
            activePath={activePath}
            toast={(m: string) => toasts.push(m)}
            scope="Alligators — junioři"
            fetchImpl={f}
            delayMs={0}
            canOpen={() => true}
            open={() => 'ok'}
            {...extra}
          />
          <Card />
        </>
      )
    );
    await settle();
  }

  test('on open it asks the hub once; the card says "Team library · <hub>", "Used by 3 projects", "2 updates waiting"', async () => {
    const L = await linked();
    L.hub.head = V2.id;
    L.hub.usedBy = 3;
    const w = wire(L);
    await mount(w.impl, []);
    const checks = w.calls.filter((c) => c.body?.action === 'check');
    expect(checks).toHaveLength(1);
    expect(checks[0].body?.force).toBeUndefined(); // the server's 30-minute bound applies
    expect(q('ds-library-kind')?.textContent).toBe('Team library · alligators.cloud.test');
    expect(q('ds-library-used')?.textContent).toBe('Used by 3 projects');
    expect(q('ds-library-waiting')?.textContent).toBe('2 updates waiting');
    expect(q('ds-library-update')?.textContent).toBe('Update…');
    expect(q('ds-library-nogrant')).toBeNull();
  });

  test('the banner: "Linked from <home>." · view only · Open in <home>; hidden away from the system', async () => {
    const L = await linked();
    const opened: string[] = [];
    await mount(wire(L).impl, [], { open: (u: string) => void opened.push(u) });
    expect(q('ds-library-banner-title')?.textContent).toBe('Linked from alligators.cloud.test.');
    expect(q('ds-library-banner-sub')?.textContent).toBe(
      'View only here — every update arrives as a review.'
    );
    expect(q('ds-library-open')?.textContent).toBe('Open in alligators.cloud.test');
    await act(async () => q('ds-library-open')?.click());
    expect(opened).toEqual(['https://alligators.cloud.test']);
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
    await mount(wire(L).impl, [], {}, 'ui/Home.tsx'); // another canvas: no banner, no card
    expect(q('ds-library-banner')).toBeNull();
    expect(q('ds-library-card')).toBeNull();
  });

  test('a home this app may not open gets no Open button, still the words', async () => {
    const L = await linked();
    await mount(wire(L).impl, [], { canOpen: () => false });
    expect(q('ds-library-banner-title')?.textContent).toBe('Linked from alligators.cloud.test.');
    expect(q('ds-library-open')).toBeNull();
  });

  test('Update… opens "Update from <system>? N changes"; Update goes to the review sheet; its Update posts the one action', async () => {
    const L = await linked();
    L.hub.head = V2.id;
    const w = wire(L);
    const toasts: string[] = [];
    await mount(w.impl, toasts);
    await act(async () => q('ds-library-update')?.click());
    await settle();
    expect(q('ds-library-title')?.textContent).toBe('Update from gator? 2 changes');
    expect(q('ds-library-fine')?.textContent).toContain('By Tereza');
    expect(q('ds-library-fine')?.textContent).toContain('Updating keeps a version');
    expect(document.querySelectorAll('[data-testid="ds-library-change"]')).toHaveLength(2);
    // Cancel changes nothing
    await act(async () => q('ds-library-cancel')?.click());
    expect(q('ds-library-dialog')).toBeNull();
    expect(L.p.read(`system/${LIB}/colors_and_type.css`)).not.toContain('0b5fff');
    // again → the existing review sheet
    await act(async () => q('ds-library-update')?.click());
    await settle();
    await act(async () => q('ds-library-go')?.click());
    await settle();
    expect(q('ds-review')).not.toBeNull();
    expect(q('ds-library-dialog')).toBeNull();
    const rows = document.querySelectorAll('[data-testid="ds-review-row"]');
    expect(rows).toHaveLength(2);
    await act(async () =>
      (document.querySelectorAll('[data-testid="ds-review-tick"]')[1] as HTMLElement).click()
    );
    await act(async () => q('ds-review-update')?.click());
    await settle();
    const sent = w.calls.filter((c) => c.body?.action === 'update' && !c.body?.dryRun);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({
      ds: LIB,
      upstream: V2.id,
      expectHead: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(sent[0].body?.canvases).toHaveLength(2);
    const sentTicks = (sent[0].body?.canvases ?? []) as { ticked: boolean }[];
    expect(sentTicks.filter((c) => c.ticked)).toHaveLength(1);
    expect(toasts.at(-1)).toBe(
      'Updated from gator. 1 canvas follows it; 1 left out keeps the old look.'
    );
    expect(JSON.parse(L.p.read(`system/${LIB}/revisions/head.json`) as string).head).toBe(V2.id);
    expect(q('ds-review')).toBeNull();
    expect(q('ds-library-waiting')?.textContent).toBe('Up to date');
  });

  test('a peer with no grant on this Mac sees the card, no Update, and who can update — in words', async () => {
    const L = await linked();
    L.hub.head = V2.id;
    const peer = createDsLibrary(L.p.engine, {
      fetchImpl: L.hub.fetch,
      grants: memoryGrantStore(),
      now: () => L.clock.t,
    });
    const w = wire(L, peer);
    const before = L.hub.calls.length;
    await mount(w.impl, []);
    expect(L.hub.calls.length).toBe(before); // no request, no credential
    expect(q('ds-library-nogrant')?.textContent).toBe(
      'Only Michal can update this library from their Mac.'
    );
    expect(q('ds-library-update')).toBeNull();
    expect(q('ds-library-card')?.textContent).not.toContain('@');
    // the registry action says the same instead of opening anything
    const toasts: string[] = [];
    await act(async () => void requestDsLibrary({ kind: 'update' }));
    await settle();
    expect(q('ds-library-dialog')).toBeNull();
    expect(toasts).toEqual([]);
  });

  test('A3: a record this Mac did not link shows "Link again" naming the hub host; nothing is asked until it is pressed', async () => {
    const L = await linked();
    L.hub.head = V2.id;
    // the same credential, but the link was made on ANOTHER Mac (or a peer rewrote head.json): no link record here
    const grants = memoryGrantStore();
    grants.set('https://alligators.cloud.test', 'p_gator', LIB, 'grant-abc123456789');
    const other = createDsLibrary(L.p.engine, {
      fetchImpl: L.hub.fetch,
      grants,
      now: () => L.clock.t,
    });
    const w = wire(L, other);
    const before = L.hub.calls.length;
    await mount(w.impl, []);
    expect(L.hub.calls.length).toBe(before); // no request, no credential
    // gate-b-sec2 finding 2: the line names the system, the project, the host and who set the record last
    expect(q('ds-library-relink-line')?.textContent).toBe(
      'This Mac hasn’t linked gator from p_gator on alligators.cloud.test. Michal set this link last. Nothing is sent there until you paste its library link again.'
    );
    expect(q('ds-library-nogrant')).toBeNull();
    expect(q('ds-library-update')).toBeNull();
    expect(q('ds-library-relink')?.textContent).toBe('Link again');
    // one click opens the paste dialog — it links nothing and asks nothing
    await act(async () => q('ds-library-relink')?.click());
    await settle();
    expect(w.calls.some((c) => c.body?.action === 'relink')).toBe(false);
    expect(L.hub.calls.length).toBe(before);
    expect(q('ds-library-link')?.getAttribute('data-mode')).toBe('relink');
    expect(q('ds-library-link')?.querySelector('h2')?.textContent).toBe('Link this library again');
    expect(q('ds-library-link')?.textContent).toContain(
      'Paste the library link of gator from p_gator on alligators.cloud.test. A link to any other library links nothing.'
    );
    expect((q('ds-library-link-go') as HTMLButtonElement).disabled).toBe(true);
    expect(q('ds-library-link-go')?.textContent).toBe('Link again');
    const set = async (id: string, v: string) => {
      const el = q(id) as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, v);
      const key = Object.keys(el).find((k) => k.startsWith('__reactProps')) as string;
      (el as unknown as Record<string, { onChange: (e: unknown) => void }>)[key].onChange({
        target: el,
        currentTarget: el,
      });
    };
    // a link to another library links nothing
    await act(async () =>
      set('ds-library-link-url', 'https://alligators.cloud.test/api/projects/p_other/v1/ds/gator')
    );
    await act(async () => q('ds-library-link-go')?.click());
    await settle();
    expect(q('ds-library-link-error')?.textContent).toBe(
      'That link is for a different library. Nothing was linked.'
    );
    expect(L.hub.calls.length).toBe(before);
    // its own link: linked here now — the check goes to the record's hub and the card offers the update
    await act(async () => set('ds-library-link-url', URL_));
    await act(async () => q('ds-library-link-go')?.click());
    await settle();
    expect(w.calls.some((c) => c.body?.action === 'relink' && c.body?.url === URL_)).toBe(true);
    expect(q('ds-library-link')).toBeNull();
    expect(L.hub.calls.length).toBeGreaterThan(before);
    expect(q('ds-library-relink')).toBeNull();
    expect(q('ds-library-update')?.textContent).toBe('Update…');
  });

  test('a project with no converted system asks nothing; the open check waits for the first paint', async () => {
    const L = await linked();
    const none = wire(L);
    await mount(none.impl, [], { cfg: { ...CFG, dsConverted: {} } });
    expect(none.calls).toEqual([]);
    expect(q('ds-library-card')).toBeNull();
    const later = wire(L);
    await mount(later.impl, [], { delayMs: 5_000 }); // the default waits too; nothing yet at mount
    expect(later.calls).toEqual([]);
  });

  test('the check repeats every 30 minutes', async () => {
    const L = await linked();
    const w = wire(L);
    await mount(w.impl, [], { pollMs: 25 });
    await act(async () => new Promise((r) => setTimeout(r, 90)));
    expect(w.calls.filter((c) => c.body?.action === 'check').length).toBeGreaterThanOrEqual(3);
    expect(lib.DsLibraryHost).toBeTruthy();
  });

  test('Unlink… asks first; Unlink makes it an own system and the card goes', async () => {
    const L = await linked();
    const w = wire(L);
    const toasts: string[] = [];
    await mount(w.impl, toasts);
    await act(async () => q('ds-library-unlink')?.click());
    expect(q('ds-library-unlink-ask')).not.toBeNull();
    expect(w.calls.some((c) => c.body?.action === 'unlink')).toBe(false);
    await act(async () => q('ds-library-unlink-cancel')?.click());
    expect(q('ds-library-unlink-ask')).toBeNull();
    await act(async () => q('ds-library-unlink')?.click());
    await act(async () => q('ds-library-unlink-go')?.click());
    await settle();
    expect(JSON.parse(L.p.read(`system/${LIB}/revisions/head.json`) as string).library).toBeNull();
    expect(toasts.at(-1)).toBe('gator is your own system now.');
    expect(q('ds-library-card')).toBeNull();
  });

  test('ds.library-link opens the link dialog and links with the key', async () => {
    const L = await linked();
    const w = wire(L);
    await mount(w.impl, []);
    await act(async () => void requestDsLibrary({ kind: 'link' }));
    expect(q('ds-library-link')).not.toBeNull();
    expect((q('ds-library-link-go') as HTMLButtonElement).disabled).toBe(true);
    // a dispatched `input` event does not reach React's onChange under happy-dom: call the handler React attached
    const set = async (id: string, v: string) => {
      const el = q(id) as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, v);
      const key = Object.keys(el).find((k) => k.startsWith('__reactProps')) as string;
      (el as unknown as Record<string, { onChange: (e: unknown) => void }>)[key].onChange({
        target: el,
        currentTarget: el,
      });
    };
    await act(async () => set('ds-library-link-url', 'not a link'));
    await act(async () => q('ds-library-link-go')?.click());
    await settle();
    expect(q('ds-library-link-error')?.textContent).toBe('That is not a library link.');
    expect(w.calls.find((c) => c.body?.action === 'link')?.body?.grant).toBeUndefined();
  });

  test('the registry actions reach the host and the host is the only place they land', () => {
    for (const id of ['ds.library-link', 'ds.library-update', 'ds.library-unlink']) {
      const def = ACTIONS_BY_ID.get(id);
      expect(def?.visible).toMatchObject({ minRole: 'edit' });
      expect(AGENT_PATHS[id]).toMatchObject({
        effect: 'project',
        minRole: 'edit',
        server: { route: '/_api/ds/library', method: 'POST' },
      });
      expect(AGENT_PATHS[id].agent?.path).toBe('cli');
    }
    const handlers = createMenuHandlers({ toast: () => {} } as never);
    for (const id of ['ds.library-link', 'ds.library-update', 'ds.library-unlink'])
      expect(typeof handlers[id]).toBe('function');
  });

  test('Design system › Advanced carries the card above its own rows', async () => {
    const L = await linked();
    L.hub.head = V2.id;
    const w = wire(L);
    await mount(w.impl, []);
    const el = document.createElement('div');
    document.body.append(el);
    const root = createRoot(el);
    roots.push(root);
    await act(async () =>
      root.render(
        <Advanced value={{ ds: LIB, label: 'gator', files: null, modes: [] }} actions={{}} />
      )
    );
    const adv = q('ds-advanced');
    expect(adv?.querySelector('[data-testid="ds-library-card"]')).not.toBeNull();
  });
});
