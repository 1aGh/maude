// S8.18 — the Import a brand sheet, rendered: type a website → Reading names the site → "Couldn't
// read <site>." with Try again as the one action → Try again reads it → colours with roles, fonts,
// a preview. The routes are stubbed; their own behaviour is brand-site-read / brand-site-gate.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let BrandSheet: (p: { open: boolean; onClose: () => void }) => unknown;

beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  BrandSheet = (await import('../client/v2/import/brand-sheet.jsx')).default;
});
afterAll(() => GlobalRegistrator.unregister());

const tid = (s: string) => document.querySelector(`[data-testid="${s}"]`) as HTMLElement | null;

// Typing calls the input's own React onChange: react-dom decides at import time whether the page can hear
// `input` events, and when an earlier file in the same bun process loaded react-dom before happy-dom was
// registered, a dispatched `input` event never reaches onChange (see v2-search-ui.test.tsx).
function type(el: HTMLInputElement, value: string) {
  const propsKey = Object.keys(el).find((k) => k.startsWith('__reactProps$')) as string;
  const props = (el as unknown as Record<string, { onChange: (e: unknown) => void }>)[propsKey];
  // the instance setter keeps React's value tracker in step, as after a real keystroke
  el.value = value;
  props.onChange({ target: el, currentTarget: el });
}

async function until(fn: () => unknown, ms = 2000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await React.act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

describe('Import a brand sheet', () => {
  test('a failed website: Reading names it, the callout says why, Try again is the one action', async () => {
    const answers = [
      {
        status: 422,
        body: {
          ok: false,
          code: 'site-unreadable',
          site: { ok: false, host: 'studio-brno.cz', reason: 'timeout' },
        },
      },
      {
        status: 201,
        body: {
          ok: true,
          site: {
            ok: true,
            host: 'studio-brno.cz',
            palette: [
              { value: '#ff6f61', count: 4, hint: 'accent' },
              { value: '#1b1f2a', count: 9 },
              { value: '#f7f4ee', count: 7 },
            ],
            fonts: ['Inter'],
          },
        },
      },
    ];
    const posted: unknown[] = [];
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      posted.push(JSON.parse(init.body));
      const a = answers.shift() ?? answers[0];
      return new Response(JSON.stringify(a?.body), { status: a?.status });
    }) as unknown as typeof fetch;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await React.act(async () => {
      root.render(React.createElement(BrandSheet as never, { open: true, onClose: () => {} }));
    });
    expect(tid('brand-sheet')?.dataset.step).toBe('input');
    expect((tid('brand-import') as HTMLButtonElement).disabled).toBe(true);

    await React.act(async () =>
      type(tid('brand-website') as HTMLInputElement, 'www.studio-brno.cz')
    );
    expect((tid('brand-import') as HTMLButtonElement).disabled).toBe(false);
    await React.act(async () => tid('brand-import')?.click());

    await until(() => tid('brand-site-failed'));
    expect(tid('brand-sheet')?.dataset.step).toBe('site-failed');
    // said once, by the callout (ia-brand-steps step 3 draws the logo row and the callout, no second amber row)
    expect(tid('brand-read-site')).toBeNull();
    expect(tid('brand-site-failed')?.textContent).toContain("Couldn't read studio-brno.cz.");
    expect(tid('brand-site-failed')?.textContent).toContain("It didn't answer in 20 s.");
    // no logo was dropped: no "Continue with the logo" — Try again is the one action
    expect(tid('brand-continue-logo')).toBeNull();
    expect(tid('brand-try-again')).not.toBeNull();
    expect(posted[0]).toEqual({ url: 'www.studio-brno.cz' });

    await React.act(async () => tid('brand-try-again')?.click());
    await until(() => tid('brand-up-result'));
    expect(tid('brand-sheet')?.dataset.step).toBe('result');
    const roles = [0, 1, 2].map((i) => tid(`brand-colour-${i}`)?.dataset.role);
    expect(roles).toEqual(['accent', 'text', 'background']);
    expect(tid('brand-colour-0')?.textContent).toContain('Coral');
    expect(tid('brand-up-fonts')?.textContent).toContain('Inter');
    expect(tid('brand-up-fonts')?.textContent).toContain('from the website');
    expect(tid('brand-lettering-shapes')).toBeNull(); // no logo, nothing to say about its lettering
    expect(tid('brand-preview')).not.toBeNull();
    expect(tid('brand-use-style')?.textContent).toBe("Use as the project's style");

    // a role moves: give Accent to Ink, and Coral loses it
    const sel = tid('brand-colour-role-1') as HTMLSelectElement;
    await React.act(async () => {
      sel.value = 'accent';
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    expect(tid('brand-colour-1')?.dataset.role).toBe('accent');
    expect(tid('brand-colour-0')?.dataset.role).toBe('none');

    await React.act(async () => root.unmount());
    host.remove();
  });
});
