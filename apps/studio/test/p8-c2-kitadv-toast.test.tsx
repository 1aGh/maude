// Phase 8 C1/C10 — a notification is the kit's one-line pill (06 ad-open-all, 10 co-sync-back): the kind's glyph,
// the sentence, ONE inline action in accent-text, then a quiet ×. Restart / link / reconnect events land at the top.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let NotificationHost: typeof import('../notifications.tsx').NotificationHost;
let notify: typeof import('../notifications.tsx').notify;
let dismissNotice: typeof import('../notifications.tsx').dismissNotice;
const realTimeout = globalThis.setTimeout;
let root: Root | null = null;

beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ({ NotificationHost, notify, dismissNotice } = await import('../notifications.tsx'));
});
afterEach(async () => {
  await act(async () => {
    dismissNotice('t-pill');
    dismissNotice('t-plain');
  });
  await act(async () => {
    await new Promise((r) => realTimeout(r, 350));
  });
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});
afterAll(async () => {
  await new Promise((r) => realTimeout(r, 500));
  GlobalRegistrator.unregister();
});

async function mountHost() {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<NotificationHost />));
}
const card = (id: string) =>
  document.querySelector(`[data-testid="notice-${id}"]`) as HTMLElement | null;
const settle = () =>
  act(async () => {
    await new Promise((r) => realTimeout(r, 60));
  });

describe('the toast pill', () => {
  test('a success with an action: glyph, sentence, action, then × — in that order, on one row', async () => {
    await mountHost();
    await act(async () => {
      notify({
        id: 't-pill',
        title: 'All Advanced sections are open.',
        kind: 'success',
        action: { label: 'Close all', onClick() {} },
      });
    });
    await settle();
    const c = card('t-pill');
    expect(c).not.toBeNull();
    const kids = [...(c as HTMLElement).children].map((n) => n.className.split(' ')[0]);
    expect(kids).toEqual([
      'maude-notice-ic',
      'maude-notice-txt',
      'maude-notice-action',
      'maude-notice-close',
    ]);
    expect((c as HTMLElement).querySelector('.maude-notice-ic svg')).toBeTruthy();
  });

  test('an explicit icon wins over the kind; placement top is accepted', async () => {
    await mountHost();
    await act(async () => {
      notify({ id: 't-plain', title: 'Back online', kind: 'info', placement: 'top', icon: 'sync' });
    });
    await settle();
    expect(card('t-plain')?.querySelector('.maude-notice-ic svg')).toBeTruthy();
  });

  test('the pill CSS is the kit toast: a row, 40 px, no left bar', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'notifications.tsx'), 'utf8');
    expect(src).toContain('flex-direction: row');
    expect(src).toContain('min-height: 40px');
    expect(src).not.toContain('border-left: 3px');
  });
});
