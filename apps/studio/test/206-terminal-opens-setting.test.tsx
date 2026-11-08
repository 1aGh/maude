// #206 (DDR-250, option A) — Settings › General › Terminal › "Let the terminal open projects in Maude".
//
// The switch reads and writes the Tauri pref `terminal_opens` (default on) and exists only where it means
// something: the desktop app, on this Mac (`cloud === null`), in an editing session. A browser tab, a cloud
// tab and a read-only session have no row. No test touches the real prefs file: Tauri and fetch are stubs.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type Call = { cmd: string; args?: Record<string, unknown> };
const calls: Call[] = [];
let stored = true;
const realFetch = globalThis.fetch;

let GeneralSection: (props: Record<string, unknown>) => React.ReactElement;
let SETTINGS_ROWS: ReadonlyArray<{
  testid: string;
  section: string;
  local?: boolean;
  native?: boolean;
}>;
beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async () =>
    new Response('{}', {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
  GeneralSection = (await import('../client/v2/settings/general-section.jsx'))
    .default as unknown as typeof GeneralSection;
  SETTINGS_ROWS = (await import('../client/v2/settings/settings-model.js')).SETTINGS_ROWS;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

function native(on: boolean) {
  const w = window as unknown as { __TAURI__?: unknown };
  if (!on) {
    w.__TAURI__ = undefined;
    return;
  }
  w.__TAURI__ = {
    core: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        if (cmd === 'prefs_get_terminal_opens') return stored;
        if (cmd === 'prefs_set_terminal_opens') {
          stored = !!args?.enabled;
          return null;
        }
        return null;
      },
    },
  };
}

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  calls.length = 0;
  native(false);
});

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const settle = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));
async function mount(over: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(<GeneralSection cloud={null} theme="dark" panelSide={{}} {...over} />)
  );
  await settle();
}

describe('Settings › General › Terminal', () => {
  test('the desktop app: the switch shows the stored value and writes the pref', async () => {
    stored = false;
    native(true);
    await mount();
    const input = q('settings-terminal-opens')?.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(q('settings-terminal-opens')?.textContent).toContain(
      'Let the terminal open projects in Maude'
    );
    expect(calls.some((c) => c.cmd === 'prefs_get_terminal_opens')).toBe(true);
    expect(input.checked).toBe(false);
    await act(async () => {
      input.click();
    });
    await settle();
    expect(calls).toContainEqual({ cmd: 'prefs_set_terminal_opens', args: { enabled: true } });
    expect(stored).toBe(true);
    expect(input.checked).toBe(true);
  });

  test('absent in a browser tab, a cloud tab and a read-only session', async () => {
    await mount();
    expect(q('settings-terminal')).toBeNull();
    document.body.innerHTML = '';
    native(true);
    await mount({ cloud: { local: {} } });
    expect(q('settings-terminal')).toBeNull();
    document.body.innerHTML = '';
    await mount({ readOnly: true });
    expect(q('settings-terminal')).toBeNull();
    expect(calls.filter((c) => c.cmd.startsWith('prefs_'))).toEqual([]);
  });

  test('the row has its home in the settings model: General, the desktop app only', () => {
    const row = SETTINGS_ROWS.find((r) => r.testid === 'settings-terminal-opens');
    expect(row).toEqual(expect.objectContaining({ section: 'general', native: true }));
  });
});
