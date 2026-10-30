// P8 dynamic dead-control sweep — Settings › Connections › "Add a team server…" in the BROWSER shell
// (no window.__TAURI__) crashed the shell: the dialog's mount effect called managedProjectsList(),
// whose invoke() THROWS synchronously outside the app, so the `.catch()` beside it never ran and
// the shell error boundary drew "[shell] render error: GitHub sign-in is only available in the
// Maude desktop app." Outside the app there are no managed copies: the list is empty.

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
import { managedProjectsList } from '../client/github.js';
import TeamProjects from '../client/panels/TeamProjects.jsx';

let root: Root | null = null;
let host: HTMLElement | null = null;
const realFetch = globalThis.fetch;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  globalThis.fetch = realFetch;
});

describe('the team-projects panel in a plain browser', () => {
  test('managedProjectsList() resolves to no copies instead of throwing', async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = undefined;
    let threw: unknown = null;
    let value: unknown;
    try {
      value = await managedProjectsList();
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeNull();
    expect(value).toEqual([]);
  });

  test('mounts without a render error', async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = undefined;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, connected: false }), {
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    const errors: unknown[] = [];
    const onErr = (e: ErrorEvent) => errors.push(e.error ?? e.message);
    window.addEventListener('error', onErr);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host, { onUncaughtError: (e) => errors.push(e) });
    try {
      await act(async () => {
        root?.render(<TeamProjects serverOnly />);
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    } catch (e) {
      errors.push(e);
    }
    window.removeEventListener('error', onErr);
    expect(errors.map(String)).toEqual([]);
    expect(host.childElementCount).toBeGreaterThan(0);
  });
});
