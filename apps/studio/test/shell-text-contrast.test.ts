import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { contrastRatio, oklchToRgb, parseOklch } from '../draw/palette';

const shell = readFileSync(new URL('../client/styles/3-shell-maude.css', import.meta.url), 'utf8');
const components = readFileSync(
  new URL('../client/styles/4-components.css', import.meta.url),
  'utf8'
);
const tokens = readFileSync(
  new URL('../client/styles/1-tokens-maude.css', import.meta.url),
  'utf8'
);
function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing selector ${selector}`);
  return css.slice(start + selector.length + 2, css.indexOf('}', start));
}

// Actual S19 axe findings: these are small readable labels, not disabled or
// decorative content. Pin their real CSS/token pairs; live axe additionally
// checks cascade, opacity and rendered backgrounds on the affected screens.
for (const theme of ['light', 'dark']) {
  const palette = block(tokens, `.maude[data-theme="${theme}"]`);
  const color = (token: string) => {
    const value = palette.match(new RegExp(`${token}:\\s*(oklch\\([^)]*\\))`))?.[1];
    if (!value) throw new Error(`Missing ${theme} ${token}`);
    return oklchToRgb(parseOklch(value));
  };
  for (const [selector, css] of [
    ['.st-mb-proj', shell],
    ['.st-sb-slot .lbl', shell],
    ['.st-sb-version .val', shell],
    ['.st-docktab', shell],
    ['.dv-zoom-sync', shell],
    ['.st-skel-cap', shell],
    ['.st-cloudwho-out', components],
  ]) {
    test(`${theme} ${selector} text meets AA on shell surfaces`, () => {
      const foreground = block(css, selector).match(/(?:^|;)\s*color:\s*var\((--[^)]+)\)/)?.[1];
      if (!foreground) throw new Error(`Missing text color for ${selector}`);
      // --u-* aliases point to the same Maude ladder inside the shell.
      const fg = color(foreground.replace('--u-', '--'));
      for (const surface of ['--bg-1', '--bg-2']) {
        expect(contrastRatio(fg, color(surface))).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
}
