// Read one design system into the model the checker, the emitter and the fallback generator
// share (V2-1.13 §5.3.2 theme rule, §5.5 `declaredBy`). File access goes through `DsFs` so
// the migrator (V2-2.14) and tests can feed bytes without a real tree.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type CssRule, ownCustomProperties, scanCssRules, splitSelectorList } from './css-scan.ts';

/** designRoot-relative file access. */
export interface DsFs {
  read(rel: string): string | null;
  /** entries of a directory (names only), or null when absent */
  list(rel: string): string[] | null;
}

export function diskFs(designRootAbs: string): DsFs {
  return {
    read(rel) {
      try {
        const p = join(designRootAbs, rel);
        if (!statSync(p).isFile()) return null;
        return readFileSync(p, 'utf8');
      } catch {
        return null;
      }
    },
    list(rel) {
      try {
        const p = join(designRootAbs, rel);
        if (!existsSync(p) || !statSync(p).isDirectory()) return null;
        return readdirSync(p).sort();
      } catch {
        return null;
      }
    },
  };
}

export interface SystemConfig {
  name: string;
  /** designRoot-relative folder */
  path: string;
  tokensCssRel: string;
  rootClass: string | null;
  themes: string[];
  themeDefault: string;
  /** project-level */
  activeFamilies: string[];
  accentStrategy: string;
  colorSpace: string | null;
  schema?: number;
}

export interface Declaration {
  name: string;
  value: string;
  /** index into `rules` */
  rule: number;
  /** themes this declaration's rule covers (empty = a counted rule that covers no theme) */
  themes: string[];
  /** true when the rule sits inside @layer */
  layered: boolean;
  valueStart: number;
  valueEnd: number;
  declStart: number;
  declEnd: number;
}

export interface ThemeRuleInfo {
  rule: number;
  selectors: string[];
  themes: string[];
  /** themes whose `.<rootClass>[data-theme=t]` selector has no `.ds[data-theme=t]` sibling */
  missingDsScope: string[];
}

export interface SystemModel {
  config: SystemConfig;
  css: string | null;
  rules: CssRule[];
  /** declarations in counted rules (top-level or @layer; never @media/@supports/@container) */
  decls: Declaration[];
  byName: Map<string, Declaration[]>;
  /** every custom-property name declared in a counted rule (`declaredBy`, §5.5) */
  declared: Set<string>;
  themeRules: ThemeRuleInfo[];
  componentsCss: string | null;
  /** class names that appear in a selector of preview/_components.css */
  componentClasses: Set<string>;
  /** class names that appear in a selector of the tokens CSS */
  tokensClasses: Set<string>;
  componentsJson: { raw: string | null; data: unknown; parseError: string | null };
  tokensJson: string | null;
  converted: boolean;
  logos: string[];
  logoSpecimens: string[];
}

