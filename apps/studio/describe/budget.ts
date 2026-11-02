// describe/budget.ts — how much describing this Mac does, enforced HERE (the server), not by the panel (S8.20; V2-1.17 §5.9).
//
//   ≤ 10 pictures per batch · ONE batch in flight per Mac · ≥ 20 s between batches · ≤ dailyCap (default 200) pictures per
//   project per day · each picture a JPEG ≤ 1024 px and ≤ 400 KB · raster images and video posters only.
//
// The counters are files on this Mac, outside every project, so a second studio process (another project, or S12.13's
// `maude design describe` verb) meets the same limits:
//
//   ~/.maude/index/v1/describe/_slot            the one batch in flight (O_EXCL; stale after 10 min — a crashed holder)
//   ~/.maude/index/v1/describe/_last.json       { at } when the last batch ended
//   ~/.maude/index/v1/projects/<pid>/describe/_usage.json   { day, count } pictures sent today, per project

import { randomBytes } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';

import { indexDir, projectDir } from '../index/snapshot.ts';
import { checkJpeg } from '../thumbs/validate.ts';

export const BATCH_MAX = 10;
export const GAP_MS = 20_000;
export const PIC_MAX_PX = 1024;
export const PIC_MAX_BYTES = 400 * 1024;
export const DAILY_CAP_DEFAULT = 200;
/** A hand-edited `dailyCap` is clamped to this. */
export const DAILY_CAP_MAX = 2000;
export const SLOT_STALE_MS = 10 * 60_000;

const RASTER = /\.(jpe?g|png|webp|gif|avif|heic|heif|tiff?|bmp)$/i;

export const machineDescribeDir = () => path.join(indexDir(), 'describe');
export const projectDescribeDir = (pid: string) => path.join(projectDir(pid), 'describe');
const slotPath = () => path.join(machineDescribeDir(), '_slot');
const lastPath = () => path.join(machineDescribeDir(), '_last.json');
const usagePath = (pid: string) => path.join(projectDescribeDir(pid), '_usage.json');

/** The local calendar day, `YYYY-MM-DD`. */
export function dayOf(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** Pictures sent for this project today. */
export function usedToday(pid: string, now: number): number {
  const u = readJson(usagePath(pid));
  if (!u || u.day !== dayOf(now)) return 0;
  const n = Math.floor(Number(u.count));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Count `n` more pictures sent today (BEFORE they are sent: a crash mid-batch still counts them). */
export function spend(pid: string, n: number, now: number): number {
  const count = usedToday(pid, now) + Math.max(0, Math.floor(n));
  writeJson(usagePath(pid), { day: dayOf(now), count });
  return count;
}

/** How many pictures the next batch may hold: min(10, what is left of today's cap). */
export function batchRoom(pid: string, dailyCap: number, now: number): number {
  return Math.max(0, Math.min(BATCH_MAX, dailyCap - usedToday(pid, now)));
}

export type SlotRefusal = { ok: false; reason: 'in-flight' | 'too-soon'; retryAt: number };
export type Slot = { ok: true; token: string };

/** Claim the Mac's one batch slot, or say when to try again. */
export function claimSlot(now: number): Slot | SlotRefusal {
  const last = Number(readJson(lastPath())?.at);
  if (Number.isFinite(last) && now - last < GAP_MS && now >= last)
    return { ok: false, reason: 'too-soon', retryAt: last + GAP_MS };
  mkdirSync(machineDescribeDir(), { recursive: true, mode: 0o700 });
  const token = randomBytes(8).toString('hex');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(slotPath(), 'wx', 0o600);
      try {
        writeSync(fd, JSON.stringify({ token, at: now, pid: process.pid }));
      } finally {
        closeSync(fd);
      }
      return { ok: true, token };
    } catch {
      const held = readJson(slotPath());
      const at = Number(held?.at);
      // a holder that never let go (crashed) frees the slot after SLOT_STALE_MS; a garbled file is stale at once
      if (!Number.isFinite(at) || now - at > SLOT_STALE_MS) {
        rmSync(slotPath(), { force: true });
        continue;
      }
      return { ok: false, reason: 'in-flight', retryAt: at + SLOT_STALE_MS };
    }
  }
  return { ok: false, reason: 'in-flight', retryAt: now + GAP_MS };
}

/** Give the slot back (only the holder's token does) and start the 20 s gap. */
export function releaseSlot(token: string, now: number) {
  const held = readJson(slotPath());
  if (held?.token === token) rmSync(slotPath(), { force: true });
  writeJson(lastPath(), { at: now });
}

/** Which assets may be described at all: raster pictures, and video (its poster). Never sound, SVG or a document. */
export function isDescribable(row: { rel: string; kind: string }): boolean {
  if (row.kind === 'video') return true;
  return row.kind === 'image' && RASTER.test(row.rel);
}

/** The picture that would leave the Mac: a JPEG ≤ 1024 px and ≤ 400 KB, or the reason it is not sent. */
export function pictureFits(
  bytes: Uint8Array | null | undefined
): { ok: true } | { ok: false; reason: string } {
  if (bytes && bytes.length > PIC_MAX_BYTES) return { ok: false, reason: 'too-large' };
  const c = checkJpeg(bytes, PIC_MAX_PX);
  return c.ok ? { ok: true } : { ok: false, reason: c.reason };
}
