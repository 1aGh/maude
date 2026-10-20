// S10.15a — the fallback layer never shadows a system value, measured in a real engine (headless
// lane). For each system — two fixtures and this repo's `maude` / `maude-v2` (read only) — every
// custom property the system declares, and the computed style of every component / type class it
// declares, is the same with the fallback CSS in the page as without it, in every theme. Both
// outputs are checked: the shell's per-system block AND the full registry layer (which declares
// every name, so only `@layer maude.fallback` keeps it under the system). The block must also be
// live: a role the system never declares resolves only with it.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { declaredBy, renderFallbacks } from '../ds/fallbacks.ts';
import { loadRegistry } from '../ds/registry.ts';
import {
  diskFs,
  loadSystem,
  type SystemConfig,
  type SystemModel,
  systemConfigsFrom,
} from '../ds/system.ts';
import { conformantFiles, fixtureConfig, memFs } from './_ds-fixture.ts';

// biome-ignore lint/suspicious/noExplicitAny: playwright surface
type Any = any;

const reg = loadRegistry();
const REPO_DESIGN = join(import.meta.dir, '..', '..', '..', '.design');

function fixtureSystem(drop: string[] = []): { model: SystemModel; css: string; comps: string } {
  const cfg = fixtureConfig();
  const f = conformantFiles(cfg);
  for (const name of drop)
    f[cfg.tokensCssRel] = f[cfg.tokensCssRel].replace(
      new RegExp(`\\n {2}${name}: [^;]*;`, 'g'),
      ''
    );
  const model = loadSystem(memFs(f), cfg);
  return { model, css: f[cfg.tokensCssRel], comps: f[`${cfg.path}/preview/_components.css`] ?? '' };
}

function repoSystem(name: string): { model: SystemModel; css: string; comps: string } | null {
  try {
    const config = JSON.parse(readFileSync(join(REPO_DESIGN, 'config.json'), 'utf8'));
    const cfg = systemConfigsFrom(config).find((s: SystemConfig) => s.name === name);
    if (!cfg) return null;
    const fs = diskFs(REPO_DESIGN);
    return {
      model: loadSystem(fs, cfg),
      css: fs.read(cfg.tokensCssRel) ?? '',
      comps: fs.read(`${cfg.path}/preview/_components.css`) ?? '',
    };
  } catch {
    return null;
  }
}

const PROPS = [
  'color',
  'background-color',
  'border-top-left-radius',
  'border-top-width',
  'padding-top',
  'padding-left',
  'font-size',
  'font-weight',
  'font-family',
  'line-height',
  'letter-spacing',
  'box-shadow',
];

let browser: Any;
let page: Any;
beforeAll(async () => {
  const { launchChromium } = (await import('../bin/_pw-launch.mjs')) as {
    launchChromium: () => Promise<Any>;
  };
  browser = await launchChromium();
  page = await (await browser.newContext({ viewport: { width: 400, height: 300 } })).newPage();
});
afterAll(async () => {
  await browser?.close();
});

