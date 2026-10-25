// V2-8.5 stage C round 8 (p8-c8-misc2) — 12 ia-brand-steps: a chosen logo shows ITSELF on the transparency checker
// in the drop well (the board's `bi-drop-ic`), not a ✓ glyph.

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

describe('12 ia-brand-steps — the chosen logo on the checker tile', () => {
  test('drop well: "+" before a logo, the logo itself (an img on the checker) after it', async () => {
    const made: unknown[] = [];
    (URL as unknown as { createObjectURL: (b: unknown) => string }).createObjectURL = (b) => {
      made.push(b);
      return 'blob:logo-1';
    };
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await React.act(async () => {
      root.render(React.createElement(BrandSheet as never, { open: true, onClose: () => {} }));
    });
    const ic = document.querySelector('.bi-drop-ic') as HTMLElement;
    expect(ic.textContent).toBe('+');
    expect(tid('brand-up-logo-preview')).toBeNull();

    // choose a file through the hidden input's own React onChange
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps$')) as string;
    const props = (input as unknown as Record<string, { onChange: (e: unknown) => void }>)[
      propsKey
    ];
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'alligators.svg', {
      type: 'image/svg+xml',
    });
    await React.act(async () => props.onChange({ target: { files: [file], value: '' } }));

    const img = tid('brand-up-logo-preview') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe('blob:logo-1');
    expect(img.getAttribute('alt')).toBe('');
    expect(document.querySelector('.bi-drop-ic')?.textContent).not.toContain('✓');
    expect(document.querySelector('.bi-drop-ic')?.classList.contains('bi-drop-ic--logo')).toBe(
      true
    );
    expect(made.length).toBe(1);
  });
});
