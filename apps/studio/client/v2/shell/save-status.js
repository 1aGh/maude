// client/v2/shell/save-status.js — V2-4.3a: what the Share cluster says, as pure functions.
//
// CONTRACT §6 gives the slot next to the faces ONE word: Saved · Syncing… · Offline — kept on this Mac ·
// Local project, plus Not saved only while a write has actually failed (action: Retry) or a held source
// conflict waits (action: Compare). A person without
// edit rights sees an access word in the same slot (Can view / Can comment) and Ask to edit as the one
// action. Everything the cluster shows is derived here, with no DOM and no React, so every word and every
// precedence is a plain test.
//
// PRECEDENCE (first match wins)
//   1. Not saved      — a write failed and nothing is holding it (`writeFailed`), or the hub refused the
//                       documents outright (phase `refused`: the bytes sit in recovery slots, nothing
//                       retries them by itself), or a held SOURCE conflict waits (`held`: this Mac kept its
//                       copy, the project's version sits in `_history/<slug>/sync-recovery/` — the canvas on
//                       this Mac is not the project's, so "Saved" would be a lie; p8-held-conflict-status).
//                       A held conflict's action is Compare (Diagnostics › Sync details at that conflict);
//                       a failed write's is Retry. Outranks everything: it is the only word that asks for you.
//   2. Local project  — nothing is linked, so nothing can be offline or syncing.
//   3. Offline        — no network (`online === false`), or the link is `offline` / `stalled`. Edits are
//                       kept on this Mac, which is exactly the claim; it also outranks Syncing… because
//                       "N edits waiting" with no network is kept, not syncing.
//   4. Syncing…       — the link is connecting / syncing, or edits are still waiting to leave this Mac.
//   5. Saved          — everything else (synced, parked, nothing-syncable, attention: the work is safe;
//                       the last two are told elsewhere — Sync panel — not by a word here).
//
// Inputs come from today's sources: `phase` from sync/presentation.ts `syncPresentation(syncStatus)`
// (the status bar's own rule), `pending` = hub queuedOps + GET /_api/outbox `content.pending` (V2-2.16),
// `online` = navigator.onLine, `linked` = a cloud cell, a credentialed cloud link, or a /_sync-status link.
// `writeFailed` has two producers: phase `refused` (above) and the full disk (`disk-full`, C37 / S11.17):
// share-cluster-host.jsx passes `{ kind: 'disk-full' }` while `GET /_api/diagnostics/disk` reports held
// writes (recovery-store.js), and the word goes back to Saved once they land.

/**
 * ONE letter, the face's initial (10 co-presence: "M", "T" — never "YO" or "MD"). A face is 24 px and
 * wears a tone; two letters of a git username ("1aGh" → "1A") read as noise.
 */
export function faceLetter(name) {
  const t = typeof name === 'string' ? name.trim() : '';
  return t ? [...t][0].toUpperCase() : '?';
}

/** The five words, CONTRACT §6 — exact. */
export const WORDS = Object.freeze({
  saved: 'Saved',
  syncing: 'Syncing…',
  offline: 'Offline — kept on this Mac',
  local: 'Local project',
  'not-saved': 'Not saved',
});

export const ACCESS_WORDS = Object.freeze({ view: 'Can view', comment: 'Can comment' });

/** A held source conflict's one action (CONTRACT §6): the two versions side by side in Sync details. */
export const COMPARE = Object.freeze({ id: 'compare', label: 'Compare' });

export const DISK_FULL_DETAIL = "This Mac is out of space — changes wait here until there's room.";

const ICONS = {
  saved: 'cloud',
  syncing: 'sync',
  offline: 'offline',
  local: 'laptop',
  'not-saved': 'problem',
};
const TONES = { offline: 'warn', 'not-saved': 'error' };

const OFFLINE_PHASES = new Set(['offline', 'stalled']);
const SYNCING_PHASES = new Set(['connecting', 'syncing']);

const count = (n) => (Number.isFinite(n) && n > 0 ? n : 0);

/**
 * @param in.linked      a hub / cloud link exists
 * @param in.online      false only when the browser says there is no network
 * @param in.phase       SyncPhase from syncPresentation, or null
 * @param in.pending     edits waiting to leave this Mac
 * @param in.writeFailed null | { kind: 'failed' | 'disk-full' }
 * @param in.held        slugs of the canvases with a held source conflict (sync-details-model `heldConflicts`)
 * @returns {{ kind, word, icon, tone, detail?, conflict?, actions }}
 *   actions: [{ id: 'retry' | 'show-in-finder' | 'compare', label }]; `conflict` = the slug Compare opens
 */
