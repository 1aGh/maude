// client/v2/shell/callouts-model.js — V2-4.8b: what the old banners said, as callouts (pure functions).
//
// v1 drew five strips across the top of the window: the sync banner (offline / diverged / rejected /
// reconnect flash), the cloud role line, the update-ready strip, the "repo state changed" strip and
// (V2-1.12, kept — it is v2 code) the format-gate strip. v2 has no strip. Each message keeps a home:
//
//   offline / reconnecting     the Share cluster's status word (save-status.js: Offline — kept on this Mac,
//                              Syncing…, Saved) — nothing to add here except a LONG offline spell
//   diverged / rejected        a callout (this file) with ONE action — Details → Menu › Diagnostics › Sync
//   hub said "wait" (429)      a calm callout: what is waiting, that it is safe, ONE verb (Try now); the hub,
//                              reply, next try and the waiting files are one fold down (S11.15, 06 ad-edge-sync)
//   role line                  a callout the first time a role is seen; Can view / Can comment stay the
//                              always-visible access word (save-status.js accessStatus)
//   update ready               a callout with Restart now; the same action lives in Settings › Advanced
//   repo state changed         a callout with Reload; the same notice lives in Diagnostics › Server
//   crashed (S11.17, C37)      after an unclean exit: "Maude quit unexpectedly. Your work up to 14:05 is
//                              here." with Report a bug… (the dialog opens with the crash logs ticked)
//   disk-full (S11.17, C37)    Not saved + "This Mac is out of space — …" with Show in Finder (desktop)
//
// CONTRACT §4: *what happened · what is safe · one verb*; a callout carries ONE action at most; counts use
// the noun that reads for 1 and for many (never "canvas(es)"). Every item is `{ key, kind, tone, icon,
// title, detail?, action? }` — `key` changes when the event does, so a dismissal never hides the next one.

import { safeName } from '../../../sync/presentation.ts';
import { DISK_FULL_DETAIL, WORDS } from './save-status.js';

/**
 * What this role can do, said once, where a teammate lands (Cloud Phase 27 C3). `role-matrix.mjs` is the
 * authority on what each role means; this is its sentence.
 */
export const ROLE_LINE = Object.freeze({
  owner: 'You own this project — edit, invite and export.',
  member: 'You can edit this project, comment and export.',
  viewer: 'You can look at this project, comment and download it, but not change it.',
});

/** localStorage key remembering that a role's sentence was seen (kept from the v1 banner). */
export const roleSeenKey = (role) => `maude-cloud-role-seen:${role}`;

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const DETAILS = Object.freeze({ id: 'details', label: 'Details' });

