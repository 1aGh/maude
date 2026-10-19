// S5.18 G6 (03 `ai-choice-fail`, `picked`) — an answered question leaves a settled card with the picked row marked.
// Red first: the card vanished the moment it was answered, so the chat kept no trace of what was chosen.
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
});

const elicitation = {
  id: 'e1',
  message: 'Which green?',
  requestedSchema: {
    properties: {
      question_0: {
        type: 'string',
        description: 'Which green?',
        oneOf: [
          { const: 'club', title: 'Club green', description: 'from the design system' },
          { const: 'light', title: 'Lighter green' },
        ],
      },
      question_0_custom: { type: 'string' },
    },
    required: ['question_0'],
  },
};

async function mountSlot() {
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const NeedsYouSlot = (await import('../client/v2/ai/NeedsYouSlot.jsx')).default;
  const runtime = await import('../client/panels/acp-runtime.js');
  const answers: unknown[] = [];
  const conn = runtime.createAcpConnection();
  function Host() {
    const [pending, setPending] = React.useState([elicitation]);
    return (
      <NeedsYouSlot
        conn={conn}
        chatId="c1"
        pendingElicitations={pending}
        onRespondElicitation={(a: unknown) => {
          answers.push(a);
          setPending([]); // the bridge settles the question: it leaves the pending list
        }}
      />
    );
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Host />));
  mounted.push(() => act(async () => root.unmount()));
  const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  return { act, host, q, answers };
}

describe('an answered question stays as a settled card', () => {
  test('pick a row → the answer goes out, the card stays read only with the picked row marked', async () => {
    const v = await mountSlot();
    expect(v.q('ai-choice-settled')).toBeNull();
    await v.act(async () => v.q('chat-elicit-option-question_0-1')?.click());
    expect(v.answers).toEqual([{ action: 'accept', content: { question_0: 'light' } }]);
    expect(v.q('chat-elicit-prompt')).toBeNull(); // nothing left to answer
    const settled = v.q('ai-choice-settled');
    expect(settled).not.toBeNull();
    expect(settled?.textContent).toContain('Which green?');
    const rows = [...(settled?.querySelectorAll('.ai-nc-opt') ?? [])] as HTMLElement[];
    expect(rows.map((r) => r.getAttribute('aria-current'))).toEqual([null, 'true', null]);
    expect(settled?.querySelector('button')).toBeNull(); // read only: nobody can answer twice
  });
});
