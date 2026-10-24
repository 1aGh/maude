// P8 C4 (lead call v2-p8-lead-canvases-header-and-switcher): the project pill IS the project switcher. The dock at the
// Canvases panel's foot is gone; its hooks live on the pill (repo-switcher-trigger = the pill's wrapper,
// repo-switcher-popup = the Switch project submenu, switcher-open-team = its Open a team project… row).
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
import { ProjectPill } from '../client/v2/shell/project-pill.jsx';

const desktop = menuCtx({ native: true, canvasOpen: true });
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

const pill = () => document.querySelector('[data-testid="project-pill"]') as HTMLButtonElement;
const byId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

async function mountPill(ran: string[], withSwitcher: boolean) {
  const { switcherNode } = await import('../client/panels/RepoBranchSwitcher.jsx');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const switcher = withSwitcher
    ? {
        node: switcherNode(['/p/alligators', '/p/studio'], []),
        run: (id: string) => ran.push(id),
        status: null,
        dialog: null,
      }
    : undefined;
  await act(async () => {
    root?.render(
      <ProjectPill
        project="Alligators brand"
        ctx={desktop}
        state={{}}
        run={(id: string) => ran.push(`run:${id}`)}
        switcher={switcher as never}
      />
    );
  });
}

describe('the project switcher', () => {
  test('the pill carries repo-switcher-trigger and a Switch project submenu opens as repo-switcher-popup', async () => {
    await mountPill([], true);
    const trigger = byId('repo-switcher-trigger');
    expect(trigger).not.toBeNull();
    expect(trigger?.contains(pill())).toBe(true);
    await act(async () => pill().click());
    const sub = byId('project-menu-row-sub-switch-project');
    expect(sub).not.toBeNull();
    await act(async () => sub?.click());
    const popup = byId('repo-switcher-popup');
    expect(popup?.textContent).toContain('alligators');
    expect(popup?.textContent).toContain('Open a team project…');
    expect(popup?.textContent).toContain('Open another folder…');
  });

  test('switcher rows run through the switcher, never the shell runner', async () => {
    const ran: string[] = [];
    await mountPill(ran, true);
    await act(async () => pill().click());
    await act(async () => byId('project-menu-row-sub-switch-project')?.click());
    await act(async () => byId('switcher-open-team')?.click());
    expect(ran).toEqual(['switch:open-team']);
    expect(byId('project-menu')).toBeNull();
  });

  test('a recent project row switches to that path; the current one wears the tick', async () => {
    const ran: string[] = [];
    await mountPill(ran, true);
    await act(async () => pill().click());
    await act(async () => byId('project-menu-row-sub-switch-project')?.click());
    const rows = Array.from(
      byId('repo-switcher-popup')?.querySelectorAll('[role^=menuitem]') ?? []
    ) as HTMLElement[];
    expect(rows[0].getAttribute('aria-checked')).toBe('true');
    expect(rows[1].getAttribute('aria-checked')).toBe('false');
    await act(async () => rows[1].click());
    expect(ran).toEqual(['switch:recent:1']);
  });

  test('without a switcher (a browser tab, Home) there is no trigger id and no Switch project row', async () => {
    await mountPill([], false);
    expect(byId('repo-switcher-trigger')).toBeNull();
    await act(async () => pill().click());
    expect(byId('project-menu-row-sub-switch-project')).toBeNull();
  });
});
