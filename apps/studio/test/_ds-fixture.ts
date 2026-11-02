// Fixture systems for the V2-2.15 DS-schema tests: an in-memory DsFs and a generator for a
// fully conformant system built FROM the registry (so the fixture can never drift from it).
import { emitTokensJson } from '../ds/emit.ts';
import { indexRegistry, loadRegistry, type Registry } from '../ds/registry.ts';
import { type DsFs, loadSystem, type SystemConfig } from '../ds/system.ts';

export function memFs(files: Record<string, string>): DsFs {
  return {
    read: (rel) => (Object.hasOwn(files, rel) ? files[rel] : null),
    list: (rel) => {
      const prefix = `${rel.replace(/\/+$/, '')}/`;
      const names = new Set<string>();
      for (const k of Object.keys(files))
        if (k.startsWith(prefix)) names.add(k.slice(prefix.length).split('/')[0]);
      return names.size ? [...names].sort() : null;
    },
  };
}

export function fixtureConfig(over: Partial<SystemConfig> = {}): SystemConfig {
  return {
    name: 'fx',
    path: 'system/fx',
    tokensCssRel: 'system/fx/colors_and_type.css',
    rootClass: 'fx',
    themes: ['light', 'dark'],
    themeDefault: 'light',
    activeFamilies: ['accent', 'status', 'presence'],
    accentStrategy: 'single',
    colorSpace: 'oklch',
    ...over,
  };
}

/** A value of the role's type, structurally valid, deliberately bland. */
export function sampleValue(type: string, name: string, theme: string): string {
  const l = theme === 'dark' ? '0.3' : '0.9';
  switch (type) {
    case 'color':
      return `oklch(${l} 0.01 ${name.length * 7})`;
    case 'length':
    case 'length-or-none':
      return name.startsWith('--space-0') ? '0' : '4px';
    case 'duration':
      return '120ms';
    case 'easing':
      return 'cubic-bezier(0.2, 0, 0, 1)';
    case 'number':
      return '500';
    case 'line-height':
      return '1.4';
    case 'font-family':
      return 'system-ui, sans-serif';
    case 'shadow':
      return '0 1px 2px oklch(0 0 0 / 0.1)';
    default:
      throw new Error(type);
  }
}

/** Every file of a conformant system: tokens CSS, components CSS + JSON, logos, tokens.json. */
export function conformantFiles(
  cfg: SystemConfig = fixtureConfig(),
  reg: Registry = loadRegistry()
): Record<string, string> {
  const perTheme = reg.roles.filter((r) => r.perTheme);
  const invariant = reg.roles.filter((r) => !r.perTheme);
  const block = (theme: string, roles = perTheme) =>
    roles.map((r) => `  ${r.name}: ${sampleValue(r.type, r.name, theme)};`).join('\n');
  const sel = (t: string) =>
    `${t === cfg.themeDefault ? ':root,\n' : ''}.${cfg.rootClass}[data-theme="${t}"],\n.ds[data-theme="${t}"]`;
  const css = [
    ...cfg.themes.map((t) => `${sel(t)} {\n${block(t)}\n}`),
    `${[':root', ...cfg.themes.flatMap((t) => [`.${cfg.rootClass}[data-theme="${t}"]`, `.ds[data-theme="${t}"]`])].join(',\n')} {\n${block(cfg.themeDefault, invariant)}\n}`,
  ].join('\n\n');
  const comps = [
    ...reg.components.core.map((c) => c.fallbackCss ?? `.${c.class} {}`),
    ...reg.typeRoles
      .filter((t) => t.required)
      .map((t) => `.${t.class} { font-family: var(--font-body); }`),
  ].join('\n');
  const components: Record<string, unknown> = {};
  for (const c of reg.components.core) {
    components[c.name] = {
      class: [c.class, ...(c.alsoClasses ?? []).filter((x) => x.startsWith(`${c.class}--`))].join(
        ' '
      ),
      variants: Object.fromEntries((c.variants ?? []).map((v) => [v, `${c.class}--${v}`])),
      sizes: Object.fromEntries((c.sizes ?? []).map((s) => [s, `${c.class}--${s}`])),
    };
  }
  // the fixture CSS only declares variant/size classes that fallbackCss has; null the rest
  const files: Record<string, string> = {
    [cfg.tokensCssRel]: `${css}\n`,
    [`${cfg.path}/preview/_components.css`]: `${comps}\n`,
    [`${cfg.path}/preview/logo.tsx`]: 'export default function Logo() { return null; }\n',
    [`${cfg.path}/assets/logos/mark.svg`]: '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
  };
  const classes = new Set([...comps.matchAll(/\.([a-z][a-z0-9_-]*)/g)].map((m) => m[1]));
  for (const entry of Object.values(components) as {
    class: string;
    variants: Record<string, string | null>;
    sizes: Record<string, string | null>;
  }[]) {
    entry.class = entry.class
      .split(' ')
      .filter((c) => classes.has(c))
      .join(' ');
    for (const k of ['variants', 'sizes'] as const)
      for (const [v, cls] of Object.entries(entry[k]))
        if (cls && !classes.has(cls)) entry[k][v] = null;
  }
  files[`${cfg.path}/components.json`] = `${JSON.stringify(
    {
      schemaVersion: 1,
      system: cfg.name,
      components,
      icons: { family: cfg.name, map: Object.fromEntries(reg.icons.vocabulary.map((n) => [n, n])) },
    },
    null,
    2
  )}\n`;
  const idx = indexRegistry(reg);
  files[`${cfg.path}/tokens.json`] = emitTokensJson(loadSystem(memFs(files), cfg), idx, null);
  return files;
}
