import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { contrastRatio } from '../draw/palette';
import { shellColor } from './fixtures/shell-palette';

const shell = readFileSync(new URL('../client/styles/3-shell-maude.css', import.meta.url), 'utf8');
const leftPanel = readFileSync(
  new URL('../client/v2/left-panel/left-panel.css', import.meta.url),
  'utf8'
);
const callouts = readFileSync(new URL('../client/v2/shell/callouts.css', import.meta.url), 'utf8');
function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing selector ${selector}`);
  return css.slice(start + selector.length + 2, css.indexOf('}', start));
}

// Actual S19 axe findings: these are small readable labels, not disabled or
// decorative content. Pin their real CSS/token pairs; live axe additionally
// checks cascade, opacity and rendered backgrounds on the affected screens.
for (const theme of ['light', 'dark']) {
  // P8 C0: the generated maude-v2 shell ladder; translucent values composite over the island (--bg-1)
  const color = (token: string) => shellColor(theme as 'light' | 'dark', token);
  for (const [selector, css] of [
    ['.st-callout-t > span', callouts],
    ['.lp-tab', leftPanel],
    ['.dv-zoom-sync', shell],
    ['.st-skel-cap', shell],
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

// V2-4.gate (design-critic blocker 3, a11y B6): `--fg-3` is the DISABLED grade (3.0:1 on the islands) and
// had been used for real text — palette group labels and footer, Settings notes, Layers type labels, the
// "?" sheet's "or" and notes, placeholders. Every rule below carries text, so each must resolve to a token
// that holds 4.5:1 on the three surfaces text sits on (--bg-1 island, --bg-2 popover, --bg-3 well).
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const components = read('../client/styles/4-components.css');
const search = read('../client/v2/search/search.css');
const fold = read('../client/v2/fold/fold.css');

const TEXT_RULES: [string, string, string][] = [
  ['shell', '.st-search-box', shell],
  ['shell', '.st-search-box input::placeholder', shell],
  ['shell', '.st-tree-empty', shell],
  ['shell', '.st-pal-search', shell],
  ['shell', '.st-pal-search input::placeholder', shell],
  ['shell', '.st-pal-group', shell],
  ['shell', '.st-pal-empty', shell],
  ['shell', '.st-pref-note', shell],
  ['shell', '.st-layer-caret', shell],
  ['shell', '.st-layer-type', shell],
  ['shell', '.st-rp-hint', shell],
  ['shell', '.so-or', shell],
  ['shell', '.so-section-hd', shell],
  ['shell', '.st-present-exit-kbd', shell],
  ['shell', '.st-tree-sec-hd .st-sec-name', shell],
  ['shell', '.st-tree-sec-hd .st-sec-count', shell],
  ['components', '.st-settings-intro', components],
  ['components', '.st-provider-notes', components],
  ['components', '.st-engine-radio-note', components],
  ['search', '.st-pal-aside', search],
  ['search', '.st-pal-meta', search],
  ['search', '.st-pal-foot', search],
  ['search', '.so-find', search],
  ['search', '.so-note', search],
  ['search', '.so-sub', search],
  ['search', '.so-adv-count', search],
  ['search', '.so-adv-path', search],
  ['fold', '.v2-fold-hint', fold],
];

for (const theme of ['light', 'dark']) {
  // P8 C0: the generated maude-v2 shell ladder; translucent values composite over the island (--bg-1)
  const color = (token: string) => shellColor(theme as 'light' | 'dark', token);
  const ratio = (fg: string, bg: string) => contrastRatio(color(fg), color(bg));
  const SURFACES = ['--bg-1', '--bg-2', '--bg-3'];

  for (const [label, selector, css] of TEXT_RULES) {
    test(`${theme} ${label} ${selector} text is off the disabled --fg-3 and holds AA`, () => {
      const token = block(css, selector).match(/(?:^|;)\s*color:\s*var\((--[^),]+)/)?.[1];
      if (!token) throw new Error(`Missing text color for ${selector}`);
      expect(token).not.toBe('--fg-3');
      for (const surface of SURFACES) {
        expect(ratio(token, surface)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  for (const tone of ['success', 'warn', 'error']) {
    test(`${theme} --status-${tone}-text holds AA on the surfaces (Diagnostics words, menu status)`, () => {
      for (const surface of SURFACES) {
        expect(ratio(`--status-${tone}-text`, surface)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  // the Diagnostics tabs are gone (P8 C2, decision v2-p8-c2-kitadv-diagnostics-three-boxes: Logs, Server and AI
  // setup are three boxes at once), so the selected-tab contrast pin has nothing left to read.

  test(`${theme} the Present exit pill is not faded and its label and Esc hint hold AA on it`, () => {
    const pill = block(shell, '.st-present-exit');
    expect(pill).not.toMatch(/(^|;)\s*opacity:/);
    expect(ratio('--fg-1', '--bg-1')).toBeGreaterThanOrEqual(4.5);
    const kbd = block(shell, '.st-present-exit-kbd').match(/color:\s*var\((--[^)]+)\)/)?.[1];
    if (!kbd) throw new Error('Missing Esc hint colour');
    expect(ratio(kbd, '--bg-1')).toBeGreaterThanOrEqual(4.5);
  });
}
