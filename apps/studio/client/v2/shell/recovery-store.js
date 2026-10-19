// client/v2/shell/recovery-store.js — S11.17 (C37): what the window knows about errors and recovery.
//
//   · the full-disk hold — `GET /_api/diagnostics/disk` `{ full, held, since }`, ONE poll for every
//     reader (the Share cluster's status word and the callout stack), every 8 s while the window shows
//     and someone listens; Retry is `POST /_api/diagnostics/disk-retry` (registry `save.retry-held`).
//   · the crash notice — the desktop shell's `app://crashed`, heard once per page (S11.16 `onCrashed`),
//     plus `GET /_api/diagnostics/last-work` for "Your work up to 14:05".
//   · the report entry — the crash line's Report a bug… opens the dialog with the crash logs ticked
//     (unless Settings › Privacy › Logs in bug reports is Never: then nothing is offered at all).

import { useEffect, useState, useSyncExternalStore } from 'react';

import { onCrashed } from './native-doors.js';

const EMPTY = Object.freeze({ full: false, held: 0, since: null });
const POLL_MS = 8000;

let disk = EMPTY;
const subs = new Set();
let timer = null;

const same = (a, b) => a.full === b.full && a.held === b.held && a.since === b.since;

function set(next) {
  const v = {
    full: next?.full === true,
    held: Number.isFinite(next?.held) ? next.held : 0,
    since: Number.isFinite(next?.since) ? next.since : null,
  };
  if (same(v, disk)) return;
  disk = Object.freeze(v);
  for (const fn of subs) fn();
}

/** Read the hold now (a hidden window skips the tick; the next visible one catches up). */
export async function refreshDisk(fetchImpl = globalThis.fetch) {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return disk;
  try {
    const r = await fetchImpl('/_api/diagnostics/disk');
    if (r.ok) set(await r.json());
  } catch {
    /* the studio is restarting: keep what we knew */
  }
  return disk;
}

/** Retry: try every held write now. Resolves to the server's `{ landed, held, full }` (or null). */
export async function retryHeld(fetchImpl = globalThis.fetch) {
  try {
    const r = await fetchImpl('/_api/diagnostics/disk-retry', { method: 'POST' });
    const body = await r.json().catch(() => null);
    if (r.ok && body)
      set({ full: body.full, held: body.held, since: body.full ? disk.since : null });
    return r.ok ? body : null;
  } catch {
    return null;
  }
}

export function subscribeDisk(fn) {
  subs.add(fn);
  if (subs.size === 1) {
    void refreshDisk();
    timer = setInterval(() => void refreshDisk(), POLL_MS);
  }
  return () => {
    subs.delete(fn);
    if (!subs.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export const diskSnapshot = () => disk;

/** `{ full, held, since }` — the full-disk hold, kept current while mounted. */
export function useDiskHold() {
  return useSyncExternalStore(subscribeDisk, diskSnapshot, () => EMPTY);
}

/** Tests only. */
export function resetRecoveryForTest() {
  disk = EMPTY;
  subs.clear();
  if (timer) clearInterval(timer);
  timer = null;
  reportEntry = null;
}

// ── the crash line ───────────────────────────────────────────────────────────────────────────────

/** `{ notice, lastWorkAt }` after an unclean exit, else null. Asks the shell once per page. */
export function useCrashNotice(fetchImpl = globalThis.fetch) {
  const [crash, setCrash] = useState(null);
  useEffect(() => {
    let live = true;
    void onCrashed((notice) => {
      if (!live) return;
      setCrash({ notice, lastWorkAt: null });
      fetchImpl('/_api/diagnostics/last-work')
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => {
          if (live && Number.isFinite(b?.lastWorkAt))
            setCrash({ notice, lastWorkAt: b.lastWorkAt });
        })
        .catch(() => {});
    });
    return () => {
      live = false;
    };
  }, [fetchImpl]);
  return crash;
}

// ── Report a bug… from the crash line ────────────────────────────────────────────────────────────

let reportEntry = null;

/** The next Report-a-bug dialog opens from `entry` ('crash'); read once by the dialog. */
export function setReportEntry(entry) {
  reportEntry = entry ?? null;
}

export function takeReportEntry() {
  const e = reportEntry;
  reportEntry = null;
  return e;
}

/**
 * Are the crash logs ticked when the dialog opens? `policy` is settings-model `reportLogsConsent(…)`:
 * Always ticks them; from the crash line they start ticked too (that is why it was clicked); Never offers
 * nothing, from anywhere.
 */
export function crashLogsTicked(policy, entry) {
  if (!policy?.offer) return false;
  return policy.on === true || entry === 'crash';
}
