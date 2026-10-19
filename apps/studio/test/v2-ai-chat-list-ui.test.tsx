// S5.12 — the chat list and the Advanced fold as they render and react: Running first, the ⋯ menu, the
// trash dialog that names a queued prompt, search marks; Advanced closed/open, the pickers, the banner's
// "Allow changes", and the ⌘K row taking its control.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const NOW = Date.now();
const GROUPS = {
  groups: [
    {
      canvas: 'ui/Combine-kampan.tsx',
      chats: [
        { id: 'c1', title: 'Make it greener', updated: NOW - 5_000 },
        { id: 'c2', title: 'Translate the poster', updated: NOW - 12 * 60_000 },
        { id: 'c3', title: 'Is the poster readable?', updated: NOW - 26 * 3600_000 },
        { id: 'c4', title: 'Older one', updated: NOW - 9 * 24 * 3600_000 },
      ],
    },
    { canvas: null, chats: [{ id: 'c5', title: 'Just a question', updated: NOW - 3600_000 }] },
  ],
};

type Call = { url: string; method: string; body?: string };
function fakeFetch(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const calls: Call[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
    const key = Object.keys(overrides).find((k) => url.startsWith(k));
    if (key) return overrides[key]();
    if (url.startsWith('/_api/acp/chats/search'))
      return Response.json({
        hits: [
          {
            id: 'c2',
            title: 'Translate the poster',
            updated: NOW,
            canvas: 'ui/Combine-kampan.tsx',
            titleRanges: [[0, 9]],
            snippet: { text: 'translate the poster to Czech', ranges: [[0, 9]] },
            matches: 1,
          },
        ],
      });
    if (url.startsWith('/_api/acp/chats')) return Response.json(GROUPS);
    if (url.startsWith('/_api/outbox'))
      return Response.json({
        intents: [
          { kind: 'ai.prompt', lane: 'ai:c1', state: 'queued', label: 'Make the badge rounder' },
        ],
      });
    if (url.startsWith('/_api/acp/chat/session')) return Response.json({ sessionId: 'sess-9f3a' });
    return new Response('{}', { status: 404 });
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

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

// Text fields call their own React onChange: react-dom decides at import time whether the page can hear
// `input` events, and an earlier file in the same bun process may have loaded it before happy-dom registered
// (then a dispatched `input` never reaches onChange). Call it in its own act() so the state lands before a
// test waits on a debounce. Selects are heard on `change`, set through the native setter.
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  if (el instanceof HTMLSelectElement) {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const propsKey = Object.keys(el).find((k) => k.startsWith('__reactProps$')) as string;
  const props = (el as unknown as Record<string, { onChange: (e: unknown) => void }>)[propsKey];
  el.value = value; // the instance setter keeps React's value tracker in step
  props.onChange({ target: el, currentTarget: el });
}
const key = (el: Element, k: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const text = () => document.body.textContent ?? '';

async function mountList(props: Record<string, unknown> = {}, fetchImpl = fakeFetch()) {
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { ChatList } = await import('../client/v2/ai/ChatList.jsx');
  const { menuCtx } = await import('../client/v2/shell/project-menu-model.js');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const spies = {
    opened: [] as string[],
    trashed: [] as Array<[string, number]>,
    renamed: [] as Array<[string, string]>,
    archived: [] as string[],
    copied: [] as string[],
  };
  await act(async () => {
    root.render(
      <ChatList
        projectName="Alligators brand"
        busy={{ c1: true }}
        ctx={menuCtx({ native: true })}
        fetchImpl={fetchImpl.impl}
        onOpen={(id: string) => spies.opened.push(id)}
        onBack={() => {}}
        onRename={(id: string, t: string) => spies.renamed.push([id, t])}
        onCopyTranscript={(id: string) => spies.copied.push(id)}
        onArchive={(id: string) => spies.archived.push(id)}
        onTrashed={(id: string, n: number) => spies.trashed.push([id, n])}
        {...props}
      />
    );
    await tick(5);
  });
  return { root, spies, fetch: fetchImpl, act };
}

describe('the chat list renders', () => {
  test('Running first, then Earlier by canvas with "N more", and the footer', async () => {
    const m = await mountList();
    const html = q('[data-testid="ai-chat-list"]')?.innerHTML ?? '';
    expect(html.indexOf('Running')).toBeGreaterThan(-1);
    expect(html.indexOf('Running')).toBeLessThan(html.indexOf('Earlier'));
    expect(text()).toContain('Make it greener');
    expect(text()).toContain('1 more'); // 4 chats in Combine-kampan, one is running → 3 earlier, 2 shown
    expect(text()).toContain('5 chats · kept with the project');
    expect(text()).toContain('Alligators brand');
    await m.act(async () => m.root.unmount());
  });

  test('opening a row opens that chat', async () => {
    const m = await mountList();
    await m.act(async () => q('[data-testid="ai-chat-row-c5"]')?.click());
    expect(m.spies.opened).toEqual(['c5']);
    await m.act(async () => m.root.unmount());
  });
});

describe('the row ⋯ menu', () => {
  test('Open · Rename… · Copy transcript · Undo this chat · Archive · Move to trash, and esc returns focus to the dots', async () => {
    const m = await mountList();
    const dots = qa('[aria-label="More options"]')[0];
    await m.act(async () => dots.click());
    const menu = q('[data-testid="chat-overflow-menu"]');
    expect(menu).not.toBeNull();
    expect(qa('[role="menuitem"]').map((b) => b.textContent)).toEqual([
      'Open',
      'Rename…',
      'Copy transcript',
      'Undo this chat', // S5.15 (V2-1.5 §5.3): everything this chat's AI did, as one new version
      'Archive',
      'Move to trash',
    ]);
    await m.act(async () => menu && key(menu, 'Escape'));
    expect(q('[data-testid="chat-overflow-menu"]')).toBeNull();
    await m.act(async () => m.root.unmount());
  });

  test("Copy transcript and Archive call the host with the row's chat", async () => {
    const m = await mountList();
    const dots = qa('[aria-label="More options"]')[0];
    await m.act(async () => dots.click());
    await m.act(async () => q('[data-action="chat.copy-transcript"]')?.click());
    await m.act(async () => qa('[aria-label="More options"]')[0].click());
    await m.act(async () => q('[data-action="chat.archive"]')?.click());
    expect(m.spies.copied.length).toBe(1);
    expect(m.spies.archived).toEqual(m.spies.copied);
    await m.act(async () => m.root.unmount());
  });

  test('Rename… turns the row into a field; Enter hands back the new name', async () => {
    const m = await mountList();
    await m.act(async () => qa('[aria-label="More options"]')[0].click());
    await m.act(async () => q('[data-action="chat.rename"]')?.click());
    const input = q('input[aria-label="Chat name"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    await m.act(async () => setValue(input, 'Greener badge'));
    await m.act(async () => key(input, 'Enter'));
    expect(m.spies.renamed[0][1]).toBe('Greener badge');
    await m.act(async () => m.root.unmount());
  });
});

describe('Move to trash', () => {
  async function openTrash(m: Awaited<ReturnType<typeof mountList>>, rowId: string) {
    const row = q(`[data-testid="ai-chat-row-${rowId}"]`)?.closest('.ai-cl-row') as HTMLElement;
    await m.act(async () =>
      (row.querySelector('[aria-label="More options"]') as HTMLElement).click()
    );
    await m.act(async () => {
      q('[data-action="chat.trash"]')?.click();
      await tick(5);
    });
  }

  test("the dialog asks with the button's verb and names the queued prompt; confirming trashes it", async () => {
    const f = fakeFetch({
      '/_api/acp/chats/trash': () => Response.json({ ok: true, droppedPrompts: 1 }),
    });
    const m = await mountList({ busy: {} }, f);
    await openTrash(m, 'c1');
    const dialog = q('[data-testid="ai-chat-trash-dialog"]');
    expect(dialog?.textContent).toContain('Move "Make it greener" to the trash?');
    expect(dialog?.textContent).toContain("queued prompt won't send");
    expect(dialog?.textContent).toContain('Make the badge rounder');
    const confirm = q('[data-testid="ai-chat-trash-confirm"]');
    expect(confirm?.textContent).toBe('Move to trash');
    await m.act(async () => {
      confirm?.click();
      await tick(5);
    });
    const post = f.calls.find((c) => c.url === '/_api/acp/chats/trash');
    expect(post?.method).toBe('POST');
    expect(JSON.parse(post?.body ?? '{}')).toEqual({ id: 'c1' });
    expect(m.spies.trashed).toEqual([['c1', 1]]);
    expect(q('[data-testid="ai-chat-trash-dialog"]')).toBeNull();
    await m.act(async () => m.root.unmount());
  });

  test('Cancel closes it and sends nothing', async () => {
    const f = fakeFetch();
    const m = await mountList({ busy: {} }, f);
    await openTrash(m, 'c5');
    await m.act(async () => qa('[data-testid="ai-chat-trash-dialog"] button')[0].click());
    expect(q('[data-testid="ai-chat-trash-dialog"]')).toBeNull();
    expect(f.calls.some((c) => c.url.includes('/trash'))).toBe(false);
    expect(m.spies.trashed).toEqual([]);
    await m.act(async () => m.root.unmount());
  });

  test('a chat that is working: the server says 409, the dialog says to stop it first, and offers no verb', async () => {
    const f = fakeFetch({
      '/_api/acp/chats/trash': () => Response.json({ error: 'running' }, { status: 409 }),
    });
    const m = await mountList({ busy: {} }, f);
    await openTrash(m, 'c5');
    await m.act(async () => {
      q('[data-testid="ai-chat-trash-confirm"]')?.click();
      await tick(5);
    });
    expect(q('[data-testid="ai-chat-trash-dialog"]')?.textContent).toContain('Stop it first');
    expect(q('[data-testid="ai-chat-trash-confirm"]')).toBeNull();
    expect(m.spies.trashed).toEqual([]);
    await m.act(async () => m.root.unmount());
  });
});

describe('search', () => {
  test('typing finds words inside chats, marks them, and counts the results', async () => {
    const m = await mountList();
    const input = q('[data-testid="ai-chat-list-search"]') as HTMLInputElement;
    await m.act(async () => setValue(input, 'translate'));
    await m.act(async () => tick(250));
    expect(qa('.ai-cl-mark').length).toBeGreaterThan(0);
    expect(text()).toContain('1 result');
    expect(text()).not.toContain('Running');
    await m.act(async () => m.root.unmount());
  });
});

describe('search with no hits (05 · es-edge-panels, S11.3)', () => {
  test('says what was searched, offers a new chat about it, and the foot still counts the chats', async () => {
    const f = fakeFetch({ '/_api/acp/chats/search': () => Response.json({ hits: [] }) });
    const m = await mountList({}, f);
    const input = q('[data-testid="ai-chat-list-search"]') as HTMLInputElement;
    await m.act(async () => setValue(input, 'tabulka výsledků'));
    await m.act(async () => tick(250));
    const e = q('[data-copy="es-edge-panels.chat-search-none"]');
    expect(e).not.toBeNull();
    expect(e?.querySelector('.es-sit')?.textContent).toBe('No chat mentions “tabulka výsledků”.');
    expect(e?.querySelector('.es-next')?.textContent).toBe(
      'Searched 5 chats in Alligators brand — titles and every message.'
    );
    const btn = e?.querySelector<HTMLElement>('[data-testid="empty-ask"]');
    expect(btn?.textContent).toBe('Start a chat about it');
    expect(e?.querySelectorAll('button')).toHaveLength(1);
    expect(q('.ai-cl-foot')?.textContent).toBe('5 chats · kept with the project');
    await m.act(async () => m.root.unmount());
  });

  test('"Start a chat about it" hands the words to a new chat', async () => {
    const f = fakeFetch({ '/_api/acp/chats/search': () => Response.json({ hits: [] }) });
    const started: string[] = [];
    const m = await mountList({ onStartChat: (t: string) => started.push(t) }, f);
    const input = q('[data-testid="ai-chat-list-search"]') as HTMLInputElement;
    await m.act(async () => setValue(input, 'zzz'));
    await m.act(async () => tick(250));
    await m.act(async () => q('[data-testid="empty-ask"]')?.click());
    expect(started).toEqual(['zzz']);
    await m.act(async () => m.root.unmount());
  });
});

// ── Advanced ────────────────────────────────────────────────────────────────────────────────────────
const MODES = {
  currentModeId: 'default',
  availableModes: [
    { id: 'default', name: 'Default' },
    { id: 'acceptEdits', name: 'Accept Edits' },
    { id: 'plan', name: 'Plan Mode' },
  ],
};
const OPTIONS = {
  model: {
    id: 'model',
    currentValue: 'opus',
    options: [
      { value: 'opus', name: 'Opus' },
      { value: 'sonnet', name: 'Sonnet' },
    ],
  },
  effort: {
    id: 'effort',
    currentValue: 'medium',
    options: [
      { value: 'low', name: 'Low' },
      { value: 'medium', name: 'Medium' },
    ],
  },
  fast: null,
  others: [
    {
      id: 'persona',
      name: 'Agent persona',
      currentValue: 'default',
      options: [{ value: 'default', name: 'Default' }],
    },
  ],
};

async function mountAdvanced(props: Record<string, unknown> = {}) {
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { ChatAdvanced } = await import('../client/v2/ai/Advanced.jsx');
  const { menuCtx } = await import('../client/v2/shell/menu-runner.js').then(
    () => import('../client/v2/shell/project-menu-model.js')
  );
  const { foldStore } = await import('../client/v2/fold/use-fold.js');
  foldStore.set('ai.chat', false);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const log = {
    mode: [] as string[],
    config: [] as string[][],
    view: [] as string[],
    suggest: [] as boolean[],
  };
  const render = (extra: Record<string, unknown> = {}) =>
    root.render(
      <ChatAdvanced
        chatId="c-mg4x1k-7f3a9"
        chatTitle="Make it greener"
        caps={{ modes: MODES, parsedOptions: OPTIONS }}
        onSetMode={(id: string) => log.mode.push(id)}
        onSetConfig={(id: string, v: string) => log.config.push([id, v])}
        transcriptView="normal"
        onSetTranscriptView={(v: string) => log.view.push(v)}
        suggestOn
        onSetSuggestOn={(on: boolean) => log.suggest.push(on)}
        usage={{
          context: { used: 38_000, size: 100_000, pct: 38 },
          rateLimit: null,
          cost: null,
          asOf: 0,
        }}
        ctx={menuCtx({ native: true })}
        fetchImpl={fakeFetch().impl}
        RawLogView={() => <p data-testid="raw-stub">raw log island</p>}
        {...props}
        {...extra}
      />
    );
  await act(async () => {
    render();
    await tick(5);
  });
  return { root, log, act, foldStore, render };
}

describe('Advanced: one quiet row; everything that was visible sits under it', () => {
  test('closed it is the row alone; opening it shows the pickers, in plain words', async () => {
    const m = await mountAdvanced();
    expect(q('[data-testid="ai-advanced"]')?.textContent).toContain('Advanced');
    expect(q('[data-testid="chat-mode-picker"]')).toBeNull(); // nothing hidden costs anything
    await m.act(async () => q('[data-testid="ai-advanced"]')?.click());
    expect(m.foldStore.get('ai.chat')).toBe(true); // remembered per Mac
    const ask = q('[data-testid="chat-mode-picker"]') as HTMLSelectElement;
    expect([...ask.options].map((o) => o.textContent)).toEqual([
      'Replace or move to the trash',
      'Nothing — change freely',
      'Suggest only',
    ]);
    expect(q('[data-testid="chat-caps-bar"]')).not.toBeNull();
    expect(qa('select').some((s) => s.getAttribute('title')?.includes('Transcript view'))).toBe(
      true
    );
    expect(q('[data-testid="chat-transcript-menu"]')).not.toBeNull();
    expect(text()).toContain('Agent persona'); // "From the agent"
    expect(q('[data-testid="ai-adv-context-pct"]')?.textContent).toBe('38%');
    await m.act(async () => m.root.unmount());
  });

  test('a picker change reaches the session: model, mode, view, suggestions', async () => {
    const m = await mountAdvanced();
    await m.act(async () => q('[data-testid="ai-advanced"]')?.click());
    await m.act(async () => setValue(q('#ai-adv-model') as HTMLSelectElement, 'sonnet'));
    await m.act(async () =>
      setValue(q('[data-testid="chat-mode-picker"]') as HTMLSelectElement, 'plan')
    );
    await m.act(async () =>
      setValue(q('[data-testid="chat-transcript-menu"]') as HTMLSelectElement, 'verbose')
    );
    await m.act(async () =>
      setValue(q('[data-testid="ai-adv-suggestions"]') as HTMLSelectElement, 'off')
    );
    expect(m.log.config).toEqual([['model', 'sonnet']]);
    expect(m.log.mode).toEqual(['plan']);
    expect(m.log.view).toEqual(['verbose']);
    expect(m.log.suggest).toEqual([false]);
    await m.act(async () => m.root.unmount());
  });

  test('the session id shows once the fold is open; Raw log opens the island', async () => {
    const m = await mountAdvanced();
    await m.act(async () => {
      q('[data-testid="ai-advanced"]')?.click();
      await tick(10);
    });
    expect(q('[data-testid="ai-adv-session"]')?.textContent).toBe('sess-9f3a');
    expect(q('[data-testid="raw-stub"]')).toBeNull();
    await m.act(async () => q('[data-testid="ai-adv-raw-log"]')?.click());
    expect(q('[data-testid="raw-stub"]')).not.toBeNull();
    await m.act(async () => m.root.unmount());
  });

  test('Open in terminal says why when there is nothing to continue; it is absent outside the desktop app', async () => {
    const m = await mountAdvanced({
      openTerminal: async () => ({ ok: false, reason: 'no-session' }),
    });
    await m.act(async () => q('[data-testid="ai-advanced"]')?.click());
    await m.act(async () => {
      q('[data-testid="ai-adv-open-terminal"]')?.click();
      await tick(5);
    });
    expect(text()).toContain('Nothing to continue yet');
    await m.act(async () => m.root.unmount());

    const { menuCtx } = await import('../client/v2/shell/project-menu-model.js');
    const b = await mountAdvanced({ ctx: menuCtx({ native: false }) });
    await b.act(async () => q('[data-testid="ai-advanced"]')?.click());
    expect(q('[data-testid="ai-adv-open-terminal"]')).toBeNull();
    await b.act(async () => b.root.unmount());
  });

  test('⌘K "Raw log": the row is taken — the fold is open, the island shows, the button has focus', async () => {
    const m = await mountAdvanced();
    const { requestAdvancedRow } = await import('../client/v2/ai/advanced-handlers.js');
    await m.act(async () => {
      m.foldStore.set('ai.chat', true);
      requestAdvancedRow('raw-log');
      await tick(40);
    });
    expect(q('[data-testid="raw-stub"]')).not.toBeNull();
    await m.act(async () => m.root.unmount());
  });

  test('a chat that is not on screen ignores ⌘K (only the visible one answers)', async () => {
    const m = await mountAdvanced({ active: false });
    const { requestAdvancedRow, takeParkedRow } = await import(
      '../client/v2/ai/advanced-handlers.js'
    );
    await m.act(async () => {
      m.foldStore.set('ai.chat', true);
      requestAdvancedRow('raw-log');
      await tick(40);
    });
    expect(q('[data-testid="raw-stub"]')).toBeNull();
    expect(takeParkedRow()).toBe('raw-log'); // still parked for the visible one to claim
    await m.act(async () => m.root.unmount());
  });
});

describe('the suggest-only banner', () => {
  test('said up front, with one verb: "Allow changes"', async () => {
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { SuggestOnlyBanner } = await import('../client/v2/ai/Advanced.jsx');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const picked: string[] = [];
    await act(async () => {
      root.render(
        <SuggestOnlyBanner
          modes={{ ...MODES, currentModeId: 'plan' }}
          onSetMode={(id: string) => picked.push(id)}
        />
      );
    });
    expect(q('[data-testid="chat-mode-banner"]')?.textContent).toContain(
      "AI is set to suggest only. The canvas won't change."
    );
    await act(async () => q('[data-testid="chat-mode-banner-switch"]')?.click());
    expect(picked).toEqual(['acceptEdits']);
    await act(async () => root.render(<SuggestOnlyBanner modes={MODES} onSetMode={() => {}} />));
    expect(q('[data-testid="chat-mode-banner"]')).toBeNull();
    await act(async () => root.unmount());
  });
});
