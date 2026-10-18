// S10.1 (V2-1.6 §5.5): the patching generator. G1 — parseSystem(generate(prev, model)) ≡ model;
// G2 — generate(prev, parseSystem(prev)) === prev byte for byte (an empty publish writes nothing).
// Block location follows DDR-172 D7: top-level only, comment- / string-aware, span-only
// replacement, and a block that can't be located is a hard refusal (`ds-generate-block`).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  DsGenerateError,
  emitTokensJson,
  type GenConfig,
  generateComponentsCss,
  generateTokensCss,
  normalizeModel,
  parseSystem,
  type TokenModel,
} from '../ds/generate.ts';
import { SCHEMA_DIR } from '../paths.ts';
import { conformantFiles, fixtureConfig } from './_ds-fixture.ts';

const req = createRequire(import.meta.url);
const Ajv2020 = req('ajv/dist/2020.js').default;
const DESIGN = join(import.meta.dir, '../../../.design');
const designConfig = JSON.parse(readFileSync(join(DESIGN, 'config.json'), 'utf8'));

function realSystem(name: string): { cfg: GenConfig; css: string; json: string | null } {
  const e = designConfig.designSystems.find((d: { name: string }) => d.name === name);
  const cfg: GenConfig = {
    name,
    rootClass: e.rootClass,
    themes: e.themes,
    defaultTheme: e.themeDefault,
    colorSpace: designConfig.colorSpace ?? null,
  };
  const css = readFileSync(join(DESIGN, e.tokensCssRel), 'utf8');
  let json: string | null = null;
  try {
    json = readFileSync(join(DESIGN, e.path, 'tokens.json'), 'utf8');
  } catch {}
  return { cfg, css, json };
}

const fx = fixtureConfig();
const fxCfg: GenConfig = {
  name: fx.name,
  rootClass: fx.rootClass,
  themes: fx.themes,
  defaultTheme: fx.themeDefault,
  colorSpace: fx.colorSpace,
};
const fxCss = conformantFiles()[fx.tokensCssRel];

const parse = (cfg: GenConfig, css: string, json: string | null = null) =>
  parseSystem({ config: cfg, tokensCss: css, tokensJson: json });
const gen = (prev: string | null, m: TokenModel, cfg: GenConfig) => generateTokensCss(prev, m, cfg);
const clone = (m: TokenModel): TokenModel => structuredClone(m);

/** G1 for the values and themes, plus G2 on the output (so a second publish is empty). */
function roundTrip(cfg: GenConfig, prev: string | null, model: TokenModel): string {
  const out = gen(prev, model, cfg);
  const back = parse(cfg, out, emitTokensJson(model));
  expect(back).toEqual(normalizeModel(model));
  expect(gen(out, back, cfg)).toBe(out);
  return out;
}

const SINGLE: GenConfig = {
  name: 'one',
  rootClass: null,
  themes: ['light'],
  defaultTheme: 'light',
  colorSpace: null,
};
const SINGLE_CSS = `/* one theme, :root only */
:root {
  --accent: oklch(0.5 0.2 255);
  --radius-md: 8px; /* a trailing comment } with a brace */
  --font-body: "Brand } Sans", system-ui;
}

.card { color: var(--accent); }
`;

const MEDIA_DUP = `:root,
.mx[data-theme="light"],
.ds[data-theme="light"] {
  --bg-0: white;
  --dur-fast: 120ms;
}
.mx[data-theme="dark"],
.ds[data-theme="dark"] {
  --bg-0: black;
}
@media (prefers-reduced-motion: reduce) {
  :root,
  .mx[data-theme="light"],
  .ds[data-theme="light"],
  .mx[data-theme="dark"],
  .ds[data-theme="dark"] {
    --dur-fast: 1ms;
    --bg-0: hotpink; /* never counted, never patched */
  }
}
`;
const MX: GenConfig = {
  name: 'mx',
  rootClass: 'mx',
  themes: ['light', 'dark'],
  defaultTheme: 'light',
  colorSpace: null,
};

