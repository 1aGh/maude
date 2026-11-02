// S5.9 (03 `ai-working`, `ai-done`, `ai-long`, `ai-long-pinned`) — the working line, the result card, the
// pill and the pin as markup; then RunSurface mounted for real (assistant-ui runtime + happy-dom) to
// prove the live region reads each state once, Stop goes through the registry, and Undo is the run's.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { renderToStaticMarkup } from 'react-dom/server';
import { JumpPill, PinButton } from '../client/v2/ai/BigChat.jsx';
import { ResultCard } from '../client/v2/ai/Result.jsx';
import { RunLiveRegion, WorkingLine } from '../client/v2/ai/Working.jsx';

const noop = () => {};

describe('the working line (ai-working)', () => {
  const html = renderToStaticMarkup(
    <WorkingLine
      text="AI is making it greener"
      step="Background done · badge next"
      elapsed="0:42"
      onStop={noop}
    />
  );
  test('the same words as the artboard’s tag, the step under them, and Stop', () => {
    expect(html).toContain('data-testid="ai-working"');
    expect(html).toContain('>AI is making it greener<');
    expect(html).toContain('Background done · badge next');
    expect(html).toContain('0:42');
    expect(html).toContain('data-testid="ai-stop"');
    expect(html).toContain('aria-label="Stop"');
  });
  test('the line is not itself a live region (a ticking clock would be read every second)', () => {
    expect(html).not.toContain('aria-live');
    expect(html).not.toContain('role="status"');
  });
  test('without a step or a clock there is just the words and Stop', () => {
    const bare = renderToStaticMarkup(<WorkingLine text="AI is working" onStop={noop} />);
    expect(bare).not.toContain('ai-step');
  });
});

