// Plan T22 — "empty membership", the one cell of its Validate line that no
// harness can reach.
//
// The state needs a signed-in cloud account that belongs to NO project. The
// team-project lane runs against a fixture hub with a project in it; the
// cloud lane's stub control plane hands back two. Neither can produce a person
// who is in nothing, which is exactly the moment the product has to be kind:
// an empty list with no explanation reads as breakage, and the person cannot
// tell whether to wait, retry, or ask somebody.
//
// So it is asserted where it is reachable — on the panel itself.

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
import TeamProjects from '../client/panels/TeamProjects.jsx';

let root: Root | null = null;
let host: HTMLElement | null = null;
const realFetch = globalThis.fetch;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  globalThis.fetch = realFetch;
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = undefined;
});

/** The desktop shell this panel lives in, with nothing on this computer yet. */
function nativeShell() {
  (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
    core: { invoke: async () => [] },
    event: { listen: async () => () => {} },
  };
}

/** A control plane that says: signed in, and in nothing. */
function cloudWith(projects: unknown[], email = 'designer@studio.test') {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(typeof input === 'string' ? input : ((input as Request).url ?? input));
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    if (url.includes('/_api/cloud/status'))
      return json({ ok: true, connected: true, email, url: 'https://cloud.maude.sh' });
    if (url.includes('/_api/cloud/projects')) return json({ ok: true, projects });
    return json({ ok: true });
  }) as typeof fetch;
}

async function render() {
  nativeShell();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<TeamProjects variant="door" />);
  });
  // The panel loads its status and then its projects — two awaited hops.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return host as HTMLElement;
}

describe('a designer who is in no project yet', () => {
  test('is told so, and told what to do about it', async () => {
    cloudWith([]);
    const el = await render();
    const empty = el.querySelector('[data-testid="team-cloud-empty"]');
    expect(empty).not.toBeNull();
    const said = empty?.textContent ?? '';
    // It names the person, so they can ask for the right address to be added.
    expect(said).toContain('designer@studio.test');
    // And it says who to ask, rather than leaving a blank panel.
    expect(said.toLowerCase()).toContain('invite');
    // An empty membership is not an error: nothing here claims a failure.
    expect(el.querySelector('[data-testid="team-error"]')).toBeNull();
  });

  test('a person who IS in a project never sees it', async () => {
    cloudWith([
      { id: 'p1', name: 'Team project', role: 'member', state: 'active', url: 'https://x.test' },
    ]);
    const el = await render();
    expect(el.querySelector('[data-testid="team-cloud-empty"]')).toBeNull();
    expect(el.querySelector('[data-testid="team-cloud-project-p1"]')).not.toBeNull();
  });
});