describe('G2: an empty publish is byte-identical', () => {
  for (const ds of ['maude', 'maude-v2']) {
    test(`${ds} (real)`, () => {
      const { cfg, css, json } = realSystem(ds);
      expect(gen(css, parse(cfg, css, json), cfg)).toBe(css);
    });
  }
  test('fixture (two themes + invariant block)', () => {
    expect(gen(fxCss, parse(fxCfg, fxCss), fxCfg)).toBe(fxCss);
  });
  test('single theme, :root only, `}` in a comment and a string', () => {
    expect(gen(SINGLE_CSS, parse(SINGLE, SINGLE_CSS), SINGLE)).toBe(SINGLE_CSS);
  });
  test('@media duplicates of the theme selectors', () => {
    expect(gen(MEDIA_DUP, parse(MX, MEDIA_DUP), MX)).toBe(MEDIA_DUP);
  });
});

describe('parseSystem', () => {
  test('values per theme follow §5.3.2 (no inheritance); @media declarations never count', () => {
    const m = parse(MX, MEDIA_DUP);
    expect(m.tokens['--bg-0'].values).toEqual({ light: 'white', dark: 'black' });
    expect(m.tokens['--dur-fast'].values).toEqual({ light: '120ms' });
  });
  test('a `}` inside a comment or string never ends the block', () => {
    const m = parse(SINGLE, SINGLE_CSS);
    expect(m.tokens['--font-body'].values.light).toBe('"Brand } Sans", system-ui');
    expect(m.tokens['--radius-md'].values.light).toBe('8px');
  });
  test('tokens.json designer data and unknown keys are kept; derived fields are not data', () => {
    const { cfg, css, json } = realSystem('maude-v2');
    const doc = JSON.parse(json ?? emitTokensJson(parse(cfg, css)));
    const leaf = doc.color.accent.$root ?? doc.color.accent;
    Object.assign(leaf.$extensions['sh.maude'], { label: 'Akcent', locked: true, futureKey: 7 });
    leaf.$extensions['org.other'] = { x: 1 };
    leaf.$description = 'note';
    doc.$extensions['sh.maude'].futureRoot = { a: 1 };
    doc.$extensions['sh.maude'].label = 'Maude v2';
    doc.$description = 'top note';
    const m = parse(cfg, css, JSON.stringify(doc));
    expect(m.tokens['--accent'].data).toEqual({ label: 'Akcent', locked: true, futureKey: 7 });
    expect(m.tokens['--accent'].extra).toEqual({
      $description: 'note',
      $extensions: { 'org.other': { x: 1 } },
    });
    expect(m.meta).toMatchObject({ futureRoot: { a: 1 }, label: 'Maude v2' });
    expect(m.extra).toEqual({ $description: 'top note' });
    // …and they round-trip through emit → parse
    const again = parse(cfg, css, emitTokensJson(m));
    expect(again).toEqual(m);
  });
  test('a __proto__ key in tokens.json never reaches a prototype', () => {
    const json = '{"$extensions":{"sh.maude":{"__proto__":{"polluted":1}}},"__proto__":{"p":1}}';
    const m = parse(SINGLE, SINGLE_CSS, json);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(m.meta)).toBe(Object.prototype);
  });
});

