// S5.8 (03 `ai-open`) — ⌘/ opens the AI chat panel and focuses its field; esc gives focus back.
// Real component (AiChatIsland), real DOM (happy-dom), real React.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

// Imported after the registrator is up (they read `document` at call time, not import time).
const load = async () => {
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { AiChatIsland } = await import('../client/v2/ai/AiChatIsland.jsx');
  const focus = await import('../client/v2/ai/panel-focus.js');
  return { React, createRoot, act, AiChatIsland, focus };
};

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

async function mount(hidden: boolean) {
  const { React, createRoot, act, AiChatIsland, focus } = await load();
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const view = (h: boolean) => (
    <div>
      <button type="button" id="canvas">
        canvas
      </button>
      <AiChatIsland hidden={h}>
        <div className="chat-panel" style={{ display: 'none' }}>
          <textarea className="chat-input" id="other" />
        </div>
        <div className="chat-panel">
          <textarea className="chat-input" id="field" />
        </div>
      </AiChatIsland>
    </div>
  );
  await act(async () => root.render(view(hidden)));
  return {
    act,
    focus,
    show: async () => {
      await act(async () => root.render(view(false)));
      await act(async () => {
        await frame();
      });
    },
    hide: async () => act(async () => root.render(view(true))),
    el: (id: string) => document.getElementById(id) as HTMLElement,
  };
}

const esc = (target: Element, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(e);
  return e;
};

describe('the AI chat panel opens focused (⌘/)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('showing the panel focuses the field of the chat that is showing, never a hidden chat', async () => {
    const t = await mount(true);
    t.el('canvas').focus();
    expect(document.activeElement).toBe(t.el('canvas'));
    await t.show();
    expect(document.activeElement).toBe(t.el('field'));
    expect(document.activeElement).not.toBe(t.el('other'));
  });

  test('mounting an open panel does not steal focus from the page', async () => {
    const t = await mount(false);
    t.el('canvas').focus();
    await t.act(async () => {
      await frame();
    });
    expect(document.activeElement).toBe(t.el('canvas'));
  });

  test('esc in the field gives focus back to what had it', async () => {
    const t = await mount(true);
    t.el('canvas').focus();
    await t.show();
    expect(document.activeElement).toBe(t.el('field'));
    const e = esc(t.el('field'));
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(t.el('canvas'));
  });

  test('esc another part already used (defaultPrevented) leaves focus where it is', async () => {
    const t = await mount(true);
    t.el('canvas').focus();
    await t.show();
    t.el('field').addEventListener('keydown', (ev) => ev.preventDefault());
    esc(t.el('field'));
    expect(document.activeElement).toBe(t.el('field'));
  });

  test('esc from anything but the field is not taken', async () => {
    const t = await mount(true);
    t.el('canvas').focus();
    await t.show();
    const e = esc(t.el('canvas'));
    expect(e.defaultPrevented).toBe(false);
  });

  test('the focus event puts focus in an already-open panel', async () => {
    const t = await mount(false);
    t.el('canvas').focus();
    await t.act(async () => {
      t.focus.requestFocusAI(window);
    });
    expect(document.activeElement).toBe(t.el('field'));
    esc(t.el('field'));
    expect(document.activeElement).toBe(t.el('canvas'));
  });

  test('a folded panel ignores the focus event', async () => {
    const t = await mount(true);
    t.el('canvas').focus();
    await t.act(async () => {
      t.focus.requestFocusAI(window);
    });
    expect(document.activeElement).toBe(t.el('canvas'));
  });

  test('the landmark says "AI chat panel", never "Assistant"', async () => {
    const t = await mount(false);
    const aside = document.querySelector('[data-testid="ai-chat-island"]');
    expect(aside?.getAttribute('aria-label')).toBe('AI chat panel');
    await t.hide();
    expect(aside?.getAttribute('aria-hidden')).toBe('true');
  });
});
