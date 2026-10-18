// S5.9 (03 `ai-long`, `ai-long-pinned`) — the island's height and pin, mounted for real (AiChatIsland +
// the shell's panel-layout store + happy-dom), and the host wiring (source) that keeps every v1 control.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');

describe('the island’s height and pin', () => {
  let realFetch: typeof fetch;
  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    realFetch = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({})) as unknown as typeof fetch;
  });
  afterAll(async () => {
    // The layout store is a singleton shared with the other suites: leave it as it was found, with no
    // root still subscribed to it.
    const { act } = await import('react');
    const { panelLayout } = await import('../client/v2/shell/use-panel-layout.js');
    await act(async () => {
      for (const r of mounted.splice(0)) r.unmount();
    });
    panelLayout.setPinned(false);
    globalThis.fetch = realFetch;
    GlobalRegistrator.unregister();
  });
  // Roots of earlier tests stay subscribed to the shell's layout store: unmount them before it moves.
  const mounted: Array<{ unmount(): void }> = [];
  beforeEach(async () => {
    const { act } = await import('react');
    const { panelLayout } = await import('../client/v2/shell/use-panel-layout.js');
    await act(async () => {
      for (const r of mounted.splice(0)) r.unmount();
    });
    panelLayout.setPinned(false);
  });

  async function mount(length = 0) {
    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { AiChatIsland } = await import('../client/v2/ai/AiChatIsland.jsx');
    const { useReportLength } = await import('../client/v2/ai/BigChat.jsx');
    const { panelLayout } = await import('../client/v2/shell/use-panel-layout.js');
    function Chat({ n, hidden }: { n: number; hidden?: boolean }) {
      useReportLength(n, !!hidden);
      return <div className="chat-panel" />;
    }
    document.body.innerHTML = '';
    const grip = document.createElement('div');
    grip.className = 'st-grip st-grip--r';
    const slot = document.createElement('div');
    slot.className = 'st-dockslot st-dockslot--right';
    const host = document.createElement('div');
    slot.append(host);
    document.body.append(grip, slot);
    const root = createRoot(host);
    mounted.push(root);
    const render = async (n: number, hidden = false) => {
      await act(async () => {
        root.render(
          <AiChatIsland hidden={hidden}>
            <Chat n={n} />
          </AiChatIsland>
        );
      });
    };
    await render(length);
    const island = () => document.querySelector('[data-testid="ai-chat-island"]') as HTMLElement;
    const dbl = async () => {
      await act(async () => {
        grip.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      });
    };
    return { render, island, dbl, grip, act, panelLayout };
  }

  test('a short chat is not full height; a long one takes the whole height on its own', async () => {
    const { render, island } = await mount(3);
    expect(island().getAttribute('data-full')).toBeNull();
    await render(9);
    expect(island().getAttribute('data-full')).toBe('true');
  });

  test('double-clicking the edge flips it, and the choice holds as the chat grows', async () => {
    const { render, island, dbl } = await mount(3);
    await dbl();
    expect(island().getAttribute('data-full')).toBe('true');
    await dbl();
    expect(island().getAttribute('data-full')).toBeNull();
    await render(20);
    expect(island().getAttribute('data-full')).toBeNull();
  });

  test('the edge says what a drag and a double-click do, and gives the tip back on unmount', async () => {
    const { grip, render } = await mount(0);
    expect(grip.getAttribute('title')).toBe('Drag to resize · double-click for full height');
    await render(0, true); // hidden: the island is not on screen, the edge is not its to describe
    expect(grip.getAttribute('title')).toBeNull();
  });

  test('pinned is the shell’s docked column: no full-height state, the class says so', async () => {
    const { island, act, panelLayout, render } = await mount(12);
    expect(island().getAttribute('data-full')).toBe('true');
    expect(island().className).not.toContain('ai-island--pinned');
    await act(async () => {
      panelLayout.setPinned(true);
    });
    await render(12);
    expect(island().getAttribute('data-full')).toBeNull();
    expect(island().className).toContain('ai-island--pinned');
  });

  test('a hidden chat does not decide the panel’s height', async () => {
    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { AiChatIsland } = await import('../client/v2/ai/AiChatIsland.jsx');
    const { useReportLength } = await import('../client/v2/ai/BigChat.jsx');
    function Chat({ n, hidden }: { n: number; hidden: boolean }) {
      useReportLength(n, hidden);
      return null;
    }
    document.body.innerHTML = '';
    const slot = document.createElement('div');
    slot.className = 'st-dockslot st-dockslot--right';
    const host = document.createElement('div');
    slot.append(host);
    document.body.append(slot);
    const root = createRoot(host);
    mounted.push(root);
    await act(async () => {
      root.render(
        <AiChatIsland>
          <Chat n={2} hidden={false} />
          <Chat n={40} hidden />
        </AiChatIsland>
      );
    });
    expect(
      (document.querySelector('[data-testid="ai-chat-island"]') as HTMLElement).getAttribute(
        'data-full'
      )
    ).toBeNull();
  });
});

describe('host wiring: nothing deleted, everything mounted', () => {
  test('ChatPanel mounts the run surface, Jump to latest and the pin; the v1 ActivityBar export survives', () => {
    const src = read('client/panels/ChatPanel.jsx');
    expect(src).toContain('<RunSurface');
    expect(src).toContain('<JumpToLatest');
    expect(src).toContain('pin={<PinButtonHost />}');
    expect(read('client/v2/ai/Feed.jsx')).toContain('export function ActivityBar');
  });
  test('the header keeps its testids and gains the pin in front of Hide', () => {
    const src = read('client/panels/chat-header.jsx');
    for (const id of ['ai-chat-header', 'ai-chat-new', 'ai-chat-hide', 'ai-chat-count'])
      expect(src).toContain(`data-testid="${id}"`);
    expect(src.indexOf('{pin}')).toBeGreaterThan(-1);
    expect(src.indexOf('{pin}')).toBeLessThan(src.indexOf('data-testid="ai-chat-hide"'));
  });
  test('the composer’s Stop stays in the DOM for the e2e helpers, even though the line carries Stop now', () => {
    expect(read('client/v2/ai/Composer.jsx')).toContain('aria-label="Stop"');
    expect(read('client/v2/ai/ai-run.css')).toContain('.ai-island .chat-stopbar');
  });
  test('every new testid is an API: in testids.json and TESTIDS.md, and on an element', () => {
    const json: Array<{ hook: string }> = JSON.parse(read('client/testids.json'));
    const md = read('client/TESTIDS.md');
    const sources = [
      'client/v2/ai/Working.jsx',
      'client/v2/ai/Result.jsx',
      'client/v2/ai/BigChat.jsx',
    ]
      .map(read)
      .join('\n');
    for (const hook of [
      'ai-working',
      'ai-working-text',
      'ai-stop',
      'ai-live',
      'ai-result',
      'ai-result-undo',
      'ai-result-redo',
      'ai-result-keep-going',
      'ai-result-keep-copy',
      'ai-result-compare',
      'ai-result-state',
      'ai-result-note',
      'ai-steps',
      'ai-followups',
      'ai-followup-chip',
      'ai-jump',
      'ai-jump-count',
      'ai-chat-pin',
    ]) {
      expect(json.map((e) => e.hook)).toContain(hook);
      expect(md).toContain(`\`${hook}\``);
      expect(sources).toContain(hook);
    }
  });
  test('the stylesheet is imported', () => {
    expect(read('client/styles/_index.css')).toContain('../v2/ai/ai-run.css');
  });
});