describe('G1: parseSystem(generate(prev, model)) ≡ model', () => {
  for (const ds of ['maude', 'maude-v2']) {
    const { cfg, css, json } = realSystem(ds);
    const base = parse(cfg, css, json);
    const [first, second] = cfg.themes;

    test(`${ds}: a per-theme colour changes in one theme only`, () => {
      const m = clone(base);
      m.tokens['--accent'].values[second] = 'oklch(0.61 0.17 250)';
      const out = roundTrip(cfg, css, m);
      expect(out.length - css.length).toBe(
        'oklch(0.61 0.17 250)'.length - base.tokens['--accent'].values[second].length
      );
    });

    test(`${ds}: a new token in every theme with one value, and one in a single theme`, () => {
      const m = clone(base);
      m.tokens['--x-test-line'] = {
        css: '--x-test-line',
        values: Object.fromEntries(cfg.themes.map((t) => [t, '1px'])),
        data: { label: 'Linka' },
        extra: {},
      };
      m.tokens['--x-test-glow'] = {
        css: '--x-test-glow',
        values: { [second]: 'oklch(0.7 0.1 30)' },
        data: {},
        extra: {},
      };
      roundTrip(cfg, css, m);
    });

    test(`${ds}: a token is removed`, () => {
      const m = clone(base);
      const name = Object.keys(m.tokens).find((n) => n.startsWith('--shadow-')) as string;
      expect(name).toBeDefined();
      delete m.tokens[name];
      const out = roundTrip(cfg, css, m);
      expect(parse(cfg, out).tokens[name]).toBeUndefined();
    });

    test(`${ds}: a shared value diverges per theme`, () => {
      const m = clone(base);
      const shared = Object.values(m.tokens).find(
        (t) => t.values[first] !== undefined && t.values[first] === t.values[second]
      );
      expect(shared).toBeDefined();
      if (!shared) return;
      shared.values[first] = '13px';
      shared.values[second] = '17px';
      roundTrip(cfg, css, m);
    });

    test(`${ds}: a trashed token's value becomes var(<replacement>)`, () => {
      const m = clone(base);
      const t = m.tokens['--accent'];
      t.data.trashed = {
        replacement: '--fg-0',
        at: '2026-10-09T10:00:00Z',
        by: { kind: 'person', name: 'T' },
        previous: { ...t.values },
      };
      const out = roundTrip(cfg, css, m);
      expect(parse(cfg, out).tokens['--accent'].values[first]).toBe('var(--fg-0)');
    });
  }

  test('fixture: an invariant-block token diverges → one declaration per theme block', () => {
    const inv = fxCss.slice(fxCss.lastIndexOf(':root'));
    const name = /(--[a-z0-9-]+):/.exec(inv)?.[1] as string;
    const m = clone(parse(fxCfg, fxCss));
    expect(m.tokens[name].values.light).toBe(m.tokens[name].values.dark);
    m.tokens[name].values.light = '13px';
    m.tokens[name].values.dark = '17px';
    const out = roundTrip(fxCfg, fxCss, m);
    expect(out.slice(out.lastIndexOf(':root'))).not.toContain(`${name}:`);
    // and the reverse order: an invariant block BEFORE the theme blocks
    const before = `:root, .mx[data-theme="light"], .ds[data-theme="light"], .mx[data-theme="dark"], .ds[data-theme="dark"] {\n  --gap: 4px;\n}\n:root,\n.mx[data-theme="light"],\n.ds[data-theme="light"] {\n  --bg-0: white;\n}\n.mx[data-theme="dark"],\n.ds[data-theme="dark"] {\n  --bg-0: black;\n}\n`;
    const m2 = clone(parse(MX, before));
    m2.tokens['--gap'].values.dark = '6px';
    expect(roundTrip(MX, before, m2)).toBe(
      before
        .replace('  --gap: 4px;\n', '')
        .replace('--bg-0: white;\n', '--bg-0: white;\n  --gap: 4px;\n')
        .replace('--bg-0: black;\n', '--bg-0: black;\n  --gap: 6px;\n')
    );
  });

  test('the @media reduced-motion block keeps its bytes; a new --dur-* collapses there', () => {
    const m = clone(parse(MX, MEDIA_DUP));
    m.tokens['--bg-0'].values.dark = 'navy';
    m.tokens['--dur-slow'] = {
      css: '--dur-slow',
      values: { light: '400ms', dark: '400ms' },
      data: {},
      extra: {},
    };
    const out = roundTrip(MX, MEDIA_DUP, m);
    expect(out).toContain('--bg-0: hotpink; /* never counted, never patched */');
    expect(out).toContain('never patched */\n    --dur-slow: 1ms;\n  }\n}');
  });

  test('single theme: patch beside a comment containing `}`', () => {
    const m = clone(parse(SINGLE, SINGLE_CSS));
    m.tokens['--radius-md'].values.light = '12px';
    m.tokens['--space-1'] = { css: '--space-1', values: { light: '4px' }, data: {}, extra: {} };
    const out = roundTrip(SINGLE, SINGLE_CSS, m);
    expect(out).toBe(
      SINGLE_CSS.replace('--radius-md: 8px;', '--radius-md: 12px;').replace(
        'system-ui;\n}',
        'system-ui;\n  --space-1: 4px;\n}'
      )
    );
  });

  test('a block without a trailing `;` still takes an insertion', () => {
    const prev = ':root { --a: 1px }\n';
    const m = clone(parse(SINGLE, prev));
    m.tokens['--b'] = { css: '--b', values: { light: '2px' }, data: {}, extra: {} };
    const out = roundTrip(SINGLE, prev, m);
    expect(out).toBe(':root { --a: 1px; --b: 2px; }\n');
  });
});

