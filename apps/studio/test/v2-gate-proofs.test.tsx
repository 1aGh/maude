// V2-4.gate-d — the named render tests the nothing-deleted audit accepts as proof (HOOK_PROOFS in
// scripts/v2-manifest/reach-rules.mjs) for kept hooks the headless probe cannot or should not stage:
//   · [data-photo-bgremove-status]   a local harness canvas the CLI drives (`maude design photo-bg-remove`), never
//                                    a surface a person opens, so no probe state reaches it
//   · readiness-autosetup-where      the AI-readiness dialog, opened only from the desktop menu's native item
//   · .dc-participants / .dc-participant   the canvas's own participant stack: the shell hosts the faces (the Share
//                                    cluster) so a canvas inside it draws none; a standalone canvas still does
//   · [data-section-chip]            a section's label chip: the probe fixture draws no section
//   · artboard-new-section           the frame round a section the page just grew (V2-8.5 c7 08 ak-web-hug): it shows
//                                    for a few seconds after the page changes, and the probe fixture's board never grows
//   · Annotation node labels         the text and sticky editors' aria-labels: an editor is open only mid-edit
//   · root-missing-*                 the moved-folder card of apps/desktop/src/root-missing.html: an app-local page
//                                    the desktop shell shows, never served by the studio the probe boots
// Each test renders the hook and asserts it is on screen; `proofHolds` only checks this file still says so.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { ElementNode } from '../annotations/ui/element-node.tsx';
import { ArtboardNewSection } from '../artboard-new-section.tsx';
import { PhotoBgRemoveHarness } from '../canvas-lib.tsx';
import { ReadinessDialog } from '../client/panels/ReadinessList.jsx';
import { ParticipantsChrome } from '../participants-chrome.tsx';
import { AgentPresenceProvider } from '../use-agent-presence.tsx';

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
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = undefined;
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

describe('V2-4.gate proofs: the canvas participant stack', () => {
  test('.dc-participants draws the working agent as a participant when the canvas is not hosted by the shell', () => {
    mount(
      <AgentPresenceProvider
        initialAgent={{
          id: 'claude:1',
          name: 'Bouncy Otter',
          color: 'oklch(0.7 0.19 322)',
          author: 'Claude acting for Tereza',
          startedAt: 1,
        }}
      >
        <ParticipantsChrome />
      </AgentPresenceProvider>
    );
    const stack = document.querySelector('.dc-participants');
    expect(stack).not.toBeNull();
    expect(stack?.querySelectorAll('.dc-participant').length).toBeGreaterThan(0);
  });
});

describe('V2-4.gate proofs: a section on a board', () => {
  test('[data-section-chip] is the section label chip, drawn from the section element', () => {
    mount(
      <svg width="400" height="300" viewBox="0 0 400 300">
        <title>board</title>
        <ElementNode
          el={
            {
              id: 's1',
              type: 'section',
              index: 'a0',
              x: 10,
              y: 40,
              w: 300,
              h: 200,
              label: 'Ideas',
            } as never
          }
          interactive={false}
          edit={null}
          resolveAsset={(href: string) => href}
        />
      </svg>
    );
    const chip = document.querySelector('[data-section-chip]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('Ideas');
  });
});

describe('V2-8.6 proofs: the frame round a new section', () => {
  test('artboard-new-section is on the page, named for the section, once the page grew one', () => {
    mount(
      <ArtboardNewSection
        x={0}
        y={0}
        section={{ name: 'Rozpis zápasů', x: 0, y: 205, w: 432, h: 112 }}
      />
    );
    const frame = document.querySelector('[data-testid="artboard-new-section"]');
    expect(frame).not.toBeNull();
    expect(frame?.textContent).toContain('Rozpis zápasů · new section');
  });
});

// ── the moved-folder card (apps/desktop/src/root-missing.html) ───────────────────────────────────
// The page is plain HTML with one inline script. The test loads the file itself — its markup and its script,
// not a copy — in the DOM, with a Tauri invoke that answers, and reads the five hooks off it.
const ROOT_MISSING = readFileSync(
  join(import.meta.dir, '../../desktop/src/root-missing.html'),
  'utf8'
);
function loadRootMissing(invoke: (cmd: string, args?: unknown) => Promise<unknown>): void {
  const body = ROOT_MISSING.match(/<body>([\s\S]*?)<script>/)?.[1] ?? '';
  const script = ROOT_MISSING.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
  document.body.innerHTML = body;
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke } };
  new Function(script)();
}
const rm = (hook: string) =>
  document.querySelector(`[data-testid="${hook}"]`) as HTMLElement | null;

describe('V2-4.gate proofs: the moved-folder card', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('root-missing-card names the project, where it was, and offers Find the folder…', async () => {
    loadRootMissing(async (cmd) =>
      cmd === 'resolve_dev_server_url'
        ? { missing: true, pid: 'p1', name: 'Portfolio', place: 'Desktop › Portfolio 2026' }
        : null
    );
    await flush();
    expect(rm('root-missing-card')?.hidden).toBe(false);
    expect(rm('root-missing-title')?.textContent).toBe("Portfolio isn't where it was.");
    expect(rm('root-missing-place')?.textContent).toContain('It was in Desktop › Portfolio 2026.');
    expect(rm('root-missing-place')?.textContent).toContain('Nothing inside has changed');
    expect(rm('root-missing-find')?.textContent).toBe('Find the folder…');
    expect(rm('root-missing-error')?.hidden).toBe(true);
  });

  test('root-missing-error says why a picked folder could not be used, and the button comes back', async () => {
    loadRootMissing(async (cmd) => {
      if (cmd === 'relink_project') throw 'That folder is not this project.';
      return { missing: true, pid: 'p1', name: 'Portfolio', place: '' };
    });
    await flush();
    act(() => rm('root-missing-find')?.click());
    await flush();
    expect(rm('root-missing-error')?.hidden).toBe(false);
    expect(rm('root-missing-error')?.textContent).toBe('That folder is not this project.');
    expect((rm('root-missing-find') as HTMLButtonElement).disabled).toBe(false);
  });
});

// ── annotation editors ──────────────────────────────────────────────────────────────────────────
describe('V2-4.gate proofs: annotation editors', () => {
  test('annotation text and sticky editors carry the labels the node is read by', () => {
    const edit = { caretPoint: null, onCommit: () => {}, onCancel: () => {} };
    mount(
      <div>
        <ElementNode
          el={{ id: 't1', type: 'text', index: 'a0', x: 10, y: 10, text: 'hello' } as never}
          interactive={false}
          edit={edit}
          resolveAsset={(href: string) => href}
        />
        <ElementNode
          el={
            {
              id: 'n1',
              type: 'sticky',
              index: 'a1',
              x: 100,
              y: 100,
              w: 120,
              h: 90,
              text: 'note',
            } as never
          }
          interactive={false}
          edit={edit}
          resolveAsset={(href: string) => href}
        />
      </div>
    );
    expect(document.querySelector('[aria-label="Edit text"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Edit sticky note text"]')).not.toBeNull();
  });
});
