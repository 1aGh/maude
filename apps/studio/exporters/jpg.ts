// jpg.ts — the JPG adapter (S8.1, contract S8-export-spec.md §5.2).
//
// JPG is PNG's capture with Chromium's own JPEG encoder: the same shim, the same scopes
// (format-scopes.ts gives it png's row), the same capture origin (canvasShellUrl → the 307).
// `options.quality` 1–100 (default 85). JPG has no alpha: a transparent background comes out
// white — Chromium's default page background — which is the degradation the sheet names.
// Because it is a registered adapter, the render service (apps/render) runs it too: one
// adapter table serves both lanes.

import type { ExportContext, ExportHooks, ExportOptions, ExportResult } from './index.ts';
import { runRaster } from './png.ts';
import type { Target } from './scope.ts';

export function run(
  targets: Target[],
  options: ExportOptions,
  ctx: ExportContext,
  hooks?: ExportHooks
): Promise<ExportResult> {
  return runRaster('jpeg', targets, options, ctx, hooks);
}