describe('refusals', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(DsGenerateError);
      return (e as DsGenerateError).code;
    }
    return null;
  };

  test('a theme with no top-level block → ds-generate-block, nothing produced', () => {
    // dark exists only inside @media — never a target (DDR-172 D7)
    const prev = `:root { --a: 1px; }\n@media (min-width: 1px) { .ds[data-theme="dark"] { --a: 2px; } }\n`;
    const m = clone(parse(MX, prev));
    m.tokens['--a'].values.dark = '3px';
    expect(code(() => gen(prev, m, MX))).toBe('ds-generate-block');
  });

  test('a theme the config does not name → ds-generate-block', () => {
    const m = clone(parse(MX, MEDIA_DUP));
    m.tokens['--bg-0'].values.sepia = 'tan';
    expect(code(() => gen(MEDIA_DUP, m, MX))).toBe('ds-generate-block');
  });

  test('a value that would leave its declaration → ds-generate-value', () => {
    for (const bad of [
      'red; } body { background: url(x) } .y {',
      'red;',
      'a\nb',
      'red /* x',
      'red */',
      '"open',
      'calc(1px',
      'x y',
      'x‮y',
      '',
      'a'.repeat(2001),
    ]) {
      const m = clone(parse(MX, MEDIA_DUP));
      m.tokens['--bg-0'].values.dark = bad;
      expect(code(() => gen(MEDIA_DUP, m, MX))).toBe('ds-generate-value');
    }
  });

  test('a bad css name or root class → ds-generate-value', () => {
    const m = clone(parse(MX, MEDIA_DUP));
    m.tokens['--x;y'] = { css: '--x;y', values: { light: '1px' }, data: {}, extra: {} };
    expect(code(() => gen(MEDIA_DUP, m, MX))).toBe('ds-generate-value');
    expect(code(() => gen(null, parse(MX, MEDIA_DUP), { ...MX, rootClass: 'a{b' }))).toBe(
      'ds-generate-value'
    );
  });
});

describe('fresh generation (a system made on the canvas)', () => {
  const model: TokenModel = {
    system: 'studio-site',
    themes: ['light', 'dark'],
    defaultTheme: 'light',
    rootClass: 'studio-site',
    colorSpace: 'oklch',
    meta: { label: 'Studio site system' },
    extra: {},
    tokens: {
      '--accent': {
        css: '--accent',
        values: { light: 'oklch(0.50 0.190 255)', dark: 'oklch(0.60 0.175 255)' },
        data: { label: 'Accent' },
        extra: {},
      },
      '--radius-md': {
        css: '--radius-md',
        values: { light: '10px', dark: '10px' },
        data: {},
        extra: {},
      },
      '--dur-fast': {
        css: '--dur-fast',
        values: { light: '120ms', dark: '120ms' },
        data: {},
        extra: {},
      },
      '--dur-signature-pop': {
        css: '--dur-signature-pop',
        values: { light: '480ms', dark: '480ms' },
        data: {},
        extra: {},
      },
    },
  };
  const cfg: GenConfig = {
    name: 'studio-site',
    rootClass: 'studio-site',
    themes: ['light', 'dark'],
    defaultTheme: 'light',
    colorSpace: 'oklch',
  };

  test('byte-stable output: one block per theme, the invariant block, reduced motion', () => {
    const out = gen(null, model, cfg);
    expect(out).toBe(`/* Design tokens — generated by Maude from the Design system canvas. */

:root,
.studio-site[data-theme="light"],
.ds[data-theme="light"] {
  --accent: oklch(0.50 0.190 255);
}

.studio-site[data-theme="dark"],
.ds[data-theme="dark"] {
  --accent: oklch(0.60 0.175 255);
}

:root,
.studio-site[data-theme="light"],
.ds[data-theme="light"],
.studio-site[data-theme="dark"],
.ds[data-theme="dark"] {
  --dur-fast: 120ms;
  --dur-signature-pop: 480ms;
  --radius-md: 10px;
}

@media (prefers-reduced-motion: reduce) {
  :root,
  .studio-site[data-theme="light"],
  .ds[data-theme="light"],
  .studio-site[data-theme="dark"],
  .ds[data-theme="dark"] {
    --dur-fast: 1ms;
    --dur-signature-pop: 1ms;
  }
}
`);
    expect(gen(null, model, cfg)).toBe(out);
    roundTrip(cfg, null, model);
  });

  test('labels never reach the CSS (they are data, DDR-172 D8)', () => {
    const m = clone(model);
    m.tokens['--accent'].data.label = '*/ body { display: none } /*';
    m.meta.label = '*/ evil';
    expect(gen(null, m, cfg)).not.toContain('evil');
    expect(gen(null, m, cfg)).not.toContain('display: none');
  });
});

