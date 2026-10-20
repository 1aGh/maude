// S9.21c (10 co-browser-view; 04 md-edge-viewer) — a link opened in a plain browser.
//   · Can view boots in Preview (no toolbar: the toolbar is Edit / Viewing only) — canvas-modes `initialMode`
//   · Preview's chrome in that browser: the PreviewBar ("esc for Viewing"), the zoom readout, and the
//     "Open in the Mac app" island, bottom right — a plain link to the canvas' own maude://open link
//   · the island shows on a cloud cell in a browser only: never in the desktop app, never on a local studio,
//     never for a link that is not a maude://open canvas link (it is built by the shell, not by a canvas)
//   · the server side (hidden ≠ refused): the observer's writes are refused by both doors — pinned in
//     access-role-matrix.test.ts; the island adds no route and writes nothing.
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
import { initialMode, NO_CAPS } from '../bridge/canvas-modes.ts';
import { buildShareLinks } from '../client/share-link.js';
import { OPEN_IN_APP_WORDS, OpenInApp, openInAppLink } from '../client/v2/preview/open-in-app.jsx';
import { PreviewChrome } from '../client/v2/preview/preview-chrome-host.jsx';
import { capsFor } from '../client/v2/shell/canvas-mode.js';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

async function mount(el: unknown) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(el as never);
  });
  return host;
}
const q = (sel: string) => host?.querySelector(sel) ?? null;
const text = (sel: string) => q(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

// The cloud cell's own address, the way a browser tab on a link sees it.
const CELL = {
  origin: 'https://alligators.cloud.maude.sh',
  pathname: '/',
};
const appLinkOf = (rel: string) =>
  buildShareLinks({
    rel,
    shell: 'cloud',
    location: CELL,
    linkedHubUrl: null,
    project: 'Alligators brand',
    localUrl: CELL.origin,
    readOnly: true,
  }).app;

describe('a view-only link boots in Preview', () => {
  test('Can view: Preview, and the toolbar is not there (no edit, no annotate, no comment)', () => {
    const caps = capsFor({ canEdit: false, role: 'observer' });
    expect(caps).toEqual(NO_CAPS);
    expect(initialMode(caps)).toBe('preview');
  });
});

describe('openInAppLink: where the island shows', () => {
  const link = appLinkOf('ui/2026/combine/Combine-kampan.tsx');
  test('the cell builds a maude://open link for the open canvas', () => {
    expect(link).toMatch(/^maude:\/\/open\/alligators\?open=/);
  });
  test('a browser tab on a cloud cell: the canvas link', () => {
    expect(openInAppLink({ native: false, cloud: true, appLink: link })).toBe(link);
  });
  test('the desktop app is the Mac app: no island', () => {
    expect(openInAppLink({ native: true, cloud: true, appLink: link })).toBeNull();
  });
  test('a local studio in a browser has no cloud link to hand over', () => {
    expect(openInAppLink({ native: false, cloud: false, appLink: link })).toBeNull();
  });
  test('only a maude://open canvas link — never another scheme, never a connect code', () => {
    for (const bad of [
      null,
      '',
      'javascript:alert(1)',
      'https://evil.example/',
      'maude://open/alligators?code=mhc_0123456789abcdef',
      'maude://open/alligators?open=ui%2Fa.tsx&code=x',
    ])
      expect(openInAppLink({ native: false, cloud: true, appLink: bad })).toBeNull();
  });
});

describe('OpenInApp: the island', () => {
  test('a plain link with the Mark and the words, bottom-band occluder', async () => {
    const link = appLinkOf('ui/2026/combine/Combine-kampan.tsx') as string;
    await mount(<OpenInApp href={link} />);
    const a = q('[data-testid="preview-open-app"]') as HTMLAnchorElement | null;
    expect(a?.tagName).toBe('A');
    expect(a?.getAttribute('href')).toBe(link);
    expect(a?.getAttribute('data-occludes')).toBe('bottom');
    expect(a?.classList.contains('island')).toBe(true);
    expect(text('[data-testid="preview-open-app"]')).toBe(OPEN_IN_APP_WORDS.label);
    expect(OPEN_IN_APP_WORDS.label).toBe('Open in the Mac app');
    expect(a?.querySelector('svg')).not.toBeNull();
  });
  test('no link, no island', async () => {
    await mount(<OpenInApp href={null} />);
    expect(q('[data-testid="preview-open-app"]')).toBeNull();
  });
});

describe('PreviewChrome in the browser (co-browser-view)', () => {
  const link = appLinkOf('ui/2026/combine/Combine-kampan.tsx');
  test('Preview: the bar says esc for Viewing, the zoom readout, and Open in the Mac app', async () => {
    await mount(
      <PreviewChrome
        mode="preview"
        caps={NO_CAPS}
        name="Combine-kampan"
        zoom={0.27}
        openApp={link}
      />
    );
    expect(text('[data-testid="preview-bar-esc"]')).toBe('esc for Viewing');
    expect(text('[data-testid="zoom-only"]')).toBe('27%');
    expect(q('[data-testid="preview-open-app"]')?.getAttribute('href')).toBe(link);
  });
  test('the desktop app (no link): the same chrome without the island', async () => {
    await mount(<PreviewChrome mode="preview" caps={NO_CAPS} name="Combine-kampan" zoom={1} />);
    expect(q('[data-testid="preview-bar"]')).not.toBeNull();
    expect(q('[data-testid="preview-open-app"]')).toBeNull();
  });
  test('out of Preview the island goes with the rest of the chrome', async () => {
    await mount(
      <PreviewChrome mode="viewing" caps={NO_CAPS} name="Combine-kampan" zoom={1} openApp={link} />
    );
    expect(q('[data-testid="preview-open-app"]')).toBeNull();
    expect(q('[data-testid="zoom-only"]')).toBeNull();
  });
  test('the exit fade carries the island too', async () => {
    await mount(
      <PreviewChrome
        mode="preview"
        caps={NO_CAPS}
        name="Combine-kampan"
        zoom={1}
        openApp={link}
        state="out"
      />
    );
    expect(q('[data-testid="preview-open-app"]')?.getAttribute('data-state')).toBe('out');
  });
});
