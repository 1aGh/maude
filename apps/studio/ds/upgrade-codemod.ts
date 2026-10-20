// "Bring it up to the schema" — the canvas half (V2-1.13 §5.10, S10.15a): one `canvas-codemod`
// plan item per canvas of the system, applied on the staged `after/` copy only.
//
// The edits are exactly ds-check's three mechanical kinds (`fixCanvas`: a native alias → its v1
// name, an own-CSS self-import removed, the wrapper class token → `ds`), computed against the
// system AFTER its own half is applied, so every alias a canvas still uses is already declared as
// `--native: var(--v1)` and the rewrite is invisible (the visual gate proves it).
//
//   Q2  `ui/v2/**` is never codemodded during the run (the spec canvases' ledger hashes).
//   V6  a codemod changes only `var()` names, `className` tokens and import lines (and meta keys);
//       element ids and `data-cd-id` survive. A breach refuses that canvas, not the run.
//   V7  a canvas left out at an older revision (`dsRev`) or pinned (`dsPinned`, `opt_out_scope:
//       full`) gets no codemod: its frozen revision still defines the native names.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CanvasContext, checkCanvas, fixCanvas } from './canvas-check.ts';
import { listCanvases } from './canvas-cli.ts';
import type { PlanItem } from './upgrade.ts';

/** Q2 (decision `v2-S10-no-ui-v2-codemod-during-run`): the spec canvases stay byte-identical. */
export const CODEMOD_EXCLUDED = /^ui\/v2(?:\/|$)/;

export type SkipReason = 'ui-v2' | 'left-out' | 'pinned' | 'blocked';

export interface CanvasCodemod {
  /** design-root-relative canvas path */
  path: string;
  files: { rel: string; before: string; after: string }[];
  edits: Record<string, number>;
}

export interface CodemodPlan {
  items: PlanItem[];
  codemods: CanvasCodemod[];
  skipped: { path: string; reason: SkipReason }[];
  refused: { path: string; invariant: 'V6'; detail: string }[];
}

function readMeta(designRoot: string, rel: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(
      readFileSync(join(designRoot, rel.replace(/\.tsx$/, '.meta.json')), 'utf8')
    );
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const NAME = /--[A-Za-z0-9_-]+/g;
const IMPORT_LINE = /^[ \t]*@?import\b[^\n]*(?:\n|$)/gm;
const CLASS_ATTR = /\bclassName=(?:"[^"]*"|'[^']*'|\{\s*(?:"[^"]*"|'[^']*'|`[^`$]*`)\s*\})/g;
const IDS = /\b(?:id|data-cd-id)=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g;

const mask = (s: string) =>
  s.replace(IMPORT_LINE, '').replace(CLASS_ATTR, 'className=§').replace(NAME, '--§');

/** V6 for one file: null when the edit stayed inside var names, className tokens and imports. */
export function checkV6(before: string, after: string): string | null {
  const ids = (s: string) => (s.match(IDS) ?? []).join('\n');
  if (ids(before) !== ids(after)) return 'an element id or data-cd-id changed';
  if (mask(before) !== mask(after))
    return 'the edit reaches beyond var() names, className tokens and import lines';
  return null;
}

/** Why a canvas gets no codemod (Q2, V7, a blocked canvas), or null. */
export function codemodSkip(designRoot: string, rel: string, state: string): SkipReason | null {
  if (CODEMOD_EXCLUDED.test(rel)) return 'ui-v2';
  const meta = readMeta(designRoot, rel);
  if (meta && typeof meta.dsRev === 'string' && meta.dsRev) return 'left-out';
  if (state === 'pinned' || meta?.dsPinned === true || meta?.opt_out_scope === 'full')
    return 'pinned';
  if (state === 'blocked') return 'blocked';
  return null;
}

/**
 * The canvas codemods of system `ds`, read from `ctx` (a context over the staged `after/` tree,
 * where the system half is already applied). Pure over the files: nothing is written here.
 */
export function planCanvasCodemods(ctx: CanvasContext, ds: string): CodemodPlan {
  const out: CodemodPlan = { items: [], codemods: [], skipped: [], refused: [] };
  for (const rel of listCanvases(ctx.designRoot)) {
    const report = checkCanvas(ctx, rel);
    if (report.system !== ds) continue;
    const skip = codemodSkip(ctx.designRoot, rel, report.state);
    if (skip) {
      out.skipped.push({ path: rel, reason: skip });
      continue;
    }
    const fixed = fixCanvas(ctx, report);
    const files = [...fixed]
      .filter(([, f]) => f.after !== f.before)
      .map(([file, f]) => ({ rel: file, before: f.before, after: f.after }));
    if (!files.length) continue;
    const breach = files.map((f) => checkV6(f.before, f.after)).find(Boolean);
    if (breach) {
      out.refused.push({ path: rel, invariant: 'V6', detail: breach });
      continue;
    }
    const edits: Record<string, number> = {};
    const seen = new Set<string>();
    for (const f of report.findings) {
      if (f.severity !== 'autofix' || !f.span) continue;
      const key = `${f.file}:${f.span[0]}:${f.span[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edits[f.kind] = (edits[f.kind] ?? 0) + 1;
    }
    out.codemods.push({ path: rel, files, edits });
    out.items.push({ id: `canvas:${rel}`, kind: 'canvas-codemod', status: 'mechanical', edits });
  }
  return out;
}
