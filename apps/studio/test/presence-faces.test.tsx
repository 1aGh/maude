// S9.23 — the shell half of presence, against the REAL Share cluster (happy-dom + React):
//   canvas 10 co-presence (face menu), co-twelve (three faces and +8, the people list).
//   · a face opens its menu: "On A4 · plakát · Can edit", Follow, Go to, Bring everyone here
//   · every row goes out as a `presence.*` action with its params; the shell has no second handler
//   · Bring everyone here is owner / editor only: absent for Can view / Can comment (the server strips it too)
//   · twelve people collapse to three faces and "+8"; the list says where each is, idle last
//   · without the `presence` prop the strip is the pre-S9.23 one (a face IS the Follow control)
//   · testids are re-emitted, never renamed
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
import { menuCtx } from '../client/v2/shell/project-menu-model.js';
import { facesOf, saveStatus } from '../client/v2/shell/save-status.js';
import { ShareCluster } from '../client/v2/shell/share-cluster.jsx';

const ctx = menuCtx({ native: true, canvasOpen: true });
const linked = { linked: true, online: true, phase: 'synced', pending: 0, writeFailed: null };
const NOW = Date.now();
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

const LABELS: Record<string, string> = { a4: 'A4 · plakát', web: 'Web · STAŇ SE GATOREM' };
type Run = [string, Record<string, unknown> | undefined];

async function mount(
  peers: Array<Record<string, unknown>>,
  over: { canSummon?: boolean; presence?: null } = {}
) {
  const ran: Run[] = [];
  const shell: string[] = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const presence =
    over.presence === null
      ? undefined
      : {
          run: (id: string, params?: Record<string, unknown>) => ran.push([id, params]),
          labelOf: (id: string) => LABELS[id] ?? null,
          roleOf: () => 'member',
          canSummon: over.canSummon ?? true,
          canvasLabel: 'Combine-kampan',
        };
  await act(async () => {
    root?.render(
      <ShareCluster
        faces={facesOf({ you: 'Michal Dovrtěl', peers: peers as never, max: 40 })}
        onFollow={(id: number) => shell.push(`follow:${id}`)}
        presence={presence}
        status={saveStatus(linked)}
        ctx={ctx}
        run={() => {}}
        onStatusAction={() => {}}
      />
    );
  });
  const q = (id: string) => host?.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const click = async (el: Element | null) => {
    await act(async () => (el as HTMLElement | null)?.click());
  };
  return { ran, shell, q, click, host };
}

const TEREZA = { clientID: 7, name: 'Tereza K', artboard: 'a4' };
const JONAS = { clientID: 9, name: 'Jonas', artboard: 'web' };

describe('the face menu (co-presence)', () => {
  test('a face opens a menu: who, where and their role, Follow, Go to, Bring everyone here', async () => {
    const { q, click } = await mount([TEREZA, JONAS]);
    expect(q('presence-face-menu')).toBeNull();
    await click(q('share-cluster-face-7'));
    const menu = q('presence-face-menu');
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain('Tereza K');
    expect(q('presence-face-menu-where')?.textContent).toBe('On A4 · plakát · Can edit');
    expect(q('presence-face-menu-follow')?.textContent).toBe('Follow Tereza');
    expect(q('presence-face-menu-go-to')?.textContent).toBe('Go to A4 · plakát');
    expect(q('presence-face-menu-bring')?.textContent).toBe('Bring everyone here');
  });

  test('each row runs its registry action with the person, and closes the menu', async () => {
    const { ran, q, click } = await mount([TEREZA, JONAS]);
    await click(q('share-cluster-face-7'));
    await click(q('presence-face-menu-follow'));
    expect(ran.at(-1)).toEqual(['presence.follow', { clientID: 7 }]);
    expect(q('presence-face-menu')).toBeNull();
    await click(q('share-cluster-face-9'));
    await click(q('presence-face-menu-go-to'));
    expect(ran.at(-1)).toEqual(['presence.go-to', { clientID: 9 }]);
    await click(q('share-cluster-face-7'));
    await click(q('presence-face-menu-bring'));
    expect(ran.at(-1)).toEqual(['presence.bring-everyone', undefined]);
  });

  test('someone I follow reads "Stop following"; a person with no known artboard has no Go to', async () => {
    const { q, click } = await mount([
      { ...TEREZA, following: true },
      { clientID: 3, name: 'Petra' },
    ]);
    await click(q('share-cluster-face-7'));
    expect(q('presence-face-menu-follow')?.textContent).toBe('Stop following Tereza');
    await click(q('share-cluster-face-3'));
    expect(q('presence-face-menu-go-to')).toBeNull();
    expect(q('presence-face-menu-where')?.textContent).toBe('On this canvas · Can edit');
  });

  test('Bring everyone here is owner / editor only: absent for Can view and Can comment', async () => {
    const { q, click } = await mount([TEREZA], { canSummon: false });
    await click(q('share-cluster-face-7'));
    expect(q('presence-face-menu-follow')).not.toBeNull();
    expect(q('presence-face-menu-bring')).toBeNull();
  });

  test('esc and a click elsewhere close it; the face carries a tone, never coral', async () => {
    const { q, click } = await mount([TEREZA]);
    await click(q('share-cluster-face-7'));
    expect(q('presence-face-menu')).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(q('presence-face-menu')).toBeNull();
    await click(q('share-cluster-face-7'));
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(q('presence-face-menu')).toBeNull();
    const tone = q('share-cluster-face-7')?.getAttribute('style') ?? '';
    expect(tone).toMatch(/--object-(sky|green|yellow|lilac|grey)/);
    expect(tone).not.toContain('coral');
  });
});

