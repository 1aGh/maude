// gate-b-sec4 — the Share sheet of a folder whose committed `linkedHub` this Mac never linked: one
// line naming the hub's host and one action, Connect (POST /_api/sync/link/confirm). No Move to
// cloud offer and no "Local project" note while the question is open; after Connect the sheet asks
// the posture again.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ShareSheet } from '../client/v2/share/share-sheet.jsx';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

const ok = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, body });

async function mount(pending: { host: string } | null, confirm = () => ok({ ok: true })) {
  const calls: string[] = [];
  let linked = false;
  const api = {
    posture: () => {
      calls.push('posture');
      return ok(linked ? { linked: true, reachable: false } : { linked: false });
    },
    me: () => ok(null),
    people: () => ok({ people: [] }),
    pendingLink: () => {
      calls.push('pendingLink');
      return ok({ pending });
    },
    confirmLink: () => {
      calls.push('confirmLink');
      linked = true;
      return confirm();
    },
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <ShareSheet
        target={{ path: '.design/ui/Home.tsx', rel: 'ui/Home.tsx', label: 'Home' }}
        links={{ web: null, app: null, local: null }}
        shell="native"
        project="Studio site"
        api={api}
        onClose={() => {}}
      />
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  const q = (id: string) => host?.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  return { q, calls };
}

const click = (el: Element | null) =>
  act(async () => {
    (el as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
  });

describe('a committed link this Mac never made', () => {
  test('asks once, naming the host, with Connect as the one action', async () => {
    const { q } = await mount({ host: 'team.example.com' });
    expect(q('share-link-unconfirmed')?.textContent).toContain(
      'This project says it syncs with team.example.com. Connect?'
    );
    expect(q('share-link-connect')?.textContent).toBe('Connect');
    expect(q('share-local-note')).toBeNull();
    expect(q('share-move')).toBeNull();
  });

  test('Connect asks the server, then the posture again', async () => {
    const { q, calls } = await mount({ host: 'team.example.com' });
    await click(q('share-link-connect'));
    expect(calls.filter((c) => c === 'confirmLink')).toHaveLength(1);
    expect(calls.filter((c) => c === 'posture').length).toBeGreaterThanOrEqual(2);
    expect(q('share-link-unconfirmed')).toBeNull();
  });

  test('a refusal is said, and the question stays', async () => {
    const { q } = await mount({ host: 'team.example.com' }, () =>
      ok({ error: 'read-only', message: 'Ask the owner to change this.' }, 403)
    );
    await click(q('share-link-connect'));
    expect(q('share-error')?.textContent).toBe('Ask the owner to change this.');
    expect(q('share-link-unconfirmed')).not.toBeNull();
  });

  // V2-8.9 r2 M1 — the format callout's Connect only opens this sheet on this row (one-shot focus);
  // the confirm stays this row's, and the sheet tells the callout it happened so it asks again.
  test('opened from the format callout: Connect takes focus; a confirm here is announced', async () => {
    const { requestShareFocus, LINK_CONFIRMED_EVENT } = await import(
      '../client/v2/share/share-model.js'
    );
    requestShareFocus('connect');
    let heard = 0;
    const on = () => heard++;
    window.addEventListener(LINK_CONFIRMED_EVENT, on);
    try {
      const { q, calls } = await mount({ host: 'team.example.com' });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(document.activeElement).toBe(q('share-link-connect'));
      expect(calls.filter((c) => c === 'confirmLink')).toHaveLength(0);
      await click(q('share-link-connect'));
      expect(calls.filter((c) => c === 'confirmLink')).toHaveLength(1);
      expect(heard).toBe(1);
    } finally {
      window.removeEventListener(LINK_CONFIRMED_EVENT, on);
    }
  });

  test('a refused confirm is not announced', async () => {
    const { LINK_CONFIRMED_EVENT } = await import('../client/v2/share/share-model.js');
    let heard = 0;
    const on = () => heard++;
    window.addEventListener(LINK_CONFIRMED_EVENT, on);
    try {
      const { q } = await mount({ host: 'team.example.com' }, () =>
        ok({ error: 'read-only', message: 'Ask the owner to change this.' }, 403)
      );
      await click(q('share-link-connect'));
      expect(heard).toBe(0);
    } finally {
      window.removeEventListener(LINK_CONFIRMED_EVENT, on);
    }
  });

  test('a plain local project is unchanged', async () => {
    const { q } = await mount(null);
    expect(q('share-link-unconfirmed')).toBeNull();
  });
});