describe('the result card’s verbs (ai-done)', () => {
  const card = (props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(<ResultCard verbs={['Undo', 'Keep going']} onVerb={noop} {...props} />);

  test('Undo first, then the way on', () => {
    const h = card();
    expect(h.indexOf('data-verb="Undo"')).toBeGreaterThan(-1);
    expect(h.indexOf('data-verb="Undo"')).toBeLessThan(h.indexOf('data-verb="Keep going"'));
    expect(h).toContain('data-testid="ai-result-undo"');
    expect(h).toContain('data-testid="ai-result-keep-going"');
  });
  test('the verbs follow the variant', () => {
    expect(card({ verbs: ['Undo', 'Keep the copy'] })).toContain(
      'data-testid="ai-result-keep-copy"'
    );
    expect(card({ verbs: ['Undo', 'Compare'] })).toContain('data-testid="ai-result-compare"');
    expect(card({ verbs: ['Keep going'] })).not.toContain('data-verb="Undo"');
  });
  test('"What AI did · N steps · T" is folded, with the steps behind it', () => {
    const h = card({
      steps: ['Edit Post.tsx', 'Rebuild the preview'],
      stepsLabel: 'What AI did · 2 steps · 41 s',
    });
    expect(h).toContain('<details');
    expect(h).not.toContain('<details open');
    expect(h).toContain('What AI did · 2 steps · 41 s');
    expect(h).toContain('<li>Edit Post.tsx</li>');
  });
  test('no steps, no fold', () => {
    expect(card()).not.toContain('<details');
  });
  test('follow-up chips only while the card is idle', () => {
    const chips = ['Same on Story 9:16'];
    expect(card({ followUps: chips })).toContain('data-testid="ai-followup-chip"');
    expect(card({ followUps: chips, status: 'undone' })).not.toContain('ai-followup-chip');
  });
  test('after Undo the card says Undone and offers Redo; after Keep the copy it says so', () => {
    const undone = card({ status: 'undone' });
    expect(undone).toContain('Undone.');
    expect(undone).toContain('data-testid="ai-result-redo"');
    expect(undone).not.toContain('data-verb="Undo"');
    expect(card({ status: 'kept', verbs: ['Undo', 'Keep the copy'] })).toContain('Kept the copy.');
  });
  test('while Undo runs the chip is busy and cannot be pressed twice', () => {
    const h = card({ status: 'busy' });
    expect(h).toMatch(/data-verb="Undo"[^>]*disabled/);
    expect(h).toContain('aria-busy="true"');
  });
  test('the headline is drawn only when the reply has none; a failed verb leaves one line', () => {
    expect(card()).not.toContain('ai-result-line');
    expect(card({ headline: 'Done — Post 1:1 is updated.' })).toContain(
      'Done — Post 1:1 is updated.'
    );
    expect(card({ note: 'Someone changed this since, so nothing was undone.' })).toContain(
      'data-testid="ai-result-note"'
    );
  });
});

describe('Jump to latest · N new (ai-long)', () => {
  test('the pill says how many arrived', () => {
    const h = renderToStaticMarkup(<JumpPill newCount={2} onJump={noop} />);
    expect(h).toContain('Jump to latest');
    expect(h).toContain('>2 new<');
    expect(h).toContain('data-testid="ai-jump-count"');
  });
  test('with nothing new it is just "Jump to latest"', () => {
    const h = renderToStaticMarkup(<JumpPill newCount={0} onJump={noop} />);
    expect(h).toContain('Jump to latest');
    expect(h).not.toContain('ai-jump-count');
  });
});

describe('Pin to the side (ai-long-pinned)', () => {
  test('unpinned: "Pin to the side"', () => {
    const h = renderToStaticMarkup(<PinButton pinned={false} onToggle={noop} />);
    expect(h).toContain('aria-label="Pin to the side"');
    expect(h).toContain('aria-pressed="false"');
    expect(h).toContain('data-testid="ai-chat-pin"');
  });
  test('pinned: "Unpin", and the tip says what it does', () => {
    const h = renderToStaticMarkup(<PinButton pinned onToggle={noop} />);
    expect(h).toContain('aria-label="Unpin"');
    expect(h).toContain('title="Unpin — float over the canvas"');
    expect(h).toContain('aria-pressed="true"');
  });
});

describe('the live region', () => {
  test('is polite, and empty until something is said', () => {
    expect(renderToStaticMarkup(<RunLiveRegion message={null} />)).toContain('aria-live="polite"');
    expect(renderToStaticMarkup(<RunLiveRegion message={{ id: 1, text: 'Stopped' }} />)).toContain(
      '>Stopped<'
    );
  });
});

// ── RunSurface, for real ──────────────────────────────────────────────────────────────────────────────
describe('RunSurface mounted', () => {
  type Frame = Record<string, unknown>;
  const calls: Array<{ url: string; body: unknown }> = [];
  let realFetch: typeof fetch;
  let stack: Record<string, unknown>;

  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    realFetch = globalThis.fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    GlobalRegistrator.unregister();
  });
  beforeEach(() => {
    calls.length = 0;
    stack = {
      ok: true,
      entries: [{ actionId: 'a_run', runId: 'r_aaaaaaaaaaaa', state: 'done' }],
      redo: [],
    };
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.startsWith('/_api/ai/runs?') || url === '/_api/ai/runs')
        return Response.json({ mine: [] });
      if (url.startsWith('/_api/project/undo-stack')) return Response.json(stack);
      return Response.json({ ok: true, actionId: 'a_undo' });
    }) as unknown as typeof fetch;
  });

  const run = (over: Frame = {}) => ({
    runId: 'r_aaaaaaaaaaaa',
    chatId: 'c1',
    origin: 'maude-chat',
    state: 'running',
    createdAt: 1000,
    startedAt: 1000,
    doing: 'making it greener',
    scope: { canvas: 'Combine.tsx', artboards: ['post'] },
    touched: { 'Combine.tsx': ['post'] },
    objects: [],
    ...over,
  });

  async function mount() {
    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { AssistantRuntimeProvider, useLocalRuntime } = await import('@assistant-ui/react');
    const { RunSurface } = await import('../client/v2/ai/RunSurface.jsx');
    const listeners = new Set<(r: unknown) => void>();
    const conn = {
      onRun(fn: (r: unknown) => void) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
    const adapter = {
      // never settles: a turn the test does not drive
      async *run() {
        await new Promise(() => {});
      },
    };
    function Host() {
      const runtime = useLocalRuntime(adapter as never, { initialMessages: [] });
      return (
        <AssistantRuntimeProvider runtime={runtime}>
          <RunSurface
            conn={conn}
            chatId="c1"
            tools={[]}
            artboards={[
              { id: 'post', label: 'Post 1:1 · Combine 2026' },
              { id: 'story', label: 'Story 9:16' },
            ]}
            designRel=".design"
          />
        </AssistantRuntimeProvider>
      );
    }
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<Host />);
    });
    const emit = async (r: unknown) => {
      await act(async () => {
        for (const fn of listeners) fn(r);
      });
    };
    const q = (sel: string) => document.querySelector(sel);
    const live = () => q('[data-testid="ai-live"]')?.textContent ?? '';
    return { emit, q, live, act, root };
  }

  test('a running run shows the line with its words; the live region reads it once', async () => {
    const { emit, q, live } = await mount();
    expect(q('[data-testid="ai-working"]')).toBeNull();
    await emit(run());
    expect(q('[data-testid="ai-working-text"]')?.textContent).toBe('AI is making it greener');
    expect(live()).toBe('AI is making it greener');
    const before = q('[data-testid="ai-live"] span');
    // the same state again (a steps update, a repeat frame): the region node is untouched
    await emit(run({ touched: { 'Combine.tsx': ['post'] }, objects: [{ id: 'x' }] }));
    expect(q('[data-testid="ai-live"] span')).toBe(before);
    expect(live()).toBe('AI is making it greener');
  });

  test('Stop is the registry’s stop for that run', async () => {
    const { emit, q, act } = await mount();
    await emit(run());
    const stop = q('[data-testid="ai-stop"]') as HTMLButtonElement;
    await act(async () => {
      stop.click();
    });
    expect(calls.some((c) => c.url === '/_api/ai/runs/r_aaaaaaaaaaaa/stop')).toBe(true);
  });

  test('done: the line gives way to the card, announced once, with Undo then Keep going', async () => {
    const { emit, q, live } = await mount();
    await emit(run());
    await emit(run({ state: 'ended', outcome: 'done', endedAt: 42_000 }));
    expect(q('[data-testid="ai-working"]')).toBeNull();
    expect(q('[data-testid="ai-result"]')).not.toBeNull();
    const verbs = [...document.querySelectorAll('[data-verb]')].map((e) =>
      e.getAttribute('data-verb')
    );
    expect(verbs).toEqual(['Undo', 'Keep going']);
    // the thread has no reply of its own here, so the contract's sentence is read
    expect(live()).toBe('Done — Post 1:1 is updated.');
    // and the card draws the same sentence as its headline
    expect(q('.ai-result-line')?.textContent).toBe('Done — Post 1:1 is updated.');
    // a follow-up for the artboard it did not touch
    expect(q('[data-testid="ai-followup-chip"]')?.textContent).toContain('Same on Story 9:16');
  });

  test('Undo reads the stack for this run’s canvas and posts that run’s action; the card says Undone', async () => {
    const { emit, q, act } = await mount();
    await emit(run({ state: 'ended', outcome: 'done', endedAt: 42_000 }));
    await act(async () => {
      (q('[data-testid="ai-result-undo"]') as HTMLButtonElement).click();
    });
    const post = calls.find((c) => c.url === '/_api/project/undo');
    expect(post?.body).toEqual({ actionId: 'a_run', via: 'panel' });
    expect(
      calls.some((c) => c.url.startsWith('/_api/project/undo-stack?canvas=.design%2FCombine.tsx'))
    ).toBe(true);
    expect(q('[data-testid="ai-result-state"]')?.textContent).toBe('Undone.');
    expect(q('[data-testid="ai-result-redo"]')).not.toBeNull();
  });

  test('a stopped run is read as stopped, with Keep going carrying the registry on', async () => {
    const { emit, q, live, act } = await mount();
    await emit(run({ state: 'ended', outcome: 'stopped', endedAt: 9000 }));
    expect(live()).toBe('Stopped — the changes AI already made are on the canvas.');
    await act(async () => {
      (q('[data-testid="ai-result-keep-going"]') as HTMLButtonElement).click();
    });
    expect(calls.some((c) => c.url === '/_api/ai/runs/r_aaaaaaaaaaaa/keep-going')).toBe(true);
  });

  test('an answer that changed nothing gets no result card', async () => {
    const { emit, q } = await mount();
    await emit(run({ state: 'ended', outcome: 'done', touched: {} }));
    expect(q('[data-testid="ai-result"]')).toBeNull();
  });

  test('a run that is waiting its turn, or needs you, is not the working line’s to draw', async () => {
    const { emit, q } = await mount();
    await emit(run({ state: 'waiting' }));
    await emit(run({ state: 'needs-you', question: 'Replace the footer?' }));
    expect(q('[data-testid="ai-working"]')).toBeNull();
  });
});
