// V2-4.gate-d — the named render tests the nothing-deleted audit accepts as proof (HOOK_PROOFS in
// scripts/v2-manifest/reach-rules.mjs) for kept hooks the headless probe cannot or should not stage:
//   · [data-photo-bgremove-status]   a local harness canvas the CLI drives (`maude design photo-bg-remove`), never
//                                    a surface a person opens, so no probe state reaches it
//   · readiness-autosetup-where      the AI-readiness dialog, opened only from the desktop menu's native item
// Each test renders the hook and asserts it is on screen; `proofHolds` only checks this file still says so.

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
import { PhotoBgRemoveHarness } from '../canvas-lib.tsx';
import { ReadinessDialog } from '../client/panels/ReadinessList.jsx';

let root: Root | null = null;
let host: HTMLElement | null = null;
const realFetch = globalThis.fetch;

function mount(ui: React.ReactNode): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(ui);
  });
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  globalThis.fetch = realFetch;
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

const flush = () => act(async () => new Promise((r) => setTimeout(r, 20)));

describe('V2-4.gate proofs: the background-removal harness', () => {
  test('[data-photo-bgremove-status] is on the page, pending first and error when the source cannot be fetched', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    mount(<PhotoBgRemoveHarness source="assets/ab12cd34.png" />);
    const el = () => document.querySelector('[data-photo-bgremove-status]') as HTMLElement | null;
    expect(el()).not.toBeNull();
    expect(el()?.getAttribute('data-photo-bgremove-status')).toBe('pending');
    await flush();
    expect(el()?.getAttribute('data-photo-bgremove-status')).toBe('error');
    expect(el()?.getAttribute('data-photo-bgremove-error')).toContain('source fetch failed');
  });
});

describe('V2-4.gate proofs: the AI-readiness dialog', () => {
  test('readiness-autosetup-where names the setting that stops the offers, in the desktop app only', async () => {
    globalThis.fetch = (async () =>
      Response.json({ ready: true, items: [] })) as unknown as typeof fetch;
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: async () => null },
    };
    mount(<ReadinessDialog open onClose={() => {}} />);
    await flush();
    const where = document.querySelector('[data-testid="readiness-autosetup-where"]');
    expect(where).not.toBeNull();
    expect(where?.textContent).toContain('Install and sign in automatically');
  });

  test('…and a browser tab does not draw it', async () => {
    globalThis.fetch = (async () =>
      Response.json({ ready: true, items: [] })) as unknown as typeof fetch;
    mount(<ReadinessDialog open onClose={() => {}} />);
    await flush();
    expect(document.querySelector('[data-testid="readiness-autosetup-where"]')).toBeNull();
  });
});
