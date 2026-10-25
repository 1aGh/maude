// P8 stage C round 7 (03 AI chat): Advanced › AI may, the chat title from the ask, the "Show" toast.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

const mounted: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const un of mounted.splice(0)) await un();
  document.body.innerHTML = '';
  localStorage.clear();
});
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('the chat is titled by the ask’s first clause (03 ai-working / ai-done: "Make it greener")', () => {
  test('a title that is only the start of what was typed shows its first clause; New chat and slash stay', async () => {
    const { shownChatTitle } = await import('../client/v2/ai/chat-list-model.js');
    expect(shownChatTitle('Make it greener, keep the logo white')).toBe('Make it greener');
    expect(shownChatTitle('Translate the poster to English. Keep the layout')).toBe(
      'Translate the poster to English'
    );
    expect(shownChatTitle('New chat')).toBe('New chat');
    expect(shownChatTitle('')).toBe('New chat');
    expect(shownChatTitle('/design:edit fix open comments')).toBe('/design:edit fix open comments');
  });
});

describe('Advanced › AI may (03 ai-advanced)', () => {
  const modes = {
    currentModeId: 'default',
    availableModes: [
      { id: 'default', name: 'Ask before' },
      { id: 'acceptEdits', name: 'Accept edits' },
      { id: 'plan', name: 'Plan' },
    ],
  };
  async function mountAdvanced(onSetMode: (id: string) => void = () => {}) {
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { ChatAdvanced } = await import('../client/v2/ai/Advanced.jsx');
    const { menuCtx } = await import('../client/v2/shell/project-menu-model.js');
    const { foldStore } = await import('../client/v2/fold/use-fold.js');
    foldStore.set('ai.chat', true);
    const fetchImpl = (async () => ({ ok: true, json: async () => ({ folders: [] }) })) as never;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <ChatAdvanced
          chatId="c1"
          caps={{
            modes,
            parsedOptions: {
              model: null,
              effort: null,
              fast: {
                id: 'fast',
                name: 'Fast mode',
                currentValue: 'off',
                options: [
                  { value: 'off', name: 'Off' },
                  { value: 'on', name: 'On' },
                ],
              },
              others: [],
            },
          }}
          onSetMode={onSetMode}
          onSetConfig={() => {}}
          transcriptView="normal"
          onSetTranscriptView={() => {}}
          suggestOn
          onSetSuggestOn={() => {}}
          usage={{ context: null, rateLimit: null, cost: null, asOf: 0 }}
          ctx={menuCtx({ native: true })}
          fetchImpl={fetchImpl}
          RawLogView={() => null}
        />
      );
      await tick(10);
    });
    mounted.push(() => act(async () => root.unmount()));
    return { host, act };
  }
  const q = (host: HTMLElement, id: string) =>
    host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  test('the group draws Change canvases · Use Assets and footage · Search the web · Write outside', async () => {
    const { host } = await mountAdvanced();
    for (const id of [
      'ai-adv-change-canvases-switch',
      'ai-adv-use-assets-switch',
      'ai-adv-search-web-switch',
      'ai-adv-write-outside',
    ])
      expect(q(host, id)).not.toBeNull();
    expect(q(host, 'ai-adv-write-outside')?.textContent).toBe('Asks every time');
    expect(q(host, 'ai-adv-change-canvases-switch')?.getAttribute('aria-checked')).toBe('true');
  });

  test('Ask before sits after Fast mode (the board’s order), not first', async () => {
    const { host } = await mountAdvanced();
    const rows = [...host.querySelectorAll('[data-adv-row]')].map((r) =>
      r.getAttribute('data-adv-row')
    );
    expect(rows.indexOf('fast')).toBeGreaterThanOrEqual(0);
    expect(rows.indexOf('ask-before')).toBe(rows.indexOf('fast') + 1);
  });

  test('Change canvases off sets the "changes nothing" mode; on takes the asking one back', async () => {
    const set: string[] = [];
    const { host, act } = await mountAdvanced((id) => set.push(id));
    await act(async () => q(host, 'ai-adv-change-canvases-switch')?.click());
    expect(set).toEqual(['plan']);
  });

  test('Use Assets / Search the web are remembered and said to the agent with the next ask', async () => {
    const { mayLine, readMay } = await import('../client/v2/ai/ai-may.js');
    expect(mayLine(readMay())).toBeNull(); // both on: the prompt is what it was
    const { host, act } = await mountAdvanced();
    await act(async () => q(host, 'ai-adv-search-web-switch')?.click());
    expect(q(host, 'ai-adv-search-web-switch')?.getAttribute('aria-checked')).toBe('false');
    expect(readMay()).toEqual({ assets: true, web: false });
    const { buildChatContext } = await import('../client/panels/chat-context.js');
    const ctx = buildChatContext({ canvas: '.design/ui/Combine.tsx', selected: [] });
    expect(ctx?.block).toContain('[maude-may no-web]');
    await act(async () => q(host, 'ai-adv-use-assets-switch')?.click());
    expect(mayLine(readMay())).toBe('[maude-may no-assets no-web]');
  });
});

describe('the panel-closed done toast (03 ai-panel-closed offers Show; 01 cf-ai-done, a whole-canvas draft, Undo)', () => {
  const changed = (artboards: string | string[]) => ({
    scope: { canvas: 'ui/c.tsx', artboards },
    touched: { 'ui/c.tsx': ['post'] },
    objects: [],
  });
  test('a run asked about named artboards says "… The logo stays white." and offers Show', async () => {
    const { doneNotice } = await import('../client/v2/ai/needs-you-toast.js');
    const n = doneNotice({
      id: 'd',
      text: 'Done — Post 1:1 is greener. The logo stays white.',
      run: changed(['post']),
      onShow() {},
      onUndo() {},
    });
    expect(n?.title).toBe('Done — Post 1:1 is greener. The logo stays white.');
    expect(n?.action.label).toBe('Show');
  });
  test('a whole-canvas run that changed things still offers Undo', async () => {
    const { doneNotice } = await import('../client/v2/ai/needs-you-toast.js');
    const n = doneNotice({
      id: 'd',
      text: 'Done — Desktop is on the canvas.',
      run: changed('*'),
      onShow() {},
      onUndo() {},
    });
    expect(n?.action.label).toBe('Undo');
  });
});
