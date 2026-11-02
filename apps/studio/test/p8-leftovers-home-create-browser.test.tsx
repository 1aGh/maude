// p8-sweep-leftovers item 4: "Create project" on Home in a browser rests and says why.
//
// The crawler found `home-create-submit` dead in browser Home: Home's create flow is native-only
// (`createProject` returns when `!data.native`), yet the button looked live. It now greys with Home's own
// callout line (`REASONS.homeBrowser`), and a submit (Enter in the name field) does nothing.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let CreateLocalSheet: typeof import('../client/v2/signin/CreateLocalSheet.jsx').CreateLocalSheet;
let REASONS: typeof import('../client/v2/access/disabled-reason.js').REASONS;
let root: Root | null = null;

beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ({ CreateLocalSheet } = await import('../client/v2/signin/CreateLocalSheet.jsx'));
  ({ REASONS } = await import('../client/v2/access/disabled-reason.js'));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});
afterAll(() => GlobalRegistrator.unregister());

async function mount(props: Record<string, unknown>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  let submits = 0;
  await act(async () => {
    root?.render(
      createElement(CreateLocalSheet, {
        value: { name: 'Demo', busy: false },
        onChange: () => {},
        onSubmit: () => {
          submits += 1;
        },
        onCancel: () => {},
        ...props,
      })
    );
  });
  const btn = host.querySelector('[data-testid="home-create-submit"]') as HTMLButtonElement;
  const form = host.querySelector('[data-testid="home-create-dialog"]') as HTMLFormElement;
  return { btn, form, submits: () => submits };
}

describe('Create a local project — Home in a browser', () => {
  test('browser Home: the button rests with the callout line; submit is a no-op', async () => {
    const { btn, form, submits } = await mount({ native: false });
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe(REASONS.homeBrowser);
    expect(btn.getAttribute('aria-description')).toBe(REASONS.homeBrowser);
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(submits()).toBe(0);
  });

  test('the app: the button acts and says nothing extra', async () => {
    const { btn, form, submits } = await mount({ native: true });
    expect(btn.disabled).toBe(false);
    expect(btn.hasAttribute('title')).toBe(false);
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(submits()).toBe(1);
  });
});
