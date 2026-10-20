// Artboard-kind routes — S7.20 (decision maude/v2-S7.20-one-preset-catalogue).
//
// `GET /_api/kinds/presets?file=<canvas>` → `{ groups, custom, recent, kinds }`: the ONE preset catalogue
// (kinds/presets.ts) the F size picker draws, with the person's Recent chips (`recentSizes` in prefs.json, per Mac).
// The shell reads it; the write that follows is `artboard.insert-preset` through `/_api/edit-op` (minRole edit,
// judged there), and a pick is remembered with `PATCH /_api/ui-prefs { recentSizes }`.
//
//   - MINIMUM ROLE EDIT: the list exists to ADD an artboard to a canvas, so a viewer and a Can comment session
//     are refused here, not merely shown no panel (the way `GET /_api/ds/components` is);
//   - MAIN ORIGIN ONLY (`origin: 'main'`): in neither canvas allowlist, so the untrusted canvas origin answers 403 —
//     the canvas asks the shell to open the picker (`tool-panel-open`), it never fetches the list;
//   - READ-ONLY: writes nothing.

import type { Access } from '../access/scope.ts';
import {
  CUSTOM_PRINT_TILE,
  KIND_WORD,
  PRESET_GROUPS,
  type Preset,
  recentPresets,
} from '../kinds/presets.ts';
import { readUiPrefs } from '../ui-prefs.ts';
import { resolveCanvasRel } from './edit.ts';
import type { RouteSpec } from './table.ts';

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface KindRouteDeps {
  designRoot: string;
  /** the design root relative to the repo root (`.design`) */
  designRel: string;
  /** the session's access (http.ts `accessOf`); absent = nobody may list (fail closed) */
  access?: (req: Request) => Access;
  /** tests only: the Recent ids instead of prefs.json */
  recentIds?: () => unknown;
}

/** What a tile needs, nothing it does not (no aliases, no paper internals). */
const tile = (p: Preset) => ({
  id: p.id,
  name: p.name,
  label: p.label,
  kind: p.kind,
  sizeText: p.sizeText,
  widthPx: p.widthPx,
  heightPx: p.heightPx,
  top: p.top,
});

export function createKindRoutes(deps: KindRouteDeps): RouteSpec[] {
  return [
    {
      method: 'GET',
      path: '/_api/kinds/presets',
      origin: 'main',
      readOnly: 'allowed',
      handle: (req) => {
        const file = new URL(req.url).searchParams.get('file');
        const rel = file ? resolveCanvasRel(deps.designRoot, deps.designRel, file) : null;
        const access = deps.access?.(req);
        if (!access?.can('edit', rel))
          return json(403, {
            ok: false,
            code: 'forbidden',
            message: 'Only people who can edit can add artboards.',
          });
        const ids = deps.recentIds ? deps.recentIds() : readUiPrefs().recentSizes;
        return json(200, {
          kinds: KIND_WORD,
          groups: PRESET_GROUPS.map((g) => ({
            id: g.id,
            kind: g.kind,
            title: g.title,
            icon: g.icon,
            badge: g.badge,
            presets: g.presets.map(tile),
          })),
          custom: CUSTOM_PRINT_TILE,
          recent: recentPresets(ids).map(tile),
        });
      },
    },
  ];
}
