// p8-c4b — the canvases this hub's stores name, for the closure's canvas test.
//
// gate-b-c4k: a `.tsx` is a canvas iff it renders DesignCanvas, or has a meta / a board / a hub
// doc / a stored grant. Without the last signal an OLD canvas (no meta, no board, no DesignCanvas)
// was "a helper": a canvas importing it carried it into the importer's closure — its source read by
// a session granted only the importer, and inlined into the importer's frame. A grant names a
// canvas (nobody shares a component), so every canvas any stored grant names is one: an account's
// canvas-only claim (users.mjs), an invite's (invites.mjs), a minted session's (tokens.mjs — a
// cloud cell's canvas-only sessions live only here). Erring to "canvas" only ever refuses an import.
//
// The hub's own file plane asks `storedGrantCanvases` through `registerKnownCanvases`
// (access-files.mjs). A cell's studio child gets the same list through a file in the HUB's data
// dir (never the tenant's checkout, DDR-054 — the `project-format.json` precedent), named by
// `MAUDE_HUB_KNOWN_CANVASES_FILE`; `createKnownCanvasesFile().refresh()` rewrites it (atomic
// rename, only on a change) before the hub forwards a request to the child, so a grant made a
// moment ago counts on the next request.

import { randomBytes } from 'node:crypto';
import { renameSync, rmSync, writeFileSync } from 'node:fs';

import { listInvites } from './invites.mjs';
import { tokenGrantCanvases } from './tokens.mjs';
import { listUsers } from './users.mjs';

/** The env var the studio child reads (apps/studio/access/known-canvases.ts). */
export const KNOWN_CANVASES_ENV = 'MAUDE_HUB_KNOWN_CANVASES_FILE';

const grantsOf = (access) => (Array.isArray(access?.grants) ? access.grants : []);

/**
 * Every canvas a stored grant names, sorted.
 * @param {string} dataDir
 * @returns {string[]}
 */
export function storedGrantCanvases(dataDir) {
  const out = new Set(tokenGrantCanvases(dataDir));
  for (const u of listUsers(dataDir)) for (const g of grantsOf(u.access)) out.add(g.c);
  for (const i of listInvites(dataDir)) for (const g of grantsOf(i.access)) out.add(g.c);
  return [...out].filter((c) => typeof c === 'string').sort();
}

/**
 * The child's copy of the list. `refresh()` is cheap when nothing changed (three small reads and a
 * string compare); a failed write keeps the last good file and warns once per failure streak.
 *
 * @param {{ dataDir: string, file: string, list?: () => string[] }} opts
 */
export function createKnownCanvasesFile({
  dataDir,
  file,
  list = () => storedGrantCanvases(dataDir),
}) {
  let last = null;
  let warned = false;
  return {
    file,
    refresh() {
      let body;
      try {
        body = `${JSON.stringify({ canvases: list() })}\n`;
      } catch {
        return;
      }
      if (body === last) return;
      const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
      try {
        writeFileSync(tmp, body, { flag: 'wx', mode: 0o644 });
        renameSync(tmp, file);
        last = body;
        warned = false;
      } catch (err) {
        rmSync(tmp, { force: true });
        if (!warned)
          console.warn(`[hub] could not hand the known canvases to the studio: ${err.message}`);
        warned = true;
      }
    },
  };
}
