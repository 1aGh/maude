// Canvas scope on the hub's DOCUMENT doors — V2-1.16 L2, L4, L6, L11 (S9.5).
//
// The peer door's plane-A half: Yjs canvas documents (`onAuthenticate`),
// presence (`beforeHandleAwareness`), the accepted-revisions routes + kernel
// (DDR-241) and the cell's git history. Every answer is derived from the ONE
// access object (`access-gate.mjs peerAccess`, `apps/studio/access/scope.ts`);
// this module only says what each door does with it. It holds no matrix.
//
// The rules every function here keeps:
//  - U7: a project-level session is UNCHANGED — every filter is the identity
//    when `access.role !== null` (the v1-client-compat suite pins it);
//  - U1: for a canvas-only session an invisible document, path, hash or lane
//    answers exactly as a missing one, with the same status and body;
//  - U4: free text that could name another canvas (an action label, a commit
//    subject) is rewritten from the visible paths only, or the record dropped;
//  - a Yjs canvas document IS the canvas's raw source (every lane: html, css,
//    meta, comments, annotations), so opening it is the `export` class (V2-1.7
//    §5.2, A19). Can view (`observer`) holds a browser-door cookie that is a
//    peer token, never a peer credential the door may honour: refused.

import { sees, seesDoc } from '../../studio/access/scope.ts';
import { claimForMatch, NOT_IN_SCOPE_REFUSAL, peerAccess } from './access-gate.mjs';
import { sanitizeComponent } from './doc-namespace.mjs';
import { canvasSlug } from './workspace-files.mjs';

export { NOT_IN_SCOPE_REFUSAL };

/** Today's Yjs refusal for an out-of-scope document — reused verbatim (U1). */
export const DOC_REFUSAL_REASON = 'token not authorized for this documentName';

/** The reason a kernel `forbidden` carries today — reused verbatim. */
const VIEW_NOT_EDIT = 'this account can view but not edit';

/**
 * The document-name slug of a canonical canvas path (`ui/Home.tsx` → `ui-home`):
 * the studio's `slugFor` (mirrored by `workspace-files.mjs canvasSlug`) put
 * through the namespace normalizer `buildDocName` applies.
 */
export const docSlugOf = (canvasPath) => sanitizeComponent(canvasSlug(canvasPath));

/** The granted canvas a namespaced document belongs to, or null (canvas-only only). */
export function grantedCanvasOfDoc(access, documentName) {
  const parts = String(documentName ?? '').split('/');
  if (parts.length !== 4 || parts[0] !== 'ws') return null;
  const slug = parts[3];
  for (const g of access.grants) if (docSlugOf(g.c) === slug) return g.c;
  return null;
}

/**
 * L2 — may this peer open `documentName`, and how?
 *
 * Runs AFTER `matchesScope` (DDR-053 machine scopes keep narrowing). Returns
 * `{ ok: false }` — the caller throws today's `authError(DOC_REFUSAL_REASON)` —
 * or `{ ok: true, readOnly, canvas, summon }`.
 *
 *  - a project role: every document, as today, except that a role without
 *    `export` (observer) is refused: the document is the canvas's source;
 *  - canvas-only: only a granted canvas's document, refused below `export`
 *    on it, read-only below `edit` on it. The claim decides — the stored
 *    `read_only` bit is the fail-closed projection for doors that do not read
 *    the claim (`peerSessionFields`).
 *
 * @param {ReturnType<typeof peerAccess>} peer
 * @param {string} documentName
 */
export function docDoor(peer, documentName) {
  if (!peer) return { ok: false };
  const { access } = peer;
  if (access.role !== null) {
    if (!seesDoc(access, documentName, docSlugOf) || !access.can('export', null)) {
      return { ok: false };
    }
    return {
      ok: true,
      canvas: null,
      readOnly: peer.readOnly || !access.can('edit', null),
      summon: !peer.readOnly && access.can('summon', null),
    };
  }
  if (!access.canvasOnly || !seesDoc(access, documentName, docSlugOf)) return { ok: false };
  const canvas = grantedCanvasOfDoc(access, documentName);
  if (canvas === null || !access.can('export', canvas)) return { ok: false };
  return {
    ok: true,
    canvas,
    readOnly: !access.can('edit', canvas),
    summon: access.can('summon', canvas),
  };
}

