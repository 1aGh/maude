// Pins — V2-1.1 §5.5 (V2-3.3). The project server's half of `_canvas-state/_pins.json`; the Home
// server writes the same file through the same module (home/user-state.ts) for a project whose
// server is not running.
//
// MAIN ORIGIN ONLY: a pin is a person's own view state, and the canvas iframe has no business
// changing it. Allowed in a read-only session (a viewer pins too — it is DDR-115 runtime state, the
// same class as /_api/ui-prefs), refused in a cell (one shared `_canvas-state/` for many people).

import { lstatSync } from 'node:fs';
import path from 'node:path';

import { isCanvasKey, readPins, setPin } from '../home/user-state.ts';
import type { RouteSpec } from './table.ts';

const MAX_BODY = 8 * 1024;
const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface PinsRouteDeps {
  designRoot: string;
}

export function createPinsRoutes(deps: PinsRouteDeps): RouteSpec[] {
  return [
    {
      method: 'GET',
      path: '/_api/pins',
      origin: 'main',
      readOnly: 'allowed',
      handle: () => json(200, readPins(deps.designRoot)),
    },
    {
      method: 'POST',
      path: '/_api/pins',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        if (Number(req.headers.get('content-length')) > MAX_BODY)
          return json(413, { error: 'too-large' });
        const text = await req.text();
        if (text.length > MAX_BODY) return json(413, { error: 'too-large' });
        let body: { canvas?: unknown; pinned?: unknown };
        try {
          body = JSON.parse(text) ?? {};
        } catch {
          return json(400, { error: 'bad-json' });
        }
        if (!isCanvasKey(body.canvas) || typeof body.pinned !== 'boolean')
          return json(400, { error: 'bad-pin' });
        if (body.pinned) {
          let isFile = false;
          try {
            isFile = lstatSync(path.join(deps.designRoot, body.canvas)).isFile();
          } catch {
            /* not there */
          }
          if (!isFile) return json(404, { error: 'no-such-canvas' });
        }
        return json(200, { ok: true, ...setPin(deps.designRoot, body.canvas, body.pinned) });
      },
    },
  ];
}
