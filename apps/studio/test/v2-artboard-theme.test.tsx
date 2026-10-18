// S2.8 — Inspector › Advanced › Theme (A-artboard-theme): the shell's run-action reaches the canvas through
// EditingLayer, canvas-shell pins the artboard exactly as the artboard menu's Theme submenu does, and the pin is
// stamped back as `data-dc-theme-pin` so the inspector reads it with the rest of the artboard's read-back.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
// canvas-shell registers its `maude:set-artboard-theme` listener on the window that exists when the module is
// FIRST evaluated. Another test file in the same `bun test` process may already have evaluated it under its own
// (since unregistered) happy-dom window — so this file takes its own instance, bound to this file's window.
type CanvasShellModule = { __resetDsThemeProbeForTests: () => void };
let shellModule: Promise<CanvasShellModule> | null = null;
const canvasShell = (): Promise<CanvasShellModule> => {
  const spec = '../canvas-shell.tsx?v2-artboard-theme';
  shellModule ??= import(spec) as Promise<CanvasShellModule>;
  return shellModule;
};
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

const board = () => {
  const a = document.createElement('article');
  a.setAttribute('data-dc-screen', 'desktop');
  document.body.append(a);
  return a;
};
const ask = (artboard: string, mode: string) =>
  window.dispatchEvent(new CustomEvent('maude:set-artboard-theme', { detail: { artboard, mode } }));
/** a DS that defines both themes (the probe finds them), as detectDsThemeSupport reads it */
const twoThemes = async () => {
  const { __resetDsThemeProbeForTests } = await canvasShell();
  const style = document.createElement('style');
  style.textContent =
    '[data-theme="light"]{--bg-0:#fff;--fg-0:#111}[data-theme="dark"]{--bg-0:#000;--fg-0:#eee}';
  document.head.append(style);
  __resetDsThemeProbeForTests();
};

describe("the canvas pins an artboard's theme when asked", () => {
  test('DS default pins; the pin reads back on the frame; Follow chrome frees it', async () => {
    await canvasShell();
    const a = board();
    ask('desktop', 'ds');
    expect(a.getAttribute('data-dc-theme-pin')).toBe('ds');
    ask('desktop', 'follow');
    expect(a.hasAttribute('data-dc-theme-pin')).toBe(false);
  });

  test('on a one-theme DS Light and Dark are the same no-ops the menu greys out; freeing a pin still works', async () => {
    const { __resetDsThemeProbeForTests } = await canvasShell();
    __resetDsThemeProbeForTests();
    const a = board();
    ask('desktop', 'dark');
    ask('desktop', 'light');
    expect(a.hasAttribute('data-dc-theme-pin')).toBe(false);
    ask('desktop', 'ds'); // DS default is always meaningful
    expect(a.getAttribute('data-dc-theme-pin')).toBe('ds');
    ask('desktop', 'follow'); // and so is letting it go
    expect(a.hasAttribute('data-dc-theme-pin')).toBe(false);
  });

  test('on a two-theme DS Dark pins this artboard only, with its own rule', async () => {
    await twoThemes();
    const a = board();
    const other = board();
    other.setAttribute('data-dc-screen', 'mobile');
    ask('desktop', 'dark');
    expect(a.getAttribute('data-dc-theme-pin')).toBe('dark');
    expect(other.hasAttribute('data-dc-theme-pin')).toBe(false);
    ask('desktop', 'follow');
    expect(a.hasAttribute('data-dc-theme-pin')).toBe(false);
  });

  test('junk is refused: an unknown mode and a non-string artboard change nothing', async () => {
    await canvasShell();
    const a = board();
    ask('desktop', 'sepia');
    window.dispatchEvent(
      new CustomEvent('maude:set-artboard-theme', { detail: { artboard: 7, mode: 'ds' } })
    );
    window.dispatchEvent(new CustomEvent('maude:set-artboard-theme'));
    expect(a.hasAttribute('data-dc-theme-pin')).toBe(false);
  });
});

describe("the shell's run-action reaches it", () => {
  test('artboard.set-theme from the shell turns into the pin; from anyone else it does nothing', async () => {
    await canvasShell();
    const { EditingLayer } = await import('../editing/index.tsx');
    const { ToolProvider } = await import('../use-tool-mode.tsx');
    const { SelectionSetProvider } = await import('../use-selection-set.tsx');
    const a = board();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(
        <ToolProvider>
          <SelectionSetProvider postTarget={{ postMessage: () => {} }}>
            <EditingLayer />
          </SelectionSetProvider>
        </ToolProvider>
      )
    );
    const run = (source: unknown) =>
      act(async () => {
        window.dispatchEvent(
          new window.MessageEvent('message', {
            source: source as never,
            data: {
              dgn: 'run-action',
              v: 1,
              id: 'artboard.set-theme',
              params: { artboard: 'desktop', mode: 'ds' },
            },
          })
        );
      });
    await run(null); // not the shell
    expect(a.hasAttribute('data-dc-theme-pin')).toBe(false);
    await run(window.parent); // the shell
    expect(a.getAttribute('data-dc-theme-pin')).toBe('ds');
  });
});
