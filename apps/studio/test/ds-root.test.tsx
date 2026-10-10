// V2-2.15 (V2-1.13 §5.11, lead decision B): <DSRoot> renders `class="ds"` + data-theme from, in
// order, its `theme` prop, the system the canvas's `@maude/ds` import registered, or nothing.
import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { __registerDesignSystem, DSRoot } from '../canvas-lib.tsx';

describe('<DSRoot>', () => {
  // first: module state is per bundle, and nothing has registered yet
  test('no @maude/ds import → no data-theme', () => {
    expect(renderToStaticMarkup(<DSRoot>x</DSRoot>)).toBe('<div class="ds">x</div>');
  });

  test('the registered system default renders when no prop is given', () => {
    __registerDesignSystem({ name: 'fx', themeDefault: 'dark' });
    expect(renderToStaticMarkup(<DSRoot>x</DSRoot>)).toBe(
      '<div class="ds" data-theme="dark">x</div>'
    );
  });

  test('the theme prop wins; as / className / other props pass through', () => {
    __registerDesignSystem({ name: 'fx', themeDefault: 'dark' });
    expect(
      renderToStaticMarkup(
        <DSRoot theme="light" as="section" className="shell" id="r">
          x
        </DSRoot>
      )
    ).toBe('<section id="r" class="ds shell" data-theme="light">x</section>');
  });

  test('idempotent, last import wins; two different systems warn once per change', () => {
    const warn = mock(() => {});
    const orig = console.warn;
    console.warn = warn;
    try {
      __registerDesignSystem({ name: 'fx', themeDefault: 'dark' });
      __registerDesignSystem({ name: 'fx', themeDefault: 'dark' });
      expect(warn).toHaveBeenCalledTimes(0);
      __registerDesignSystem({ name: 'other', themeDefault: 'light' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(renderToStaticMarkup(<DSRoot />)).toBe('<div class="ds" data-theme="light"></div>');
    } finally {
      console.warn = orig;
    }
  });
});