const THEME_ATTR_RE = /\[\s*data-theme\s*=\s*(["'])([^"']+)\1\s*\]/;

/** Which theme a single selector covers under the §5.3.2 rule, or null. */
export function selectorTheme(
  sel: string,
  cfg: Pick<SystemConfig, 'rootClass' | 'themeDefault'>
): { theme: string; via: 'root' | 'ds' | 'rootClass' } | null {
  const s = sel.trim();
  if (s === ':root') return { theme: cfg.themeDefault, via: 'root' };
  const m = /^\.([A-Za-z0-9_-]+)\s*(\[[^\]]+\])$/.exec(s);
  if (!m) return null;
  const t = THEME_ATTR_RE.exec(m[2]);
  if (!t) return null;
  if (m[1] === 'ds') return { theme: t[2], via: 'ds' };
  if (cfg.rootClass && m[1] === cfg.rootClass) return { theme: t[2], via: 'rootClass' };
  return null;
}

function isCountedRule(r: CssRule): boolean {
  if (r.atRule) return false;
  return r.atRuleChain.every((a) => a === 'layer');
}

/** Class names appearing anywhere in the selectors of `css` (counted or not). */
export function selectorClasses(css: string | null): Set<string> {
  const out = new Set<string>();
  if (!css) return out;
  for (const r of scanCssRules(css)) {
    if (r.atRule) continue;
    const sel = r.selector.replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const m of sel.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) out.add(m[1]);
  }
  return out;
}

export function loadSystem(fs: DsFs, cfg: SystemConfig): SystemModel {
  const css = fs.read(cfg.tokensCssRel);
  const rules = css ? scanCssRules(css) : [];
  const decls: Declaration[] = [];
  const themeRules: ThemeRuleInfo[] = [];
  if (css) {
    rules.forEach((r, i) => {
      if (!isCountedRule(r)) return;
      const selectors = splitSelectorList(r.selector);
      const themes = new Set<string>();
      const viaRootClass = new Set<string>();
      const viaDs = new Set<string>();
      for (const s of selectors) {
        const t = selectorTheme(s, cfg);
        if (!t) continue;
        themes.add(t.theme);
        if (t.via === 'rootClass') viaRootClass.add(t.theme);
        if (t.via === 'ds') viaDs.add(t.theme);
      }
      const own = ownCustomProperties(css, rules, i);
      if (themes.size) {
        themeRules.push({
          rule: i,
          selectors,
          themes: [...themes],
          missingDsScope: [...viaRootClass].filter((t) => !viaDs.has(t)),
        });
      }
      for (const d of own) {
        decls.push({
          name: d.name,
          value: d.rawValue,
          rule: i,
          themes: [...themes],
          layered: r.atRuleChain.includes('layer'),
          valueStart: d.valueStart,
          valueEnd: d.valueEnd,
          declStart: d.declStart,
          declEnd: d.declEnd,
        });
      }
    });
  }
  const byName = new Map<string, Declaration[]>();
  for (const d of decls) {
    const list = byName.get(d.name) ?? [];
    list.push(d);
    byName.set(d.name, list);
  }
  const componentsCss = fs.read(`${cfg.path}/preview/_components.css`);
  const rawComponents = fs.read(`${cfg.path}/components.json`);
  let data: unknown = null;
  let parseError: string | null = null;
  if (rawComponents !== null) {
    try {
      data = JSON.parse(rawComponents);
    } catch (e) {
      parseError = (e as Error).message;
    }
  }
  const preview = fs.list(`${cfg.path}/preview`) ?? [];
  return {
    config: cfg,
    css,
    rules,
    decls,
    byName,
    declared: new Set(byName.keys()),
    themeRules,
    componentsCss,
    componentClasses: selectorClasses(componentsCss),
    tokensClasses: selectorClasses(css),
    componentsJson: { raw: rawComponents, data, parseError },
    tokensJson: fs.read(`${cfg.path}/tokens.json`),
    converted: fs.read(`${cfg.path}/revisions/head.json`) !== null,
    logos: (fs.list(`${cfg.path}/assets/logos`) ?? []).filter((n) => !n.startsWith('.')),
    logoSpecimens: preview.filter((n) => /^logo\.[A-Za-z0-9]+$/.test(n)),
  };
}

/**
 * The declaration that defines `name` for `theme`: the last one in a counted rule covering
 * that theme (source order = cascade order at equal specificity), else null. Inheritance
 * never counts (§5.3.2).
 */
export function declFor(model: SystemModel, name: string, theme: string): Declaration | null {
  const list = model.byName.get(name);
  if (!list) return null;
  let hit: Declaration | null = null;
  for (const d of list) if (d.themes.includes(theme)) hit = d;
  return hit;
}

/** System config entries from `.design/config.json` (+ project-level knobs). */
export function systemConfigsFrom(config: Record<string, unknown>): SystemConfig[] {
  const list = Array.isArray(config.designSystems) ? config.designSystems : [];
  const activeFamilies = Array.isArray(config.activeFamilies)
    ? (config.activeFamilies as string[])
    : ['accent'];
  const accentStrategy =
    typeof config.accentStrategy === 'string' ? config.accentStrategy : 'single';
  const colorSpace = typeof config.colorSpace === 'string' ? config.colorSpace : null;
  const out: SystemConfig[] = [];
  for (const e of list as Record<string, unknown>[]) {
    if (!e || typeof e.name !== 'string' || typeof e.path !== 'string') continue;
    const path = e.path.replace(/\/+$/, '');
    const themes =
      Array.isArray(e.themes) && e.themes.length
        ? (e.themes as string[])
        : typeof e.themeDefault === 'string'
          ? [e.themeDefault]
          : ['light'];
    out.push({
      name: e.name,
      path,
      tokensCssRel:
        typeof e.tokensCssRel === 'string' ? e.tokensCssRel : `${path}/colors_and_type.css`,
      rootClass:
        typeof e.rootClass === 'string'
          ? e.rootClass
          : typeof config.rootClass === 'string'
            ? (config.rootClass as string)
            : null,
      themes,
      themeDefault: typeof e.themeDefault === 'string' ? e.themeDefault : themes[0],
      activeFamilies,
      accentStrategy,
      colorSpace,
      schema: typeof e.schema === 'number' ? e.schema : undefined,
    });
  }
  return out;
}
