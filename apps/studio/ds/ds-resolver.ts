// `@maude/ds` — the per-canvas design-system module (V2-1.13 §5.11, lead decision B).
//
// A canvas's `import { Button } from '@maude/ds'` resolves, per canvas build, to a generated
// module that (1) registers the canvas's system with canvas-lib (`__registerDesignSystem`, so
// `<DSRoot>` knows the default theme in every render path) and (2) re-exports the system's
// `preview/_ds.tsx` override when it exists, else the shipped defaults
// (`ds/default-components.tsx`). A missing export fails the build loud.
//
// The canvas's system follows the studio's own rule (api.ts canvasDesignSystems): a path under
// `system/<ds>/` owns it, else `meta.designSystem`, else the project default.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { BunPlugin } from 'bun';
import { DEV_SERVER_ROOT } from '../paths.ts';
import { type SystemConfig, systemConfigsFrom } from './system.ts';

export const DS_SPECIFIER = '@maude/ds';
const DS_IMPORT_RE = /\bfrom\s*["']@maude\/ds["']|\bimport\s*\(\s*["']@maude\/ds["']\s*\)/;

export const defaultComponentsPath = (): string =>
  path.join(DEV_SERVER_ROOT, 'ds', 'default-components.tsx');

export function importsDs(source: string): boolean {
  return DS_IMPORT_RE.test(source);
}

function readJson(abs: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(readFileSync(abs, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const metaPathFor = (canvasAbs: string) => canvasAbs.replace(/\.tsx$/, '.meta.json');

/** The design system a canvas renders under, or null when the project declares none. */
export function canvasSystemFor(designRoot: string, canvasAbs: string): SystemConfig | null {
  const systems = systemConfigsFrom(readJson(path.join(designRoot, 'config.json')) ?? {});
  if (!systems.length) return null;
  const rel = path.relative(designRoot, canvasAbs).split(path.sep).join('/');
  const owner = systems.find((s) => rel.startsWith(`${s.path}/`));
  if (owner) return owner;
  const declared = readJson(metaPathFor(canvasAbs))?.designSystem;
  const byMeta = typeof declared === 'string' ? systems.find((s) => s.name === declared) : null;
  if (byMeta) return byMeta;
  const config = readJson(path.join(designRoot, 'config.json')) ?? {};
  const def = typeof config.defaultDesignSystem === 'string' ? config.defaultDesignSystem : null;
  return systems.find((s) => s.name === def) ?? systems[0];
}

const overridePath = (designRoot: string, sys: SystemConfig) =>
  path.join(designRoot, sys.path, 'preview', '_ds.tsx');

/** The module `@maude/ds` re-exports for this system. */
export function dsTargetFor(designRoot: string, sys: SystemConfig | null): string {
  if (sys) {
    const own = overridePath(designRoot, sys);
    if (existsSync(own)) return own;
  }
  return defaultComponentsPath();
}

/** The registration statement the generated module (and the handoff inline) runs. */
export function registrationCall(sys: SystemConfig | null): string {
  if (!sys) return '';
  return `__registerDesignSystem({ name: ${JSON.stringify(sys.name)}, themeDefault: ${JSON.stringify(sys.themeDefault)} });`;
}

export function dsModuleSource(designRoot: string, canvasAbs: string): string {
  const sys = canvasSystemFor(designRoot, canvasAbs);
  const target = dsTargetFor(designRoot, sys);
  return [
    ...(sys
      ? ['import { __registerDesignSystem } from "@maude/canvas-lib";', registrationCall(sys)]
      : []),
    `export * from ${JSON.stringify(target)};`,
    '',
  ].join('\n');
}

/**
 * Bun.build plugin: `@maude/ds` → the generated module for THIS canvas. The virtual path sits
 * under the dev-server root, so the import allowlist treats its imports as ours (the override
 * it re-exports is inside the design root and checked as tenant code from there on).
 */
export function dsResolver(designRoot: string, canvasAbs: string): BunPlugin {
  const sys = canvasSystemFor(designRoot, canvasAbs);
  const virtual = path.join(
    DEV_SERVER_ROOT,
    'ds',
    '__maude-ds__',
    `${encodeURIComponent(sys?.name ?? '_')}.tsx`
  );
  const exact = new RegExp(`^${virtual.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  return {
    name: 'maude-ds',
    setup(builder) {
      builder.onResolve({ filter: /^@maude\/ds$/ }, () => ({ path: virtual }));
      builder.onLoad({ filter: exact }, () => ({
        contents: dsModuleSource(designRoot, canvasAbs),
        loader: 'tsx',
      }));
    },
  };
}

/**
 * P-11 — what a canvas that imports `@maude/ds` also depends on, for the module cache: its
 * `.meta.json` (the system can change there), `config.json` (systems and defaults) and the
 * system's `preview/_ds.tsx` override (present or not — appearing is a change too).
 */
export function dsDepsFor(source: string, canvasAbs: string, designRoot: string): string[] {
  if (!importsDs(source)) return [];
  const deps = [metaPathFor(canvasAbs), path.join(designRoot, 'config.json')];
  const sys = canvasSystemFor(designRoot, canvasAbs);
  if (sys) deps.push(overridePath(designRoot, sys));
  return deps;
}
