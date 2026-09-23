// S19 (self-host browser, axe + keyboard): the accepted-version preview is a
// modal, but Tab and Shift+Tab walked out of it into the page behind, and once
// focus had left, Escape no longer closed it. The sheet now keeps the keyboard.

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import DiffView from '../client/panels/DiffView.jsx';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const press = (key: string, shiftKey = false) =>
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  );

test('Tab and Shift+Tab stay inside the preview, Escape closes it and focus returns', async () => {
  const opener = document.createElement('button');
  opener.textContent = 'Preview';
  const behind = document.createElement('button');
  behind.textContent = 'Behind';
  const host = document.createElement('div');
  document.body.append(opener, host, behind);
  opener.focus();
  const root = createRoot(host);
  let closed = 0;
  try {
    await act(async () => {
      root.render(
        <DiffView
          target={{ file: '.design/ui/History.tsx', beforeSha: 'r8', conflict: false }}
          cfg={{ designRoot: '.design', designRel: '.design' }}
          loadLog={async () => [{ sha: 'r8', message: 'Original', date: '2026-09-22T12:00:00Z' }]}
          onRestore={async () => {}}
          onResolve={undefined}
          onClose={() => {
            closed += 1;
          }}
        />
      );
    });
    const sheet = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(sheet.contains(document.activeElement)).toBe(true);
    for (const frame of host.querySelectorAll('iframe')) expect(frame.tabIndex).toBe(-1);
    const controls = [
      ...sheet.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)'),
    ];
    const first = controls[0] as HTMLElement;
    const last = controls.at(-1) as HTMLElement;
    last.focus();
    press('Tab');
    expect(document.activeElement).toBe(first);
    first.focus();
    press('Tab', true);
    expect(document.activeElement).toBe(last);
    // Focus that escaped anyway is brought back on the next Tab.
    behind.focus();
    press('Tab');
    expect(sheet.contains(document.activeElement)).toBe(true);
    press('Escape');
    expect(closed).toBe(1);
    await act(async () => root.unmount());
    expect(document.activeElement).toBe(opener);
  } finally {
    host.remove();
    opener.remove();
    behind.remove();
  }
});