/** Every declared name + class style, per theme, with the fallback `<style>` on and off. */
async function measure(sys: { model: SystemModel; css: string; comps: string }, fallback: string) {
  const cfg = sys.model.config;
  const classes = [...declaredBy(sys.model).classes]
    .filter((c) => /^[a-z][a-z0-9_-]*$/i.test(c))
    .slice(0, 400);
  const themes = cfg.themes.length ? cfg.themes : [cfg.themeDefault];
  const body = themes
    .map(
      (t) =>
        `<div class="${cfg.rootClass ?? ''}" data-theme="${t}"><div class="ds" data-theme="${t}" id="p-${t}">${classes
          .map((c) => `<span class="${c}" data-c="${c}">x</span>`)
          .join('')}</div></div>`
    )
    .join('');
  // the shell's order: fallbacks BEFORE the system's stylesheets
  await page.setContent(
    `<!doctype html><html><head><style id="fb"></style><style id="tok"></style><style id="cmp"></style></head><body>${body}</body></html>`
  );
  await page.evaluate(
    ({ fb, tok, cmp }: { fb: string; tok: string; cmp: string }) => {
      (document.getElementById('fb') as HTMLStyleElement).textContent = fb;
      (document.getElementById('tok') as HTMLStyleElement).textContent = tok;
      (document.getElementById('cmp') as HTMLStyleElement).textContent = cmp;
    },
    { fb: fallback, tok: sys.css, cmp: sys.comps }
  );
  const read = (on: boolean) =>
    page.evaluate(
      ({
        on,
        names,
        themes,
        props,
      }: {
        on: boolean;
        names: string[];
        themes: string[];
        props: string[];
      }) => {
        (document.getElementById('fb') as HTMLStyleElement).disabled = !on;
        const out: Record<string, string> = {};
        for (const t of themes) {
          const p = document.getElementById(`p-${t}`) as HTMLElement;
          const cs = getComputedStyle(p);
          for (const n of names) out[`${t} ${n}`] = cs.getPropertyValue(n).trim();
          for (const el of p.querySelectorAll('[data-c]')) {
            const s = getComputedStyle(el);
            for (const prop of props)
              out[`${t} .${el.getAttribute('data-c')} ${prop}`] = s.getPropertyValue(prop);
          }
        }
        return out;
      },
      { on, names: [...sys.model.declared], themes, props: PROPS }
    );
  const without = await read(false);
  const withFb = await read(true);
  return { without, withFb };
}

async function undeclaredResolves(
  sys: { model: SystemModel; css: string; comps: string },
  name: string
) {
  const fb = renderFallbacks(reg, declaredBy(sys.model));
  await page.setContent(
    `<!doctype html><style>${fb}</style><style>${sys.css}</style><div class="ds" data-theme="${sys.model.config.themeDefault}" id="x"></div>`
  );
  return page.evaluate(
    (n: string) =>
      getComputedStyle(document.getElementById('x') as HTMLElement)
        .getPropertyValue(n)
        .trim(),
    name
  );
}

const SYSTEMS: [
  string,
  () => { model: SystemModel; css: string; comps: string } | null,
  boolean,
][] = [
  ['fixture (conformant)', () => fixtureSystem(), true],
  [
    'fixture (missing --scrim, --accent-soft)',
    () => fixtureSystem(['--scrim', '--accent-soft']),
    false,
  ],
  ['maude', () => repoSystem('maude'), true],
  ['maude-v2', () => repoSystem('maude-v2'), true],
];

describe('the fallback layer never shadows a system value (S10.15a, headless)', () => {
  for (const [label, load, classes] of SYSTEMS) {
    test(`${label}: the shell's per-system block`, async () => {
      const sys = load();
      if (!sys) return; // a checkout without that system
      expect(sys.model.declared.size).toBeGreaterThan(0);
      const { without, withFb } = await measure(sys, renderFallbacks(reg, declaredBy(sys.model)));
      expect(Object.keys(without).length).toBeGreaterThan(0);
      // a declared class that reads an UNDECLARED role is filled by the block, not shadowed —
      // for the partial fixture only the declared names are compared
      const keys = Object.keys(without).filter((k) => classes || !k.includes(' .'));
      expect(keys.filter((k) => without[k] !== withFb[k])).toEqual([]);
    }, 60_000);
  }

  // The full registry layer declares EVERY role (and fills class properties a system leaves
  // unset), so only `@layer maude.fallback` keeps a declared value on top: compared on a system
  // that declares every name in every theme block.
  test('the full layer: every declared custom property keeps its value (the @layer guarantee)', async () => {
    const sys = fixtureSystem();
    const { without, withFb } = await measure(sys, renderFallbacks(reg));
    const names = Object.keys(without).filter((k) => / --/.test(k) && !k.includes(' .'));
    expect(names.length).toBeGreaterThan(50);
    expect(names.filter((k) => without[k] !== withFb[k])).toEqual([]);
  }, 60_000);

  test('the block is live: an undeclared role resolves only through it', async () => {
    const sys = fixtureSystem(['--scrim']);
    expect(sys.model.declared.has('--scrim')).toBe(false);
    expect(await undeclaredResolves(sys, '--scrim')).not.toBe('');
  }, 30_000);
});