describe('twelve people on one canvas (co-twelve)', () => {
  const crowd = () => [
    TEREZA,
    JONAS,
    { clientID: 3, name: 'Petra' },
    { clientID: 4, name: 'Lukáš' },
    { clientID: 5, name: 'Klára' },
    { clientID: 6, name: 'Ondřej' },
    { clientID: 8, name: 'Vojta', surface: 'browser' },
    { clientID: 10, name: 'Filip', inComments: true },
    { clientID: 11, name: 'Eliška', idleSince: NOW - 4 * 60_000 },
    { clientID: 12, name: 'Radek', idleSince: NOW - 12 * 60_000 },
    { clientID: 13, name: 'Hana', idleSince: NOW - 25 * 60_000 },
  ];

  test('three faces and +8; nobody is lost', async () => {
    const { q, host } = await mount(crowd());
    const peerFaces = host?.querySelectorAll('[data-testid^="share-cluster-face-"]');
    // three people + the "+8" button (testid share-cluster-faces-more)
    expect(
      Array.from(peerFaces ?? []).filter((e) =>
        /face-\d+$/.test(e.getAttribute('data-testid') ?? '')
      ).length
    ).toBe(3);
    expect(q('share-cluster-faces-more')?.textContent).toBe('+8');
  });

  test('+8 opens the list: "12 on Combine-kampan · you + 11", where each is, idle last, Bring at the foot', async () => {
    const { q, click, host } = await mount(crowd());
    await click(q('share-cluster-faces-more'));
    const list = q('presence-people-list');
    expect(list).not.toBeNull();
    expect(list?.textContent).toContain('12 on Combine-kampan');
    expect(list?.textContent).toContain('you + 11');
    const rows = Array.from(host?.querySelectorAll('[data-testid^="presence-people-row-"]') ?? []);
    expect(rows.length).toBe(11);
    expect(rows.at(-1)?.textContent).toContain('Hana');
    expect(rows.at(-1)?.textContent).toContain('idle · 25 min');
    expect(q('presence-people-row-8')?.textContent).toContain('in a browser');
    expect(q('presence-people-row-10')?.textContent).toContain('in Comments');
    expect(q('presence-people-row-7')?.textContent).toContain('A4 · plakát');
    expect(q('presence-people-bring')?.textContent).toBe('Bring everyone here');
  });

  test('a row opens that person’s menu; the foot row Brings everyone', async () => {
    const { ran, q, click } = await mount(crowd());
    await click(q('share-cluster-faces-more'));
    await click(q('presence-people-row-13'));
    expect(q('presence-people-list')).toBeNull();
    expect(q('presence-face-menu')?.textContent).toContain('Hana');
    await click(q('share-cluster-faces-more'));
    await click(q('presence-people-bring'));
    expect(ran.at(-1)?.[0]).toBe('presence.bring-everyone');
  });

  test('a Can view session sees the list but no Bring row', async () => {
    const { q, click } = await mount(crowd(), { canSummon: false });
    await click(q('share-cluster-faces-more'));
    expect(q('presence-people-list')).not.toBeNull();
    expect(q('presence-people-bring')).toBeNull();
  });
});

describe('the pre-S9.23 strip is still there without the presence prop', () => {
  test('a face is the Follow control; testids and labels unchanged', async () => {
    const { q, click, shell } = await mount([TEREZA], { presence: null });
    const face = q('share-cluster-face-7');
    expect(face?.getAttribute('aria-label')).toBe('Follow Tereza');
    await click(face);
    expect(shell).toEqual(['follow:7']);
    expect(q('presence-face-menu')).toBeNull();
  });
});