/**
 * The connection-context fields `onAuthenticate` adds for a content document:
 * the CLAIM (serializable; every reader resolves it), the granted canvas
 * (null = project-level) and whether this connection may summon.
 */
export function docContextFields(match, door) {
  return { access: claimForMatch(match), canvas: door.canvas, summon: door.summon };
}

/**
 * L11 / V2-1.7 §5.5 — `beforeHandleAwareness`: a connection lacking `summon`
 * on this document cannot send a `summon` field (Bring everyone here). Field
 * changes on the scratch states are what the hub re-encodes and fans out.
 * Server-internal updates (no context) and pre-v2 contexts are untouched.
 *
 * @returns {number} how many states lost the field
 */
export function stripSummon({ states, context }) {
  const user = context?.user;
  if (!user || user.ctl || user.summon === true || !states) return 0;
  // A pre-S9.5 context (or the permissive dev hub) carries no decision; the
  // read_only projection is the floor — a reader never summons.
  if (user.summon === undefined && !user.readOnly && !user.access) return 0;
  let stripped = 0;
  for (const state of states.values()) {
    if (state && typeof state === 'object' && 'summon' in state) {
      delete state.summon;
      stripped += 1;
    }
  }
  return stripped;
}

// ---------------------------------------------------------------- L4 ------

/** Is this manifest row (`{ doc, path }`) visible to the session? */
export function seesDocRow(access, row) {
  if (access.role !== null) return true;
  if (!access.canvasOnly || !row || typeof row.path !== 'string') return false;
  return access.seesCanvas(row.path);
}

/** A display name derived from a visible path: its file name without extension. */
export const nameOfPath = (path) => {
  const file = String(path).split('/').pop() ?? '';
  const dot = file.indexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
};

/** "Changed A" / "Changed A, B" — the U4 rewrite of a label or commit subject. */
export function changedSubject(paths) {
  const names = [...new Set(paths.filter(Boolean).map(nameOfPath))].filter(Boolean).sort();
  return names.length ? `Changed ${names.join(', ')}` : 'Changed';
}

/** An actor as a canvas-only session sees it: a name, never an address (no `invite`). */
export const actorName = (actor) =>
  typeof actor === 'string' && actor.includes('@') ? actor.slice(0, actor.indexOf('@')) : actor;

/**
 * Bootstrap for a canvas-only session: visible docs only, the directories that
 * lead to them, no canvas groups, and the project config cut to the design
 * systems the visible canvases name (`designSystems` of `metaOf(doc)`).
 *
 * @param {object} access
 * @param {{ docs: object[], dirs: string[] }} manifest
 * @param {{ projectConfig: object|null, designSystemsOf: (rows: object[]) => Promise<Set<string>> }} o
 */
export async function scopeBootstrap(access, manifest, { projectConfig, designSystemsOf }) {
  if (access.role !== null) return null;
  const docs = (manifest.docs ?? []).filter((row) => seesDocRow(access, row));
  const ancestors = new Set();
  for (const row of docs) {
    const parts = String(row.path).split('/');
    for (let i = 1; i < parts.length; i++) ancestors.add(parts.slice(0, i).join('/'));
  }
  const dirs = (manifest.dirs ?? []).filter((d) => ancestors.has(d));
  let cfg = null;
  if (projectConfig && typeof projectConfig === 'object') {
    const used = await designSystemsOf(docs.filter((r) => !r.retired));
    cfg = {
      canvasGroups: [],
      designSystems: (projectConfig.designSystems ?? []).filter((d) => used.has(d.name)),
    };
  }
  return { docs, dirs, canvasGroups: [], projectConfig: cfg };
}

/**
 * Revisions / history for a canvas-only session: effects on visible docs only,
 * an action with none left is dropped, the label rewritten (U4), the actor a
 * name, the device origin withheld. Identity for a project role.
 *
 * @param {object} access
 * @param {object[]} actions store `actionRow` + `effects`
 * @param {(doc: string) => object|null} rowOf the manifest row of a doc
 */
export function scopeActions(access, actions, rowOf) {
  if (access.role !== null) return actions;
  const out = [];
  for (const a of actions) {
    const effects = (a.effects ?? []).filter((e) => seesDocRow(access, rowOf(e.doc)));
    if (effects.length === 0) continue;
    out.push({
      ...a,
      actor: actorName(a.actor),
      label: changedSubject(effects.map((e) => rowOf(e.doc)?.path)),
      origin: null,
      effects,
    });
  }
  return out;
}

