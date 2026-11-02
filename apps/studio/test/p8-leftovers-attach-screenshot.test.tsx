// p8-sweep-leftovers (lead follow-up 2): Attach › "Paste a screenshot" answers on every pick.
//
// The crawler called `ai-attach-menu-screenshot` DEAD in Tauri mode. A focused probe
// (scripts/v2-verify/dead-controls/probe-screenshot.mjs) showed a first pick answers within 100 ms ("There’s no
// picture on the clipboard…"), but a second pick with the same clipboard changed nothing: the same line was
// already up, so setting it again drew and announced nothing. The pick now takes the line down first.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let useAttachments: typeof import('../client/v2/ai/use-attachments.js').useAttachments;
let root: Root | null = null;
beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ({ useAttachments } = await import('../client/v2/ai/use-attachments.js'));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});
afterAll(() => GlobalRegistrator.unregister());

describe('Attach › Paste a screenshot', () => {
  test('a second pick with an empty clipboard draws its line again', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: () => new Promise((r) => setTimeout(() => r([]), 5)) },
    });
    const seen: string[] = [];
    let api: { pasteScreenshot: () => Promise<void> } | null = null;
    function Host() {
      const a = useAttachments({
        chatId: 'c1',
        attachmentsRef: { current: [] },
        fetchImpl: (async () => Response.json({})) as any,
      });
      api = a as never;
      useEffect(() => {
        seen.push(a.notice);
      }, [a.notice]);
      return null;
    }
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(createElement(Host)));
    // each pick: start it (its first render lands), then let the clipboard answer
    for (let i = 0; i < 2; i++) {
      let pick: Promise<void> | undefined;
      await act(async () => {
        pick = api?.pasteScreenshot();
      });
      await act(async () => {
        await pick;
      });
    }
    const line = 'There’s no picture on the clipboard. Copy a screenshot, then paste.';
    expect(seen).toEqual(['', line, '', line]);
  });
});