/** HH:MM:SS in this Mac's clock — a mono value in the fold, never prose. */
export function clockOf(ms) {
  const d = new Date(ms);
  const two = (n) => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** "40 s" · "3 min" · "a moment" — how long until the hub's pause lifts. */
function untilWords(ms) {
  const secs = Math.ceil(ms / 1000);
  if (!(secs > 0)) return 'a moment';
  return secs < 90 ? `${secs} s` : `${Math.ceil(secs / 60)} min`;
}

/** The doručenka's states that mean "still on this Mac, not yet acknowledged by the cloud". */
const WAITING_STATES = new Set(['local-only', 'pushing', 'stuck']);
const FOLD_FILES = 5;

const hostOf = (url) => {
  try {
    return new URL(String(url)).host;
  } catch {
    return '';
  }
};

/**
 * The hub asked this Mac to slow down (`files.rateLimited { until, waiting }`, a 429 with Retry-After):
 * nothing is wrong and nothing is lost. The words come first; the developer's facts are a fold.
 * `fold.waiting.files` are the paths the doručenka still has as local-only / pushing / stuck.
 */
function stuckCallout(status, now) {
  const limited = status.files?.rateLimited;
  const waiting = Number.isFinite(limited?.waiting) ? limited.waiting : 0;
  if (!limited || waiting <= 0) return null;
  const until = Number.isFinite(limited.until) ? limited.until : now;
  const host = hostOf(status.url);
  const rows = [
    ...(host ? [{ id: 'hub', k: 'Hub', v: host }] : []),
    { id: 'reply', k: 'Reply', v: '429 · rate limited' },
    { id: 'next', k: 'Next try', v: clockOf(until) },
    ...(Number.isFinite(status.lastSyncAt)
      ? [{ id: 'last', k: 'Last good sync', v: clockOf(status.lastSyncAt) }]
      : []),
  ];
  const paths = Object.entries(status.files?.delivery ?? {})
    .filter(([, state]) => WAITING_STATES.has(state))
    .map(([path]) => path);
  return {
    key: `stuck:${waiting}`,
    kind: 'sync-stuck',
    tone: 'info',
    icon: 'clock',
    title: `${plural(waiting, 'change is', 'changes are')} waiting to reach the cloud.`,
    detail: `They're safe on this Mac. The cloud is busy and asked to wait — the next try is in ${untilWords(until - now)}, by itself.`,
    action: { id: 'try-now', label: 'Try now', busyLabel: 'Trying…' },
    fold: {
      rows,
      waiting: {
        count: waiting,
        files: paths.slice(0, FOLD_FILES),
        more: Math.max(0, paths.length - FOLD_FILES),
      },
      hint: 'A full compare is Resync now, in Menu › Diagnostics › Advanced.',
    },
  };
}

/**
 * The sync callout, if the hub link has something to say that a status word cannot. At most one, in the
 * old banner's priority: reconnect flash > long offline > divergence > rejected documents > the hub
 * asking to wait. A short offline spell is the status word's job.
 * `now` is only read for the countdown in the "wait" callout.
 */
export function syncCallout(status, now = Date.now()) {
  if (!status || status.linked === false || status.notSyncable) return null;
  const { state, queuedOps, flash, conflicts } = status;
  if (flash === 'synced') {
    return {
      key: `${state}:flash`,
      kind: 'sync-back',
      tone: 'ok',
      icon: 'cloud',
      title: 'Back online. Everything is synced.',
    };
  }
  if (state === 'offline-long') {
    const n = Number.isFinite(queuedOps) && queuedOps > 0 ? queuedOps : 0;
    return {
      key: `${state}:offline`,
      kind: 'sync-offline-long',
      tone: 'error',
      icon: 'offline',
      title: 'Offline for a long while',
      detail: n
        ? `${plural(n, 'edit', 'edits')} kept on this Mac, waiting to sync.`
        : 'Your edits are kept on this Mac and sync when the connection returns.',
      action: DETAILS,
    };
  }
  if (state === 'offline') return null;
  const diverged = Array.isArray(conflicts)
    ? [...conflicts].reverse().find((c) => c?.kind === 'cold-start-diverged')
    : null;
  if (diverged) {
    const slug = safeName(diverged.slug, 'a canvas');
    const key = `diverged:${slug}:${diverged.at}`;
    // DDR-102 fail-closed: a snapshotFailed conflict means the overwrite was REFUSED (local kept)
    // because _history could not be written — an error, not a routine "kept newest" notice.
    if (diverged.snapshotFailed) {
      return {
        key,
        kind: 'sync-diverged',
        tone: 'error',
        icon: 'problem',
        title: `“${slug}” changed in two places`,
        detail:
          'Kept yours, but the other version could not be saved — check the free space on this Mac.',
        action: DETAILS,
      };
    }
    return {
      key,
      kind: 'sync-diverged',
      tone: 'warn',
      icon: 'problem',
      title: `“${slug}” changed in two places`,
      detail: `Kept ${diverged.winner === 'local' ? 'your newer' : 'the team’s'} version. The other one is saved in Version history.`,
      action: DETAILS,
    };
  }
  const rejected = status.docs?.rejected ?? 0;
  if (rejected > 0) {
    return {
      key: `rejected:${rejected}`,
      kind: 'sync-rejected',
      tone: 'warn',
      icon: 'problem',
      title: `${plural(rejected, 'canvas', 'canvases')} not syncing`,
      detail: 'The cloud refused them. Your edits are kept on this Mac.',
      action: DETAILS,
    };
  }
  return stuckCallout(status, now);
}

/**
 * S6.13b — a canvas made offline whose name another device took first is now saved under the next free
 * name; the sync status carries one `canvas-renamed-<slug>` notice for each. They read as ONE info
 * callout (the sentence itself for one canvas, a count for several); × closes it, and a new rename
 * has a new key so it shows again.
 */
export function renamedCallout(status) {
  const notices = (status?.notices ?? []).filter(
    (n) => typeof n?.id === 'string' && n.id.startsWith('canvas-renamed-')
  );
  if (!notices.length) return null;
  return {
    key: `renamed:${notices.map((n) => n.id).join(',')}`,
    kind: 'canvas-renamed',
    tone: 'info',
    icon: 'cloud',
    title:
      notices.length === 1
        ? notices[0].text
        : `${plural(notices.length, 'canvas was', 'canvases were')} also made on another device — each now has a new name.`,
  };
}

/** The staged-update strip → a callout with the one action the strip had. `update` is `{ version? }`. */
export function updateCallout(update) {
  if (!update) return null;
  const ver = update.version ? ` (v${update.version})` : '';
  return {
    key: `update:${update.version ?? ''}`,
    kind: 'update',
    tone: 'info',
    icon: 'reload',
    title: `Maude updated${ver}`,
    detail: 'Restart to use the new version. Your work is saved.',
    action: { id: 'restart', label: 'Restart now' },
  };
}

/** `gitLifecycle` is non-null when the repo changed under the shell (a pull, a branch switch). */
export function repoCallout(gitLifecycle) {
  if (!gitLifecycle) return null;
  return {
    key: 'repo-changed',
    kind: 'repo-changed',
    tone: 'info',
    icon: 'reload',
    title: 'Repo state changed',
    detail: 'Reload to pick up the new files.',
    action: { id: 'reload', label: 'Reload' },
  };
}

/** The role sentence, once per role; `seen(role)` says whether it was already shown. */
export function roleCallout(cloud, seen = () => false) {
  const role = cloud?.role || null;
  const line = role ? ROLE_LINE[role] : null;
  if (!line || seen(role)) return null;
  return {
    key: `role:${role}`,
    kind: 'role',
    tone: 'info',
    icon: 'cloud',
    title: line,
    action: { id: 'got-it', label: 'Got it' },
  };
}

/**
 * V2-4.9 — the first-run tour offers. In v1 they were a fixed box in the window's bottom-left corner,
 * which is where the v2 left panel floats: it covered the canvas rows. Now they are callouts — one
 * action (Start), × marks them seen. Never while a tour is running; the usage offer first.
 * @param t.usage  the usage-tour offer is due
 * @param t.collab the team/collab-tour offer is due
 * @param t.running a tour is on screen
 */
export function tourCallout({ usage = false, collab = false, running = false } = {}) {
  if (running) return null;
  if (usage)
    return {
      key: 'tour:usage',
      kind: 'tour-usage',
      tone: 'info',
      icon: 'sparkle',
      title: 'New here? Take a 60-second tour of the canvas browser.',
      action: { id: 'tour-usage', label: 'Start' },
    };
  if (collab)
    return {
      key: 'tour:collab',
      kind: 'tour-collab',
      tone: 'info',
      icon: 'sparkle',
      title: 'New to working with a team? See how saving & sharing works — 60 seconds.',
      action: { id: 'tour-collab', label: 'Start' },
    };
  return null;
}

// ── S11.17 (C37) — errors and recovery ─────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

/** "14:05" today, "Oct 18, 23:41" on another day (the person's clock), null when nothing is known. */
export function workTime(ms, now = Date.now()) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  const t = new Date(now);
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today =
    d.getFullYear() === t.getFullYear() &&
    d.getMonth() === t.getMonth() &&
    d.getDate() === t.getDate();
  return today ? clock : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${clock}`;
}

/** CONTRACT §6 C37 — the relaunch line; without a known time it still says the work is here. */
export const CRASH_LINE = (time) =>
  time
    ? `Maude quit unexpectedly. Your work up to ${time} is here.`
    : 'Maude quit unexpectedly. Your work is here.';

/**
 * After an unclean exit the desktop shell hands a reopened tab `{ kind: 'app://crashed', startedAt }`
 * once (S11.16 `onCrashed`). `lastWorkAt` is the studio's `GET /_api/diagnostics/last-work`.
 */
export function crashedCallout(notice, lastWorkAt = null, now = Date.now()) {
  if (!notice || notice.kind !== 'app://crashed') return null;
  return {
    key: `crashed:${notice.startedAt ?? ''}`,
    kind: 'crashed',
    tone: 'warn',
    icon: 'problem',
    title: CRASH_LINE(workTime(lastWorkAt, now)),
    action: { id: 'report-bug', label: 'Report a bug…' },
  };
}

/**
 * A write the full disk refused is held (`GET /_api/diagnostics/disk` → `{ full, held, since }`). The
 * status word says Not saved too; this is the sentence and the one way to make room. Show in Finder is the
 * desktop app's (a browser tab has no Finder): `o.native`.
 */
export function diskFullCallout(disk, o = {}) {
  if (!disk?.full) return null;
  return {
    key: `disk-full:${disk.since ?? ''}`,
    kind: 'disk-full',
    tone: 'error',
    icon: 'problem',
    title: WORDS['not-saved'],
    detail: DISK_FULL_DETAIL,
    ...(o.native === false ? {} : { action: { id: 'show-in-finder', label: 'Show in Finder' } }),
  };
}

/** Errors first, then what asks for you, then the news. */
const ORDER = { error: 0, warn: 1, info: 2, ok: 3 };

/**
 * @param in.syncStatus   the shell's sync payload
 * @param in.updateReady  `{ version? }` once a newer build is staged, else null
 * @param in.gitLifecycle non-null when the repo changed
 * @param in.cloud        `cfg.cloud` (role)
 * @param in.roleSeen     (role) => boolean
 * @param in.tour         `{ usage, collab, running }` — the first-run tour offers (tourCallout)
 * @param in.crashed      `{ notice, lastWorkAt, now? }` — S11.17 the relaunch line (crashedCallout)
 * @param in.disk         `{ full, held, since }` — S11.17 the full-disk hold (diskFullCallout)
 * @param in.native       the desktop app (Show in Finder exists)
 * @param in.dismissed    Set of callout keys the person closed
 * @param in.now          ms epoch for countdowns (default: now)
 * @returns the callouts to draw, most urgent first
 */
export function calloutStack({
  syncStatus = null,
  updateReady = null,
  gitLifecycle = null,
  cloud: cloudCfg = null,
  roleSeen = () => false,
  tour = null,
  crashed = null,
  disk = null,
  native = true,
  dismissed = new Set(),
  now = Date.now(),
} = {}) {
  return [
    diskFullCallout(disk, { native }),
    crashed ? crashedCallout(crashed.notice, crashed.lastWorkAt, crashed.now) : null,
    syncCallout(syncStatus, now),
    renamedCallout(syncStatus),
    repoCallout(gitLifecycle),
    updateCallout(updateReady),
    roleCallout(cloudCfg, roleSeen),
    tour ? tourCallout(tour) : null,
  ]
    .filter((c) => c && !dismissed.has(c.key))
    .sort((a, b) => ORDER[a.tone] - ORDER[b.tone]);
}
