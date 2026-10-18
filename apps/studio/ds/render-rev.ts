// S10.4 (V2-1.6 §5.8) — what the index payload says about which revision each canvas renders:
//   dsConverted  system → bool        a valid `revisions/head.json` exists
//   systemHeads  system → id | null   the published head (null while a system is being made)
//   dsRevGaps    id → peer | null     a revision this index REFERENCES (a head, or a canvas's `dsRev`) that
//                                     this disk cannot render yet: `<id>.json` missing or invalid, or a
//                                     sibling missing. The value is the person who made it when head.json's
//                                     log names one ("Waiting for Jonas's Mac"), else null.
// `client/canvas-url.js` turns them into URLs (dsRev → head → working files). Read-only, synchronous, and
// cheap enough for a request that already walks the tree: per revision three `stat`s, plus a read and a
// hash only when the file's size or mtime changed.

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { readHead } from './head.ts';
import { verifyRevision } from './revision.ts';

export interface DsRenderSystem {
  name: string;
  /** designRoot-relative folder */
  path: string;
}

export interface DsRenderIndex {
  dsConverted: Record<string, boolean>;
  systemHeads: Record<string, string | null>;
  dsRevGaps: Record<string, string | null>;
}

const ID_RE = /^[0-9a-f]{64}$/;

interface Stamp {
  sig: string;
  ok: boolean;
}
/** `<abs>/<id>` → the last verdict, keyed by the revision file's size + mtime. */
const verdicts = new Map<string, Stamp>();
const VERDICTS_MAX = 512;

function statSig(file: string): string | null {
  try {
    const st = statSync(file);
    return st.isFile() && st.size > 0 ? `${st.size}:${st.mtimeMs}` : null;
  } catch {
    return null;
  }
}

/**
 * Can this disk render revision `id` of the system at `dsAbs`? The revision file must verify (its id names
 * its canonical body, every file's sha256 names its text) and both sibling stylesheets must be there. A
 * missing sibling is healed by the revision plane (V2-1.6 §5.6), not here: this only reports.
 */
export function revisionRenderable(dsAbs: string, id: string): boolean {
  if (!ID_RE.test(id)) return false;
  const dir = path.join(dsAbs, 'revisions');
  const json = path.join(dir, `${id}.json`);
  const sigs = [
    json,
    path.join(dir, `${id}.tokens.css`),
    path.join(dir, `${id}.components.css`),
  ].map(statSig);
  if (sigs.some((s) => s === null)) return false;
  const sig = sigs.join('|');
  const key = `${dsAbs}\0${id}`;
  const seen = verdicts.get(key);
  if (seen && seen.sig === sig) return seen.ok;
  let ok = false;
  try {
    ok = verifyRevision(id, readFileSync(json, 'utf8')).ok;
  } catch {
    ok = false;
  }
  if (verdicts.size >= VERDICTS_MAX) verdicts.clear();
  verdicts.set(key, { sig, ok });
  return ok;
}

/**
 * @param canvasRevs canvas path → its `dsRev`, per system (only canvases that carry one)
 */
export function dsRenderIndex(
  designRoot: string,
  systems: readonly DsRenderSystem[],
  canvasRevs: Readonly<Record<string, { system: string; dsRev: string }>>
): DsRenderIndex {
  const out: DsRenderIndex = { dsConverted: {}, systemHeads: {}, dsRevGaps: {} };
  const wanted = new Map<string, Set<string>>();
  for (const { system, dsRev } of Object.values(canvasRevs)) {
    if (!ID_RE.test(dsRev)) continue;
    if (!wanted.has(system)) wanted.set(system, new Set());
    wanted.get(system)?.add(dsRev);
  }
  for (const s of systems) {
    const dsAbs = path.join(designRoot, s.path);
    const h = readHead(dsAbs);
    const converted = h.state === 'ok';
    out.dsConverted[s.name] = converted;
    if (!converted || h.state !== 'ok') continue;
    out.systemHeads[s.name] = h.doc.head;
    const ids = new Set<string>(wanted.get(s.name) ?? []);
    if (h.doc.head) ids.add(h.doc.head);
    for (const id of ids) {
      if (revisionRenderable(dsAbs, id)) continue;
      const entry = h.doc.log.find((l) => l.rev === id);
      const by = entry?.by;
      const peer =
        by && (by.kind === 'person' || by.kind === 'peer') && typeof by.name === 'string' && by.name
          ? by.name
          : null;
      out.dsRevGaps[id] = peer;
    }
  }
  return out;
}
