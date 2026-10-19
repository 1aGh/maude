// S5.17b — the second half of the S5.V fidelity fixes (03 `ai-choice-fail`, `ai-advanced`, `ai-done`).
//   G7  the failure card says "Couldn't finish — <what>. Nothing changed." + ONE verb; the question card is picks only
//   G6  Advanced › Folders AI may read (the one block 03 draws that an existing capability backs)
//   G8  the settled "Made by AI" tag keeps its place on a narrow artboard
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

const load = async () => {
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  return {
    React,
    createRoot,
    act,
    ChoiceCard: (await import('../client/v2/ai/ChoiceCard.jsx')).default,
    Feed: await import('../client/v2/ai/Feed.jsx'),
    NeedsYouSlot: (await import('../client/v2/ai/NeedsYouSlot.jsx')).default,
    model: await import('../client/v2/ai/needs-you.js'),
  };
};

const mounted: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const un of mounted.splice(0)) await un();
  document.body.innerHTML = '';
});

async function mount(make: (m: Awaited<ReturnType<typeof load>>) => JSX.Element) {
  const m = await load();
  const host = document.createElement('div');
  document.body.append(host);
  const root = m.createRoot(host);
  await m.act(async () => root.render(make(m)));
  mounted.push(() => m.act(async () => root.unmount()));
  return {
    ...m,
    host,
    q: (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null,
  };
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ── G7 · the failure card ────────────────────────────────────────────────────────────────────────────

describe('G7 failure card (03 ai-choice-fail, right)', () => {
  const error = { message: 'ECONNRESET while reading the stream' };

  test('failureModel: one sentence, what is safe, one verb; the raw message is for Advanced', async () => {
    const { model } = await load();
    const clean = model.failureModel(error, { changed: false });
    expect(clean.title).toBe(
      "Couldn't finish — the connection to Claude was interrupted. Nothing changed."
    );
    expect(clean.verb).toBe('Try again');
    expect(clean.raw).toBe('ECONNRESET while reading the stream');
    const touched = model.failureModel(error, { changed: true });
    expect(touched.title).toBe(
      "Couldn't finish — the connection to Claude was interrupted. Undo this chat takes back what it did."
    );
    expect(touched.title).not.toContain('Nothing changed');
  });

  test('"Nothing changed" is said only when the run touched nothing (unknown = not claimed)', async () => {
    const { model } = await load();
    // a run we cannot see (no frame yet) must not promise that nothing changed
    expect(model.failureModel(error, { changed: null }).title).not.toContain('Nothing changed');
    expect(model.failureModel(error, { changed: undefined }).title).not.toContain(
      'Nothing changed'
    );
  });

  test('ErrorCard: the sentence, ONE verb, no "View details"; the raw message sits under Advanced', async () => {
    let retried = 0;
    const v = await mount(({ Feed }) => (
      <Feed.ErrorCard error={error} changed={false} onRetry={() => retried++} />
    ));
    expect(v.q('chat-error-card')).not.toBeNull();
    expect(v.q('chat-error-title')?.textContent).toBe(
      "Couldn't finish — the connection to Claude was interrupted. Nothing changed."
    );
    expect(v.host.textContent).not.toContain('Connection problem');
    expect(v.host.textContent).not.toContain('View details');
    const verbs = [...v.host.querySelectorAll('.btn')] as HTMLElement[];
    expect(verbs.map((b) => b.textContent)).toEqual(['Try again']);
    // the raw message is not in the open
    expect(v.host.textContent).not.toContain('ECONNRESET');
    expect(v.q('chat-error-raw')).toBeNull();
    await v.act(async () => v.q('chat-error-advanced')?.click());
    expect(v.q('chat-error-raw')?.textContent).toBe('ECONNRESET while reading the stream');
    await v.act(async () => v.q('chat-error-retry')?.click());
    expect(retried).toBe(1);
  });

  test('ErrorCard: when the run changed something it says how to take that back', async () => {
    const v = await mount(({ Feed }) => (
      <Feed.ErrorCard error={error} changed onRetry={() => {}} />
    ));
    expect(v.q('chat-error-title')?.textContent).toBe(
      "Couldn't finish — the connection to Claude was interrupted. Undo this chat takes back what it did."
    );
  });

  test('NeedsYouSlot reads the chat run: a failed turn after a change does not say "Nothing changed"', async () => {
    let push: ((run: unknown) => void) | null = null;
    const conn = {
      onQueued: () => () => {},
      syncQueued: () => {},
      onRun: (fn: (run: unknown) => void) => {
        push = fn;
        return () => {};
      },
      askCanvas: null,
    };
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: false, json: async () => ({}) })) as never;
    try {
      const v = await mount(({ NeedsYouSlot }) => (
        <NeedsYouSlot conn={conn} chatId="c1" turnError={{ message: 'socket closed' }} />
      ));
      await v.act(async () => {
        await tick(5);
      });
      // no run seen yet: nothing is promised either way
      expect(v.q('chat-error-title')?.textContent).not.toContain('Nothing changed');
      expect(v.q('chat-error-title')?.textContent).not.toContain('Undo this chat');
      await v.act(async () => {
        push?.({ runId: 'r1', state: 'ended', outcome: 'failed', createdAt: 1, touched: {} });
      });
      expect(v.q('chat-error-title')?.textContent).toContain('Nothing changed');
      await v.act(async () => {
        push?.({
          runId: 'r1',
          state: 'ended',
          outcome: 'failed',
          createdAt: 1,
          scope: { canvas: 'ui/Site.tsx' },
          touched: { 'ui/Site.tsx': ['pricing'] },
        });
      });
      expect(v.q('chat-error-title')?.textContent).toContain('Undo this chat takes back');
      expect(v.q('chat-error-title')?.textContent).not.toContain('Nothing changed');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// ── G7 · the question card ───────────────────────────────────────────────────────────────────────────

describe('G7 question card (03 ai-choice-fail, left): picks only', () => {
  const elicitation = {
    id: 'e1',
    message: 'Which green?',
    requestedSchema: {
      properties: {
        question_0: {
          type: 'string',
          description: 'Which green?',
          oneOf: [
            {
              const: 'club',
              title: 'Club green',
              description: 'from the Alligators design system',
            },
            { const: 'light', title: 'Lighter green', description: 'reads better on print' },
          ],
        },
        question_0_custom: { type: 'string' },
      },
      required: ['question_0'],
    },
  };

  test('each pick carries its hint, and there is no Skip or Send button', async () => {
    const v = await mount(({ ChoiceCard }) => (
      <ChoiceCard request={elicitation} onRespond={() => {}} />
    ));
    expect(v.q('chat-elicit-option-question_0-0')?.textContent).toContain(
      'from the Alligators design system'
    );
    expect(v.q('chat-elicit-option-question_0-1')?.textContent).toContain('reads better on print');
    expect(v.q('chat-elicit-skip')).toBeNull();
    expect(v.q('chat-elicit-submit')).toBeNull();
  });

  test('picking a row answers; Esc is the way to decline', async () => {
    const answers: unknown[] = [];
    const v = await mount(({ ChoiceCard }) => (
      <ChoiceCard request={elicitation} onRespond={(r: unknown) => answers.push(r)} />
    ));
    await v.act(async () => v.q('chat-elicit-option-question_0-1')?.click());
    expect(answers).toEqual([{ action: 'accept', content: { question_0: 'light' } }]);
  });

  test('"Something else…" opens a field; Enter sends what was typed', async () => {
    const answers: unknown[] = [];
    const v = await mount(({ ChoiceCard }) => (
      <ChoiceCard request={elicitation} onRespond={(r: unknown) => answers.push(r)} />
    ));
    await v.act(async () => v.q('chat-elicit-option-question_0-other')?.click());
    expect(answers).toEqual([]); // opening the field is not an answer
    const input = v.q('chat-elicit-custom-question_0') as HTMLInputElement;
    expect(input).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set as (
      v: string
    ) => void;
    await v.act(async () => {
      setter.call(input, 'Forest');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await v.act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(answers).toEqual([{ action: 'accept', content: { question_0_custom: 'Forest' } }]);
  });
});

// ── G6 · Advanced › Folders AI may read ──────────────────────────────────────────────────────────────

describe('G6 Advanced: Folders AI may read (S5.10 grants), the rest stays out', () => {
  async function mountAdvanced(folders: Array<{ root: string; name: string }>) {
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { ChatAdvanced } = await import('../client/v2/ai/Advanced.jsx');
    const { menuCtx } = await import('../client/v2/shell/project-menu-model.js');
    const { foldStore } = await import('../client/v2/fold/use-fold.js');
    foldStore.set('ai.chat', true);
    const calls: Array<{ url: string; body: unknown }> = [];
    let live = folders;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.startsWith('/_api/ai/attach/folders'))
        return { ok: true, json: async () => ({ folders: live }) };
      if (url === '/_api/ai/attach/folder/revoke') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        calls.push({ url, body });
        live = live.filter((f) => f.root !== body.root);
        return { ok: true, json: async () => ({ ok: true, revoked: true }) };
      }
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <ChatAdvanced
          chatId="c1"
          caps={{
            modes: null,
            parsedOptions: { model: null, effort: null, fast: null, others: [] },
          }}
          onSetMode={() => {}}
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
    return { host, act, calls };
  }

  test('the row counts the folders and names them; Reset takes the consent back', async () => {
    const m = await mountAdvanced([
      { root: '/Users/a/Combine 2026 fotky', name: 'Combine 2026 fotky' },
    ]);
    const row = m.host.querySelector('[data-adv-row="folders"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain('Folders AI may read');
    expect(row.textContent).toContain('1 · Combine 2026 fotky');
    expect(m.host.textContent).toContain('AI may');
    await m.act(async () => (row.querySelector('button') as HTMLElement).click());
    await m.act(async () => {
      await tick(10);
    });
    expect(m.calls).toEqual([
      { url: '/_api/ai/attach/folder/revoke', body: { root: '/Users/a/Combine 2026 fotky' } },
    ]);
    expect(m.host.querySelector('[data-adv-row="folders"]')?.textContent).toContain('None');
    expect(m.host.querySelector('[data-adv-row="folders"] button')).toBeNull();
  });

  test('no folder is granted: the row says None and offers no Reset', async () => {
    const m = await mountAdvanced([]);
    const row = m.host.querySelector('[data-adv-row="folders"]') as HTMLElement;
    expect(row.textContent).toContain('None');
    expect(row.querySelector('button')).toBeNull();
  });

  test('rows with no backing capability are not drawn (a row that does nothing is worse than none)', async () => {
    const m = await mountAdvanced([]);
    for (const dead of [
      'Change canvases',
      'Search the web',
      'Always allowed on this canvas',
      'Write outside this project',
    ])
      expect(m.host.textContent).not.toContain(dead);
  });
});

// ── G8 · the settled tag ─────────────────────────────────────────────────────────────────────────────

describe('G8 "Made by AI" tag on a narrow artboard', () => {
  test('the settled tag does not pin both top and bottom (it collapsed to nothing under an artboard < 260 px)', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'artboard-activity-overlay.tsx'), 'utf8');
    const rule = src.match(/\.dc-ai-ring\[data-state="done"\] \.dc-ai-tag \{([^}]*)\}/);
    expect(rule).not.toBeNull();
    // `below` sets `top`; a `bottom` here with it gives the absolute tag a negative height + overflow hidden
    expect(rule?.[1]).not.toContain('bottom');
    // and the above placement still lifts it clear of the dashed ring
    expect(src).toMatch(
      /\.dc-ai-ring\[data-at="above"\] \.dc-ai-tag \{[^}]*bottom: calc\(100% \+ 2px\)/
    );
  });
});
