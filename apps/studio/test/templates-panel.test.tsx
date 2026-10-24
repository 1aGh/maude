// S4.4 — the Templates panel rendered: eight tiles in canvas-15 order, a pick emits {id} and closes,
// arrows move the highlight, "describe it" FILLS the composer text (never sends) and an empty
// description does nothing; the ⌘K Ask-AI path delivers the text to the chat composer.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

// Registered here unless another file already left a full DOM up: a bare `window` stub some suites
// set is not a DOM (`document` is what the panel needs), so test for that, and only tear down our own.
let registeredHere = false;
beforeAll(async () => {
  if (typeof document === 'undefined') {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    GlobalRegistrator.register();
    registeredHere = true;
  }
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (registeredHere && GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TEMPLATES } from '../annotations/templates.ts';
import TemplatesPanel, {
  DESCRIBE_PREFIX,
  describeText,
  moveTile,
  NO_CHAT,
} from '../client/v2/annotations/templates-panel.jsx';
import { sendToAskAI, subscribeAskAI } from '../client/v2/search/search-env.js';
import { PANEL_HOSTS, PANEL_SIZE } from '../client/v2/shell/tool-panels.js';

async function mount(props: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const calls = { picked: [] as unknown[], described: [] as string[], closed: 0 };
  await act(async () => {
    root.render(
      <TemplatesPanel
        onPick={(t: unknown) => calls.picked.push(t)}
        onDescribe={(t: string) => calls.described.push(t)}
        onClose={() => {
          calls.closed++;
        }}
        {...props}
      />
    );
  });
  return {
    host,
    calls,
    done: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

async function type(host: HTMLElement, value: string) {
  const input = host.querySelector('[data-testid="templates-ask-input"]') as HTMLInputElement;
  // a dispatched `input` event does not reach React's onChange under happy-dom: call the handler React attached
  const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps$')) as string;
  const p = (input as unknown as Record<string, { onChange: (e: unknown) => void }>)[propsKey];
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    set?.call(input, value);
    p.onChange({ target: input, currentTarget: input });
  });
}

/** Enter in the field — the handler React attached (a dispatched key event does not reach it under happy-dom). */
async function submit(host: HTMLElement) {
  const input = host.querySelector('[data-testid="templates-ask-input"]') as HTMLInputElement;
  const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps$')) as string;
  const p = (input as unknown as Record<string, { onKeyDown: (e: unknown) => void }>)[propsKey];
  await act(async () => {
    p.onKeyDown({ key: 'Enter', preventDefault() {}, nativeEvent: {} });
  });
}

describe('tiles', () => {
  test('eight tiles in the canvas-15 order, each with its title and one-line description', async () => {
    const { host, done } = await mount();
    const tiles = [...host.querySelectorAll('[data-testid^="templates-tile-"]')];
    expect(tiles.map((t) => t.querySelector('strong')?.textContent)).toEqual([
      'Kanban',
      'Retro',
      'Flowchart',
      'Content calendar',
      'Roadmap',
      'Brainstorm',
      'Checklist',
      'Blank section',
    ]);
    expect(tiles[0].querySelector('em')?.textContent).toBe('To do · Doing · Done');
    expect(tiles.map((t) => t.getAttribute('data-testid'))).toEqual(
      TEMPLATES.map((t) => `templates-tile-${t.id}`)
    );
    expect(host.textContent).toContain('or drag on the canvas for a blank one');
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Templates');
    await done();
  });

  test('a tile pick emits {id} and closes', async () => {
    const { host, calls, done } = await mount();
    await act(async () => {
      (host.querySelector('[data-testid="templates-tile-retro"]') as HTMLElement).click();
    });
    expect(calls.picked).toEqual([{ id: 'retro' }]);
    expect(calls.closed).toBe(1);
    await done();
  });

  test('arrows move the highlight and never leave the grid', () => {
    expect(moveTile(0, 'ArrowRight')).toBe(1);
    expect(moveTile(0, 'ArrowLeft')).toBe(0);
    expect(moveTile(1, 'ArrowDown')).toBe(5);
    expect(moveTile(5, 'ArrowUp')).toBe(1);
    expect(moveTile(5, 'ArrowDown')).toBe(5);
    expect(moveTile(7, 'ArrowRight')).toBe(7);
  });

  test('the first tile starts highlighted', async () => {
    const { host, done } = await mount();
    const on = [...host.querySelectorAll('[data-on="true"]')];
    expect(on.map((t) => t.getAttribute('data-testid'))).toEqual(['templates-tile-kanban']);
    await done();
  });

  test('no × (15 an-templates): Esc and a press outside close it', async () => {
    const { done } = await mount();
    expect(document.querySelector('button[aria-label="Close"]')).toBeNull();
    await done();
  });

  test('Escape closes', async () => {
    const { calls, done } = await mount();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(calls.closed).toBe(1);
    await done();
  });
});

describe('describe it', () => {
  test('the send button is off until there are words', async () => {
    const { host, done } = await mount();
    const send = host.querySelector('[data-testid="templates-ask-send"]') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await type(host, '  ');
    expect(send.disabled).toBe(true);
    await type(host, 'Kanban pro Combine 2026');
    expect(send.disabled).toBe(false);
    await done();
  });

  test('submitting FILLS the composer text with the description and closes; it picks no tile', async () => {
    const { host, calls, done } = await mount();
    await type(host, 'Kanban pro Combine 2026');
    await submit(host);
    expect(calls.described).toEqual([`${DESCRIBE_PREFIX}Kanban pro Combine 2026`]);
    expect(calls.picked).toEqual([]);
    expect(calls.closed).toBe(1);
    await done();
  });

  test('the send button does the same as Enter', async () => {
    const { host, calls, done } = await mount();
    await type(host, 'a retro');
    await act(async () => {
      (host.querySelector('[data-testid="templates-ask-send"]') as HTMLElement).click();
    });
    expect(calls.described).toEqual([`${DESCRIBE_PREFIX}a retro`]);
    await done();
  });

  test('an empty description does nothing', async () => {
    const { host, calls, done } = await mount();
    await submit(host);
    expect(calls.described).toEqual([]);
    expect(calls.closed).toBe(0);
    await done();
  });

  test('where AI chat does not exist the field is off and says so; tiles still work', async () => {
    const { host, calls, done } = await mount({ canAsk: false });
    const input = host.querySelector('[data-testid="templates-ask-input"]') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe(NO_CHAT);
    await submit(host);
    expect(calls.described).toEqual([]);
    await act(async () => {
      (host.querySelector('[data-testid="templates-tile-kanban"]') as HTMLElement).click();
    });
    expect(calls.picked).toEqual([{ id: 'kanban' }]);
    await done();
  });

  test('describeText trims and refuses nothing-but-spaces', () => {
    expect(describeText('  a retro  ')).toBe(`${DESCRIBE_PREFIX}a retro`);
    expect(describeText('   ')).toBeNull();
    expect(describeText(undefined)).toBeNull();
  });

  test('the text reaches the chat composer through the Ask-AI path (fills; the person sends)', () => {
    const target = new EventTarget() as unknown as typeof globalThis;
    const got: string[] = [];
    const off = subscribeAskAI((t: string) => got.push(t), target);
    sendToAskAI(describeText('a retro') as string, target);
    expect(got).toEqual([`${DESCRIBE_PREFIX}a retro`]);
    off();
  });
});

describe('placement', () => {
  test('Templates is a popover host as wide as the canvas-15 panel', () => {
    expect(PANEL_HOSTS.templates).toBe('popover');
    expect(PANEL_SIZE.templates).toEqual({ w: 640 });
  });
});

// S4.V4 G2 - the panel is shell-side, outside `.maude-v2`, so the `--object-*` thumbnail colours, the
// v2 body face and `--w-semibold` resolved to nothing (blank Kanban/Retro/Calendar/Roadmap tiles, mono
// type). The dialog carries its own v2 token scope; nothing wider is wrapped.
describe('v2 token scope', () => {
  test('the dialog carries .maude-v2 with the shell theme; the scrim and the shell do not', async () => {
    const shell = document.createElement('div');
    shell.className = 'maude';
    shell.setAttribute('data-theme', 'dark');
    document.body.appendChild(shell);
    const { host, done } = await mount();
    shell.appendChild(host);
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.classList.contains('maude-v2')).toBe(true);
    expect(dialog.getAttribute('data-theme')).toBe('dark');
    expect((host.querySelector('.st-scrim') as HTMLElement).classList.contains('maude-v2')).toBe(
      false
    );
    await done();
    shell.remove();
  });

  test('templates-panel.css sets the v2 body face on the panel', async () => {
    const css = await Bun.file(
      new URL('../client/v2/annotations/templates-panel.css', import.meta.url)
    ).text();
    expect(css).toMatch(/\.st-sticker-picker\.tp\s*\{[^}]*font-family:\s*var\(--font-body/);
  });
});