/**
 * The kernel's per-proposal scope check for a canvas-only session (V2-1.16 L4),
 * or null for a project role (the kernel then runs exactly as today).
 *
 * `before(ops, pathOf)` runs after the envelope checks and before any op
 * executes, so no rejection that names an invisible doc or path (path-conflict,
 * generation-stale) can be reached; `after(changed)` re-checks every document
 * the ops actually touched (undo, redo, restore). Each returns a
 * `{ code, detail }` rejection or null. `not-in-scope` carries no detail (U1).
 */
export function proposalScope(access) {
  if (access.role !== null) return null;
  const NOT_IN_SCOPE = { code: 'not-in-scope', detail: {} };
  const FORBIDDEN = { code: 'forbidden', detail: { reason: VIEW_NOT_EDIT } };
  const judge = (path, cap) => {
    if (typeof path !== 'string' || !access.seesCanvas(path)) return NOT_IN_SCOPE;
    return access.can(cap, path) ? null : FORBIDDEN;
  };
  return {
    async before(ops, pathOf) {
      for (const op of Array.isArray(ops) ? ops : []) {
        if (!op || typeof op !== 'object') continue; // the kernel answers `invalid`
        switch (op.op) {
          case 'lane.replace': {
            const r = judge(await pathOf(op.doc), 'edit');
            if (r) return r;
            break;
          }
          case 'doc.delete': {
            const r = judge(await pathOf(op.doc), 'trash');
            if (r) return r;
            break;
          }
          // Structure is a project role's (G2): no create-time path oracle.
          case 'doc.create':
          case 'doc.move':
          case 'dir.create':
          case 'dir.move':
          case 'dir.delete':
            return NOT_IN_SCOPE;
          case 'history.restore': {
            if (!Array.isArray(op.docs) || op.docs.length === 0) return NOT_IN_SCOPE;
            for (const doc of op.docs) {
              const r = judge(await pathOf(doc), 'edit');
              if (r) return r;
            }
            break;
          }
          default:
            break; // undo / redo: judged on what they touch (`after`)
        }
      }
      return null;
    },
    after(changedPaths) {
      for (const path of changedPaths) {
        const r = judge(path, 'edit');
        if (r) return r;
      }
      return null;
    },
  };
}

// ---------------------------------------------------------------- L6 ------

/** A canvas's own files — the history a canvas-only session may read without a closure. */
export function ownedRelsOf(canvasPath) {
  const base = canvasPath.replace(/\.(tsx|html)$/i, '');
  return [canvasPath, `${base}.meta.json`, `${base}.annotations.json`, `${base}.annotations.svg`];
}

/**
 * Which granted canvas a design-root-relative path belongs to, and whether the
 * session sees it at all. With a closure (S9.4 `closureFor`) the full read set;
 * without one, the granted canvases' own files — never wider (U1 fails closed).
 *
 * @returns {{ visible: boolean, canvas: string | null }}
 */
export function pathScope(peer, rel) {
  const { access } = peer;
  if (access.role !== null) return { visible: true, canvas: null };
  if (!access.canvasOnly) return { visible: false, canvas: null };
  const closure = typeof peer.closure === 'function' ? peer.closure() : null;
  if (closure) {
    return { visible: sees(access, closure, rel), canvas: closure.ownedBy?.get(rel) ?? null };
  }
  for (const g of access.grants) {
    if (ownedRelsOf(g.c).includes(rel)) return { visible: true, canvas: g.c };
  }
  return { visible: false, canvas: null };
}

/**
 * May this session read `rel`'s history (`look`), or its bytes at a commit
 * (`export`, V2-1.7 §5.2)? A canvas-only session: only a visible path, and for
 * bytes `export` on the canvas that owns it (or on some granted canvas for a
 * shared closure file).
 */
export function historyAllows(peer, rel, need) {
  const { access } = peer;
  if (access.role !== null) return true;
  const { visible, canvas } = pathScope(peer, rel);
  if (!visible) return false;
  if (need !== 'export') return true;
  return canvas !== null
    ? access.can('export', canvas)
    : access.grants.some((g) => access.can('export', g.c));
}

/** A verified peer token as the access the document doors read. */
export { peerAccess };
