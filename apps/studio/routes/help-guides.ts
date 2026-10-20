// Help › Help and guides › "Add the guide canvases to this project" — S6.15 (Q10, contract
// S6-slices § S6.15). A new project starts empty; `POST /_api/help/add-guides` writes the two guide
// canvases (How to use Maude, How to make video — the same template strings the old scaffold
// seeded) into the project's UI folder, skipping any whose file is already there.
//
// MAIN ORIGIN ONLY and refused to a read-only session: it adds canvases to the project, so the
// local access gate holds it to Can edit and up, the hub manifest says `edit` (a cell refuses
// below that), and a canvas-only session never gets a 2xx (project scope). The new files join
// the project the way a created canvas does — observed on disk (writer registry: file-plane).
// No body is read: the route names no path, so there is nothing to traverse.

import { addGuideCanvases } from '../scaffold-design.ts';
import type { RouteSpec } from './table.ts';

export interface HelpGuidesDeps {
  /** the absolute UI folder new canvases go to (`<designRoot>/<newCanvasDir>`) */
  uiDir: () => string;
}

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export function createHelpGuidesRoutes(deps: HelpGuidesDeps): RouteSpec[] {
  return [
    {
      method: 'POST',
      path: '/_api/help/add-guides',
      origin: 'main',
      readOnly: 'refused',
      handle: () => {
        const r = addGuideCanvases(deps.uiDir());
        if (!r.ok) return json(500, { error: 'Could not add the guides.', code: 'write-failed' });
        return json(200, { ok: true, added: r.added, skipped: r.skipped });
      },
    },
  ];
}