describe('emitTokensJson (§5.3 bytes, source canvas)', () => {
  test('deterministic, schema-valid, DTCG refs for exact var()', () => {
    const { cfg, css, json } = realSystem('maude-v2');
    const m = parse(cfg, css, json);
    const a = emitTokensJson(m);
    expect(emitTokensJson(parse(cfg, css, json))).toBe(a);
    expect(a.endsWith('}\n')).toBe(true);
    const doc = JSON.parse(a);
    expect(doc.$extensions['sh.maude'].source).toBe('canvas');
    const v = new Ajv2020({ allErrors: true, strict: true }).compile(
      JSON.parse(readFileSync(join(SCHEMA_DIR, 'ds-tokens-v1.schema.json'), 'utf8'))
    );
    expect(v(doc)).toBe(true);
  });
});

describe('generateComponentsCss (declaration patches)', () => {
  const prev = `/* buttons } */
.btn,
.icon-btn {
  color: var(--fg-0);
  padding: 4px 8px;
}
@media (hover: hover) {
  .btn,
  .icon-btn { color: red; }
}
.card { border: 1px solid var(--border-0) }
`;

  test('no edits → same bytes', () => {
    expect(generateComponentsCss(prev, [])).toBe(prev);
  });

  test('exact selector-list match, top level only; value replaced span-only', () => {
    const out = generateComponentsCss(prev, [
      { selector: '.btn, .icon-btn', property: 'color', value: 'var(--accent)' },
    ]);
    expect(out).toBe(prev.replace('color: var(--fg-0);', 'color: var(--accent);'));
  });

  test('a missing declaration is appended before `}`; a missing rule at the end', () => {
    const out = generateComponentsCss(prev, [
      { selector: '.card', property: 'radius', value: '8px' },
      { selector: '.btn--lg', property: 'padding', value: '8px 16px' },
      { selector: '.btn,.icon-btn', property: 'gap', value: '4px' },
    ]);
    expect(out).toBe(
      prev
        .replace('var(--border-0) }', 'var(--border-0); radius: 8px; }')
        .replace('padding: 4px 8px;\n}', 'padding: 4px 8px;\n  gap: 4px;\n}') +
        '\n.btn--lg {\n  padding: 8px 16px;\n}\n'
    );
  });

  test('a selector that is only a subset of a list does not match', () => {
    const out = generateComponentsCss(prev, [
      { selector: '.btn', property: 'color', value: 'blue' },
    ]);
    expect(out).toBe(`${prev}\n.btn {\n  color: blue;\n}\n`);
  });

  test('a bad selector, property or value → ds-generate-value', () => {
    for (const e of [
      { selector: '.a { } .b', property: 'color', value: 'red' },
      { selector: '.a', property: 'co;lor', value: 'red' },
      { selector: '.a', property: 'color', value: 'red; } * {' },
    ]) {
      let c: string | null = null;
      try {
        generateComponentsCss(prev, [e]);
      } catch (err) {
        c = (err as DsGenerateError).code;
      }
      expect(c).toBe('ds-generate-value');
    }
  });
});
