// P8 C8 (01 cf-open-big) — the panels' hide key folds the whole chrome as board 01 draws it: the toolbar folds to its
// one current tool (canvas side, `view-chrome {zen}`), the project pill folds to its mark, the share cluster is zen
// (the panels button alone), and the "Panels hidden" notice sits at the TOP (kg v2-p8-c4-toast-dock-or-top).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { acceptFromShell } from '../bridge/dgn-protocol.ts';
import { ToolPalette } from '../tool-palette.tsx';
import { ChromeVisibilityProvider } from '../use-chrome-visibility.tsx';
import { createPanelLayout } from '../client/v2/shell/panel-layout.js';
import { ToolProvider } from '../use-tool-mode.tsx';

let root: Root | null = null;
let host: HTMLElement | null = null;
function mount(ui: ReactNode): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(ui);
  });
}
afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = host = null;
});
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe('toolbar folded (canvas side)', () => {
  test('zen: one pressed tool glyph, no controls; not zen: the full Edit toolbar', () => {
    mount(
      <ChromeVisibilityProvider initial={{ zen: true }}>
        <ToolProvider>
          <ToolPalette />
        </ToolProvider>
      </ChromeVisibilityProvider>
    );
    const zen = q('toolbar-zen');
    expect(zen).not.toBeNull();
    expect(zen?.getAttribute('aria-hidden')).toBe('true');
    expect(zen?.querySelectorAll('button')).toHaveLength(0);
    expect(zen?.querySelectorAll('svg')).toHaveLength(1);
    expect(q('toolbar-edit')).toBeNull();
  });
  test('not zen keeps the Edit toolbar', () => {
    mount(
      <ChromeVisibilityProvider>
        <ToolProvider>
          <ToolPalette />
        </ToolProvider>
      </ChromeVisibilityProvider>
    );
    expect(q('toolbar-zen')).toBeNull();
    expect(q('toolbar-edit')).not.toBeNull();
  });
});

describe('the shell side of the fold', () => {
  const shell = { name: 'shell' } as unknown as Window;
  const win = { parent: shell } as unknown as Window;
  const ev = (data: unknown, source: unknown) =>
    ({ data, source, origin: 'http://localhost' }) as unknown as MessageEvent;
  test('view-chrome accepts a boolean zen and nothing else', () => {
    expect(acceptFromShell(ev({ dgn: 'view-chrome', zen: true }, shell), win)).not.toBeNull();
    expect(acceptFromShell(ev({ dgn: 'view-chrome', zen: 'yes' }, shell), win)).toBeNull();
  });
  test('"Panels hidden" is an app-state notice: it asks for the top', () => {
    const said: Array<Record<string, unknown>> = [];
    const layout = createPanelLayout({ say: (n: Record<string, unknown>) => said.push(n) });
    layout.hide();
    expect(said).toHaveLength(1);
    expect(said[0]?.placement).toBe('top');
    expect(said[0]?.title).toBe('Panels hidden. Press ⌘\\ to bring them back.');
  });
  test('the pill, the cluster and the frames follow the person’s hide (source pins)', () => {
    const client = join(import.meta.dir, '../client');
    const app = readFileSync(join(client, 'app.jsx'), 'utf8');
    expect(app).toContain('folded={previewing || panelsUserHiddenLayout}');
    expect(app).toContain("{ dgn: 'view-chrome', zen: panelsUserHidden }");
    const bridge = readFileSync(join(client, 'hooks/use-canvas-bridge.jsx'), 'utf8');
    expect(bridge).toContain('zen: panelLayout.get().userHidden');
    const cluster = readFileSync(join(client, 'v2/shell/share-cluster.jsx'), 'utf8');
    expect(cluster).toContain("data-zen={panelsHidden ? 'true' : undefined}");
    const css = readFileSync(join(client, 'v2/shell/share-cluster.css'), 'utf8');
    expect(css).toContain('.st-share[data-zen="true"] > :not([data-testid="share-cluster-panels"])');
  });
});
