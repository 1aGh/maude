// S10.4b (V2-1.13 §5.7) — a canvas switched from alpha to beta keeps its source; S10.14 wrote
// `meta.dsPairing` for the slot names beta lacks, and the shell emits them as canvas-scoped aliases.
// Two layers: what the shell's fallback slot carries (and refuses), and — in a real Chromium — that the
// element using alpha's `--accent-2` paints beta's paired `--accent`, per theme, and that a name beta
// declares itself keeps beta's own value.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { pairingCssFor } from '../ds/pairing-css.ts';
import { FALLBACKS_SLOT, injectFallbacks } from '../ds/shell-fallbacks.ts';

const REV = 'c'.repeat(64);
const BETA_TOKENS = `:root, [data-theme="light"] { --accent: rgb(255, 0, 0); --fg-0: rgb(1, 2, 3); --display-3: 40px; }
[data-theme="dark"] { --accent: rgb(0, 0, 255); }
`;

const root = mkdtempSync(join(tmpdir(), 'ds-pairing-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const config = {
  designSystems: [
    { name: 'alpha', path: 'system/alpha', rootClass: 'alpha' },
    { name: 'beta', path: 'system/beta', rootClass: 'beta' },
  ],
};
put('system/alpha/colors_and_type.css', ':root { --accent: green; --accent-2: green; }');
put('system/beta/colors_and_type.css', BETA_TOKENS);
put(`system/beta/revisions/${REV}.tokens.css`, BETA_TOKENS);
put('ui/Pairs.tsx', 'export default () => null;');
const PAIRS_META = {
  designSystem: 'beta',
  dsPairing: { '--accent-2': '--accent', '--display-4': '--display-3' },
};
put('ui/Pairs.meta.json', JSON.stringify(PAIRS_META));
put('ui/Home.tsx', 'export default () => null;');
put('ui/Home.meta.json', JSON.stringify({ designSystem: 'beta' }));

const q = (o: Record<string, string>) => new URLSearchParams(o);
const BETA = 'system/beta/colors_and_type.css';

describe('the shell slot', () => {
  test('a switched canvas gets its pairing as aliases, after the fallback layer', () => {
    const html = `<head>${FALLBACKS_SLOT}<link id="canvas-tokens"></head>`;
    const out = injectFallbacks(html, root, config, q({ canvas: 'ui/Pairs.tsx', tokens: BETA }));
    expect(out).toContain('--accent-2: var(--accent);');
    expect(out).toContain('--display-4: var(--display-3);');
    expect(out).toContain(':where(:root, .ds, .beta, [data-theme])');
    // unlayered and after `@layer maude.fallback`, before the tokens link
    expect(out.indexOf('--accent-2: var(')).toBeGreaterThan(out.indexOf('@layer maude.fallback {'));
    expect(out.indexOf('--accent-2: var(')).toBeLessThan(out.indexOf('canvas-tokens'));
  });

  test('designRel-prefixed canvas paths and revision stylesheets resolve the same', () => {
    const tokens = `system/beta/revisions/${REV}.tokens.css`;
    const css = pairingCssFor(
      root,
      config,
      q({ canvas: '.design/ui/Pairs.tsx', designRel: '.design', tokens })
    );
    expect(css).toContain('--accent-2: var(--accent);');
    // a converted system's canvases load a revision stylesheet: its system still gets its fallback layer
    const out = injectFallbacks(FALLBACKS_SLOT, root, config, q({ canvas: 'ui/Home.tsx', tokens }));
    expect(out).toContain('@layer maude.fallback {');
  });

  test('nothing applies: no pairing, another system previewed, outside the root, a past look', () => {
    expect(pairingCssFor(root, config, q({ canvas: 'ui/Home.tsx', tokens: BETA }))).toBe('');
    // a dsPreview of alpha: the pairing was made for beta
    expect(
      pairingCssFor(
        root,
        config,
        q({ canvas: 'ui/Pairs.tsx', tokens: 'system/alpha/colors_and_type.css' })
      )
    ).toBe('');
    expect(pairingCssFor(root, config, q({ canvas: '../ui/Pairs.tsx', tokens: BETA }))).toBe('');
    expect(pairingCssFor(root, config, q({ canvas: 'ui/Pairs.tsx', tokens: 'nope.css' }))).toBe('');
    // ?sha= never wears today's meta; its own meta lane does
    expect(
      pairingCssFor(root, config, q({ canvas: 'ui/Pairs.tsx', tokens: BETA, sha: 'abc' }))
    ).toBe('');
    expect(
      pairingCssFor(
        root,
        config,
        q({ canvas: 'ui/Pairs.tsx', tokens: BETA, sha: 'abc' }),
        JSON.stringify({ designSystem: 'beta', dsPairing: { '--accent-3': '--accent' } })
      )
    ).toContain('--accent-3: var(--accent);');
  });

  test('peer-authored pairs are names only (DDR-054): values, urls and </style> never pass', () => {
    put(
      'ui/Evil.meta.json',
      JSON.stringify({
        designSystem: 'beta',
        dsPairing: {
          '--accent-2': 'red; } body { background: url(https://x.test/a) } :root {',
          '--x</style><script>': '--accent',
          '--fine': '--accent',
          '--self': '--self',
          '--obj': { a: 1 },
          '--accent': '--fg-0', // beta declares it: beta's own value wins
        },
      })
    );
    put('ui/Evil.tsx', '');
    const html = `<head>${FALLBACKS_SLOT}</head>`;
    const out = injectFallbacks(html, root, config, q({ canvas: 'ui/Evil.tsx', tokens: BETA }));
    expect(out).toContain('--fine: var(--accent);');
    expect(out).not.toContain('url(');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('--self:');
    expect(out).not.toContain('--obj');
    expect(out).not.toContain('--accent: var(');
    expect(out.match(/<\/style>/g)?.length).toBe(1);
  });
});

// biome-ignore lint/suspicious/noExplicitAny: playwright surface
type Any = any;

describe('headless lane — the cascade', () => {
  test('alpha’s --accent-2 renders beta’s paired --accent, in each theme', async () => {
    const slot = injectFallbacks(
      `${FALLBACKS_SLOT}`,
      root,
      config,
      q({ canvas: 'ui/Pairs.tsx', tokens: BETA })
    );
    const { launchChromium } = (await import('../bin/_pw-launch.mjs')) as {
      launchChromium: () => Promise<Any>;
    };
    const browser = await launchChromium();
    try {
      const page = await browser.newPage();
      // the shell's order: fallbacks (+ aliases) → tokens
      await page.setContent(`<!doctype html><html><head>${slot}<style>${BETA_TOKENS}</style></head>
<body><div class="ds" data-theme="light"><b id="l" style="color: var(--accent-2, rgb(9, 9, 9))">a</b>
<i id="sz" style="width: var(--display-4, 1px); display: block">s</i></div>
<div class="ds" data-theme="dark"><b id="d" style="color: var(--accent-2, rgb(9, 9, 9))">a</b></div></body></html>`);
      const color = (sel: string) =>
        page.evaluate(
          (s: string) => getComputedStyle(document.querySelector(s) as Element).color,
          sel
        );
      expect(await color('#l')).toBe('rgb(255, 0, 0)');
      expect(await color('#d')).toBe('rgb(0, 0, 255)');
      expect(
        await page.evaluate(() => getComputedStyle(document.querySelector('#sz') as Element).width)
      ).toBe('40px');
    } finally {
      await browser.close();
    }
  }, 60_000);
});
