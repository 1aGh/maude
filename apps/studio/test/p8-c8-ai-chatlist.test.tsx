// P8 stage C round 8 (p8-c8-ai) — 03 ai-chat-list: the header carries a "+" that starts a new chat
// (board: back · Chats · project chip · +).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.innerHTML = '';
});

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function mount(props: Record<string, unknown> = {}) {
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { ChatList } = await import('../client/v2/ai/ChatList.jsx');
  const { menuCtx } = await import('../client/v2/shell/project-menu-model.js');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const fetchImpl = (async () => Response.json({ groups: [] })) as unknown as typeof fetch;
  await act(async () => {
    root.render(
      <ChatList
        projectName="Alligators brand"
        ctx={menuCtx({ native: true })}
        fetchImpl={fetchImpl}
        onOpen={() => {}}
        onBack={() => {}}
        {...props}
      />
    );
    await tick(5);
  });
  return { act };
}

describe('03 ai-chat-list header "+"', () => {
  test('a New chat button sits after the project chip and calls onNewChat', async () => {
    let n = 0;
    const { act } = await mount({ onNewChat: () => n++ });
    const btn = q('[data-testid="ai-chat-list-new"]') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('aria-label')).toBe('New chat');
    const hd = q('.ai-cl-hd') as HTMLElement;
    expect(hd.lastElementChild).toBe(btn);
    await act(async () => {
      btn?.click();
    });
    expect(n).toBe(1);
  });
  test('no host handler, no button (nothing to start)', async () => {
    await mount();
    expect(q('[data-testid="ai-chat-list-new"]')).toBeNull();
  });
});
