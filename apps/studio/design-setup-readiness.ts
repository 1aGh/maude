// Design-setup readiness probe (DDR-166 plan, Phase 2 / T6). Backs
// `GET /_api/setup-readiness`.
//
// Distinct from readiness.ts (which probes the AI-EDITING dependency chain —
// claude/maude/plugins on the user's machine). This probes the PROJECT's own
// setup progress: has it moved past the empty scaffold write_minimal_design()
// leaves behind, toward a project with a real design system, a first canvas,
// and brand assets. Read-only, mirrors probeReadiness()'s shape and posture —
// never installs or mutates anything.

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { findHtmlFiles } from './api.ts';
import type { Context } from './context.ts';

export type SetupReadinessStatus = 'present' | 'missing';

export interface SetupReadinessItem {
  id: 'project' | 'design-system' | 'first-canvas' | 'brand-assets';
  label: string;
  status: SetupReadinessStatus;
  detail: string;
}

export interface SetupReadinessReport {
  /** True once every item is `present`. */
  ready: boolean;
  items: SetupReadinessItem[];
}

/** True when `dsDirAbs/preview/` has a `logo.*` specimen (DDR-141 Tier-0). */
function hasLogoSpecimen(dsDirAbs: string): boolean {
  const previewDir = path.join(dsDirAbs, 'preview');
  let entries: string[];
  try {
    entries = readdirSync(previewDir);
  } catch {
    return false;
  }
  return entries.some((f) => /^logo\./i.test(f));
}

/**
 * Side-effect-free. `ctx.cfg` is already schema-clamped (context.ts
 * `clampToDesignRoot`), so every `designSystems[].path`/`tokensCssRel` and
 * `canvasGroups[].path` used here is guaranteed to resolve inside `designRoot`.
 */
export async function probeSetupReadiness(ctx: Context): Promise<SetupReadinessReport> {
  const { cfg, paths } = ctx;
  const items: SetupReadinessItem[] = [];

  // A real, on-disk `.design/config.json` (vs. the in-memory defaults fallback
  // `createContext()` uses when the file is missing/invalid) — the signal that
  // this is a genuinely-initialized project, not just the Rust
  // write_minimal_design() scaffold rendering an empty shell.
  const hasRealConfig = cfg._source === '.design/config.json';
  items.push({
    id: 'project',
    label: 'Project set up',
    status: hasRealConfig ? 'present' : 'missing',
    detail: hasRealConfig
      ? `“${cfg.name}” — a real .design/config.json is on disk.`
      : 'No .design/config.json yet — this is the empty starter scaffold.',
  });

  const designSystems = cfg.designSystems ?? [];
  const dsWithTokens = designSystems.find((ds) => {
    const rel = ds.tokensCssRel ?? path.posix.join(ds.path, 'colors_and_type.css');
    return existsSync(path.join(paths.designRoot, rel));
  });
  items.push({
    id: 'design-system',
    label: 'Design system',
    status: dsWithTokens ? 'present' : 'missing',
    detail: dsWithTokens
      ? `“${dsWithTokens.name}” — tokens are on disk.`
      : designSystems.length
        ? 'Declared in config, but the tokens file is missing.'
        : 'None yet — ask AI to set one up, or bring your own brand.',
  });

  // Any real canvas outside the DS specimen groups (canvasGroups whose path
  // matches /system/i are DS preview specimens, not user canvases).
  const canvasGroups = (cfg.canvasGroups ?? []).filter((g) => !/system/i.test(g.path));
  let firstCanvas: string | null = null;
  for (const g of canvasGroups) {
    const groupAbs = path.join(paths.designRoot, g.path);
    const groupRel = path.posix.join(paths.designRel, g.path);
    const files = await findHtmlFiles(groupAbs, groupRel);
    if (files.length) {
      firstCanvas = files[0];
      break;
    }
  }
  items.push({
    id: 'first-canvas',
    label: 'First canvas',
    status: firstCanvas ? 'present' : 'missing',
    detail: firstCanvas ? `${path.basename(firstCanvas)} is in this project.` : 'No canvas yet.',
  });

  const dsWithLogo = designSystems.find((ds) =>
    hasLogoSpecimen(path.join(paths.designRoot, ds.path))
  );
  items.push({
    id: 'brand-assets',
    label: 'Brand assets',
    status: dsWithLogo ? 'present' : 'missing',
    detail: dsWithLogo
      ? `“${dsWithLogo.name}” has a stored logo specimen.`
      : 'No logo/brand specimen on file yet.',
  });

  return { ready: items.every((i) => i.status === 'present'), items };
}
