// p8-e2e-fix-r6 (decision v2-p8-raise-notice-from-shell-access-widen) — a Can view desktop studio holds no hub
// socket, so the hub's `access raised` notice never reaches it. The shell says the raise itself: when a /_config
// re-read (access-changed) widens the role on the OPEN canvas from Can view / Can comment to Can edit, it shows
// "You can edit <canvas> now." (S9-slices.md S9.21) — once; never on first load, a narrowing, an unchanged role
// or a different canvas; and never twice when the hub's own raised frame says it too.
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ACCESS_FRAME_EVENT } from '../client/v2/access/access-client.js';
import { AccessHost, roleWidened } from '../client/v2/access/access-host.jsx';

beforeAll(() => {
  if (typeof globalThis.document === 'undefined') GlobalRegistrator.register();
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

describe('roleWidened (pure)', () => {
  const A = 'ui/Combine-kampan.tsx';
  test('Can view / Can comment → Can edit or Owner on the same canvas widens', () => {
    expect(roleWidened({ rel: A, role: 'observer' }, { rel: A, role: 'member' })).toBe(true);
    expect(roleWidened({ rel: A, role: 'viewer' }, { rel: A, role: 'member' })).toBe(true);
    expect(roleWidened({ rel: A, role: 'observer' }, { rel: A, role: 'owner' })).toBe(true);
  });
  test('first load, narrowing, unchanged, unknown or another canvas never does', () => {
    expect(roleWidened(null, { rel: A, role: 'member' })).toBe(false);
    expect(roleWidened({ rel: A, role: undefined }, { rel: A, role: 'member' })).toBe(false);
    expect(roleWidened({ rel: A, role: 'member' }, { rel: A, role: 'observer' })).toBe(false);
    expect(roleWidened({ rel: A, role: 'member' }, { rel: A, role: 'member' })).toBe(false);
    expect(roleWidened({ rel: A, role: 'observer' }, { rel: A, role: 'viewer' })).toBe(false);
    expect(roleWidened({ rel: A, role: 'observer' }, { rel: 'ui/B.tsx', role: 'member' })).toBe(
      false
    );
    expect(roleWidened({ rel: null, role: 'observer' }, { rel: null, role: 'member' })).toBe(false);
  });
});

describe('the host says the raise when the open canvas role widens', () => {
  function mount(role: string | undefined, activePath = '.design/ui/Combine-kampan.tsx') {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ legacy: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    const el = document.createElement('div');
    document.body.append(el);
    const root = createRoot(el);
    const toast = mock((_n: unknown) => {});
    const props = (r: string | undefined, p: string) => ({
      activePath: p,
      designRel: '.design',
      tabs: [{ path: p }],
      project: 'Alligators brand',
      canEdit: r === 'member' || r === 'owner',
      role: r,
      toast,
      run: () => {},
      onOpenTab: () => {},
    });
    act(() => root.render(createElement(AccessHost, props(role, activePath))));
    return {
      toast,
      set: (r: string | undefined, p = activePath) =>
        act(() => root.render(createElement(AccessHost, props(r, p)))),
      titles: () => toast.mock.calls.map((c) => (c[0] as { title: string }).title),
      unmount: () => {
        act(() => root.unmount());
        el.remove();
      },
    };
  }

  test('Can view → Can edit: the callout once, in the contract words', () => {
    const h = mount('observer');
    expect(h.toast).toHaveBeenCalledTimes(0);
    h.set('member');
    expect(h.titles()).toEqual(['You can edit Combine-kampan now.']);
    expect((h.toast.mock.calls[0][0] as { kind: string }).kind).toBe('success');
    h.set('member');
    expect(h.toast).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  test('first load as an editor, a narrowing, or a widening on another canvas says nothing', () => {
    const h = mount('member');
    h.set('observer');
    h.set('observer', '.design/ui/Other.tsx');
    h.set('member', '.design/ui/Combine-kampan.tsx');
    expect(h.toast).toHaveBeenCalledTimes(0);
    h.unmount();
  });

  test('narrowed then raised again says it again', () => {
    const h = mount('viewer');
    h.set('member');
    h.set('viewer');
    h.set('member');
    expect(h.toast).toHaveBeenCalledTimes(2);
    h.unmount();
  });

  test("the hub's raised frame and the widening say it once between them", () => {
    const h = mount('viewer');
    act(() => {
      window.dispatchEvent(
        new CustomEvent(ACCESS_FRAME_EVENT, { detail: { type: 'access', change: 'raised' } })
      );
    });
    h.set('member');
    expect(h.titles()).toEqual(['You can edit Combine-kampan now.']);
    h.unmount();
  });
});