export function saveStatus(input) {
  const {
    linked = false,
    online = true,
    phase = null,
    pending = 0,
    writeFailed = null,
    held = [],
  } = input ?? {};
  const make = (kind, extra = {}) => ({
    kind,
    word: WORDS[kind],
    icon: ICONS[kind],
    tone: TONES[kind] ?? '',
    actions: [],
    ...extra,
  });
  const conflicts = Array.isArray(held) ? held.filter((h) => typeof h === 'string' && h) : [];
  const failed = !!writeFailed || phase === 'refused';
  if (failed || conflicts.length) {
    const disk = writeFailed?.kind === 'disk-full';
    const actions = !failed
      ? []
      : disk
        ? [
            { id: 'retry', label: 'Retry' },
            { id: 'show-in-finder', label: 'Show in Finder' },
          ]
        : [{ id: 'retry', label: 'Retry' }];
    if (conflicts.length) actions.push({ ...COMPARE });
    return make('not-saved', {
      detail: disk ? DISK_FULL_DETAIL : undefined,
      actions,
      // the canvas Compare opens (the first held conflict; Sync details lists every one)
      ...(conflicts.length ? { conflict: conflicts[0] } : {}),
    });
  }
  if (!linked) return make('local');
  if (online === false || OFFLINE_PHASES.has(phase)) return make('offline');
  if (SYNCING_PHASES.has(phase) || count(pending) > 0) return make('syncing');
  return make('saved');
}

/**
 * The access word for a person without edit rights (CONTRACT §6 "Access status"). Today's `viewer` role
 * means Can comment (V2-1.7); `observer`, the role below it, is Can view. null for editors.
 */
export function accessStatus({ canEdit, role, appOnly = false } = {}) {
  if (canEdit) return null;
  // p8-cloud-canvas-only-viewing — Can edit by role, Viewing in this browser frame: nothing to ask for.
  if (appOnly) return { word: 'Can edit', action: null };
  return {
    word: role === 'observer' ? ACCESS_WORDS.view : ACCESS_WORDS.comment,
    action: 'Ask to edit',
  };
}

/** `GET /_api/outbox` → the number of content changes with no final answer yet. */
export function outboxPending(view) {
  return count(view?.content?.pending);
}

/**
 * The Exports icon (C9): shown once any export exists; a ring while anything runs. `jobs` are the export
 * center's rows (`{ status: 'queued' | 'running' | 'done' | 'failed', progress?: { current, total } }`).
 * @returns {{ show: boolean, ring: number | undefined, busy: number }} ring is 0–100
 */
export function exportsRing(jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  const running = list.filter((j) => j.status === 'running');
  const busy = running.length + list.filter((j) => j.status === 'queued').length;
  const pct = (j) => {
    const { current, total } = j.progress ?? {};
    return total > 0 ? Math.max(0, Math.min(100, (current / total) * 100)) : 0;
  };
  const ring = busy
    ? Math.round(running.reduce((s, j) => s + pct(j), 0) / Math.max(1, running.length))
    : undefined;
  return { show: list.length > 0, ring, busy };
}

const MAX_FACES = 4;

/** Who is here: you first, AI while it is editing, then other people (name only — hub-supplied,
 *  so initials are all that is drawn). */
const FACE_ROLES = ['owner', 'member', 'viewer', 'observer'];

export function facesOf({ you, agentActive = false, peers = [], max = MAX_FACES } = {}) {
  const out = [
    { initials: faceLetter(you || 'You'), name: you ? `${you} (you)` : 'You', you: true },
  ];
  // The AI wears the spark, never a letter (CONTRACT §3: not "Claude"; board 10: "only AI wears the
  // spark"): `initials` is empty and the face draws the glyph.
  if (agentActive) out.push({ initials: '', name: 'AI · editing', agent: true });
  for (const p of peers)
    out.push({
      initials: faceLetter(p?.name),
      name: String(p?.name ?? ''),
      clientID: p?.clientID,
      following: p?.following === true,
      // S9.23 — where they are (the face menu and the people list say it); absent on a pre-v2 peer.
      artboard: typeof p?.artboard === 'string' ? p.artboard : null,
      idleSince: Number.isFinite(p?.idleSince) ? p.idleSince : null,
      surface: p?.surface === 'browser' ? 'browser' : 'app',
      inComments: p?.inComments === true,
      // P8 G2 (b) — the room-stamped role (closed set), for the "· Can edit" word (presence/model.ts roleWord)
      role: FACE_ROLES.includes(p?.role) ? p.role : null,
    });
  return out.slice(0, max);
}
