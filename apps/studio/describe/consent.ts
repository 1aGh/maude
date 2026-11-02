// describe/consent.ts — "Let AI describe your pictures so search can find what's in them" (S8.20; V2-1.17 §5.9, CONTRACT §7).
//
// Asked once per project, per person, on this Mac — never assumed. The answer lives in
// `<designRoot>/_canvas-state/_describe.json` (the existing `_canvas-state/` class: IGNORED, never synced, never
// committed, never exported — DDR-115; nothing new to classify):
//
//   { "v": 1, "on": true, "since": 1760000000000, "dailyCap": 200 }      plus `stopped: true` after Stop
//
// No file = never asked: the first search offers it. `on: false` = asked and declined (or turned off): nothing offers it
// again; ⌘K "Search in pictures" and Settings › General still turn it on, through the same sheet.
//
// The file sits in the project folder, so a cloned or tampered one is read defensively: anything but a well-formed
// `on: true` is off, and the daily cap is clamped to what budget.ts allows.

import { randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { DAILY_CAP_DEFAULT, DAILY_CAP_MAX } from './budget.ts';

export const DESCRIBE_REL = '_canvas-state/_describe.json';

export interface ConsentFile {
  v: 1;
  on: boolean;
  since: number;
  dailyCap: number;
  stopped?: boolean;
}

export interface Consent {
  /** a person on this Mac answered (the file exists and reads) */
  asked: boolean;
  on: boolean;
  /** when it was turned on (ms); 0 when off */
  since: number;
  dailyCap: number;
  /** Stop in the progress line: consent stays, describing waits for Resume */
  stopped: boolean;
}

export const consentPath = (designRoot: string) => path.join(designRoot, DESCRIBE_REL);

export const NOT_ASKED: Consent = Object.freeze({
  asked: false,
  on: false,
  since: 0,
  dailyCap: DAILY_CAP_DEFAULT,
  stopped: false,
});

const clampCap = (v: unknown) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, DAILY_CAP_MAX) : DAILY_CAP_DEFAULT;
};

export function readConsent(designRoot: string): Consent {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(consentPath(designRoot), 'utf8'));
  } catch {
    return NOT_ASKED;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return NOT_ASKED;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return NOT_ASKED;
  const on = o.on === true;
  const since = Number(o.since);
  return {
    asked: true,
    on,
    since: on && Number.isFinite(since) && since > 0 ? since : 0,
    dailyCap: clampCap(o.dailyCap),
    stopped: on && o.stopped === true,
  };
}

function writeAtomic(file: string, value: ConsentFile) {
  const dir = path.dirname(file);
  // a committed `_canvas-state -> /elsewhere` must not carry the write out of the project (L8, as home/user-state.ts)
  let isLink = false;
  try {
    isLink = lstatSync(dir).isSymbolicLink();
  } catch {
    /* absent → created below */
  }
  if (isLink) throw new Error(`refusing to write through a symlinked ${path.basename(dir)}/`);
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** The person's answer: Describe pictures (on) or Cancel / turn off (off). Turning on clears a Stop. */
export function setConsent(designRoot: string, on: boolean, now = Date.now()): Consent {
  const was = readConsent(designRoot);
  const file: ConsentFile = {
    v: 1,
    on,
    since: on ? (was.on ? was.since : now) : 0,
    dailyCap: was.dailyCap,
  };
  writeAtomic(consentPath(designRoot), file);
  return readConsent(designRoot);
}

/** Stop / Resume in the progress line. Only meaningful while on; off stays off. */
export function setStopped(designRoot: string, stopped: boolean): Consent {
  const was = readConsent(designRoot);
  if (!was.on) return was;
  const file: ConsentFile = { v: 1, on: true, since: was.since, dailyCap: was.dailyCap };
  if (stopped) file.stopped = true;
  writeAtomic(consentPath(designRoot), file);
  return readConsent(designRoot);
}
