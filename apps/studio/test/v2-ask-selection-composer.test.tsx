// S2.19 — the composer's side of ⌘/ on a selection: take the scope first, send through the composer's own
// runtime once the chip has it, then let the chip follow the selection again. Composer.jsx itself never sends
// (the ⌘K contract, test/v2-ai-host.test.ts) — this hook is the one door.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

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

import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { sendAskSelection } from '../client/v2/ai/ask-selection.js';
import { elementsScope } from '../client/v2/ai/scope.js';
import { SCOPE_RESET_MS, useAskSelection } from '../client/v2/ai/use-ask-selection.js';

const REFS = [
  { artboard: 'desktop', element: 'card-a' },
  { artboard: 'desktop', element: 'card-b' },
];

function Probe({
  runtime,
  log,
}: {
  runtime: { setText(t: string): void; send(): void };
  log: Array<string | null>;
}) {
  // the panel's chip: a choice the hook sets, "follow the selection" (whole) otherwise
  const [choice, setChoice] = useState<ReturnType<typeof elementsScope> | null>(null);
  useAskSelection({
    composerRuntime: runtime,
    scope: choice ?? { kind: 'whole' },
    onChooseScope: (next: object | null) => {
      log.push(next ? (next as { kind: string }).kind : null);
      setChoice(next as never);
    },
  });
  return null;
}

describe('useAskSelection', () => {
  test('scope first, then ONE send with the words; the chip then follows the selection again', async () => {
    const target = globalThis;
    const calls: string[] = [];
    const log: Array<string | null> = [];
    const runtime = {
      setText: (t: string) => calls.push(`text:${t}`),
      send: () => calls.push('send'),
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<Probe runtime={runtime} log={log} />);
    });
    await act(async () => {
      sendAskSelection({ text: 'Add a link', scope: elementsScope(REFS) }, target);
    });
    // the chip took the scope before the composer sent (the frozen context is the selection's)
    expect(log[0]).toBe('elements');
    expect(calls).toEqual(['text:Add a link', 'send']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, SCOPE_RESET_MS + 60));
    });
    expect(log.at(-1)).toBeNull();
    expect(calls.filter((c) => c === 'send')).toHaveLength(1);
    await act(async () => {
      root.unmount();
    });
  });
});
