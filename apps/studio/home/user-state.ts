// home/user-state.ts — pins and "last opened" per project, per person (V2-1.1 §5.5).
//
//   <designRoot>/_canvas-state/_pins.json    { v: 1, pins: [{ canvas, at }] }
//   <designRoot>/_canvas-state/_recent.json  { v: 1, opened: { <canvas>: <ms> } }   ≤ 200, oldest dropped
//
// `_canvas-state/` is already a runtime class in all four DDR-115 lists (per-machine, never synced),
// so these files travel with the folder and are the same in every shell. Keys are designRoot-relative
// posix canvas paths ('ui/2026/combine/Combine-kampan.tsx').
//
// Two writers — the project server (POST /_api/pins, the canvas-open stamp) and the Home server
// (/_home/pins, for a project whose server is not running) — so every write here is
// read-modify-write with an atomic rename and NO in-memory cache: a race loses at most one toggle.

import { randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const PINS_FILE = '_pins.json';
export const RECENT_FILE = '_recent.json';
export const RECENT_CAP = 200;
/** A pins file is a person's list, not a database — past this the oldest pins drop. */
export const PINS_CAP = 500;

export interface PinsFile {
  v: 1;
  pins: Array<{ canvas: string; at: number }>;
}
export interface RecentFile {
  v: 1;
  opened: Record<string, number>;
}

export const userStateDir = (designRoot: string) => path.join(designRoot, '_canvas-state');
export const pinsPath = (designRoot: string) => path.join(userStateDir(designRoot), PINS_FILE);
export const recentPath = (designRoot: string) => path.join(userStateDir(designRoot), RECENT_FILE);

/**
 * A key these files accept: a designRoot-relative posix `.tsx` path with no `..`, no empty or
 * dot/underscore-leading runtime segment, ≤ 512 chars. Callers pass values that came from a page
 * (or, for the canvas-open stamp, from the canvas iframe through the inspector relay), so this is
 * the gate between "a string" and "a key written into a project file".
 */
export function isCanvasKey(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 512) return false;
  if (!v.endsWith('.tsx') || v.startsWith('/') || v.includes('\\') || v.includes('\0'))
    return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
  if (/[\u0000-\u001f\u007f]/.test(v)) return false;
  return v.split('/').every((s) => s !== '' && s !== '.' && s !== '..' && !s.startsWith('_'));
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null; // missing or unreadable → empty (both mean "nothing recorded yet")
  }
}

function writeAtomic(file: string, value: unknown) {
  const dir = path.dirname(file);
  // L8 (V2-3.10, with W5): a committed `_canvas-state -> /elsewhere` must not carry the write out
  // of the project. lstat, not stat: the link itself is the refusal.
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
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

export function readPins(designRoot: string): PinsFile {
  const raw = readJson(pinsPath(designRoot)) as { pins?: unknown } | null;
  const pins: PinsFile['pins'] = [];
  const seen = new Set<string>();
  if (raw && Array.isArray(raw.pins)) {
    for (const p of raw.pins as Array<{ canvas?: unknown; at?: unknown }>) {
      if (!p || !isCanvasKey(p.canvas) || seen.has(p.canvas)) continue;
      seen.add(p.canvas);
      pins.push({ canvas: p.canvas, at: Number.isFinite(p.at) ? Number(p.at) : 0 });
    }
  }
  return { v: 1, pins };
}

export function readRecent(designRoot: string): RecentFile {
  const raw = readJson(recentPath(designRoot)) as { opened?: unknown } | null;
  const opened: Record<string, number> = {};
  if (raw?.opened && typeof raw.opened === 'object' && !Array.isArray(raw.opened)) {
    for (const [k, at] of Object.entries(raw.opened as Record<string, unknown>)) {
      if (isCanvasKey(k) && Number.isFinite(at)) opened[k] = Number(at);
    }
  }
  return { v: 1, opened };
}

/** Pin or unpin one canvas. Returns the file as written. */
export function setPin(designRoot: string, canvas: string, pinned: boolean, now = Date.now()) {
  if (!isCanvasKey(canvas)) throw new Error('not a canvas key');
  const file = readPins(designRoot);
  const has = file.pins.some((p) => p.canvas === canvas);
  if (pinned === has) return file;
  file.pins = pinned
    ? [...file.pins, { canvas, at: now }].slice(-PINS_CAP)
    : file.pins.filter((p) => p.canvas !== canvas);
  writeAtomic(pinsPath(designRoot), file);
  return file;
}

/** "Opened just now" for one canvas; ≤ RECENT_CAP entries, the oldest dropped. */
export function stampRecent(designRoot: string, canvas: string, now = Date.now()): RecentFile {
  if (!isCanvasKey(canvas)) throw new Error('not a canvas key');
  const file = readRecent(designRoot);
  file.opened[canvas] = now;
  const entries = Object.entries(file.opened);
  if (entries.length > RECENT_CAP) {
    entries.sort((a, b) => b[1] - a[1]);
    file.opened = Object.fromEntries(entries.slice(0, RECENT_CAP));
  }
  writeAtomic(recentPath(designRoot), file);
  return file;
}

/**
 * A canvas (or a folder of canvases) moved: carry its pin and its "last opened" to the new key.
 * `moves` is [fromRel, toRel] per canvas. One read-modify-write per file; a file the move does not
 * touch is not rewritten.
 */
export function rekeyUserState(designRoot: string, moves: Array<[string, string]>) {
  const map = new Map(moves.filter(([a, b]) => isCanvasKey(a) && isCanvasKey(b) && a !== b));
  if (!map.size) return;
  const pins = readPins(designRoot);
  let pinsChanged = false;
  const seen = new Set<string>();
  const nextPins: PinsFile['pins'] = [];
  for (const p of pins.pins) {
    const to = map.get(p.canvas);
    if (to) pinsChanged = true;
    const canvas = to ?? p.canvas;
    if (seen.has(canvas)) continue;
    seen.add(canvas);
    nextPins.push({ canvas, at: p.at });
  }
  if (pinsChanged) writeAtomic(pinsPath(designRoot), { v: 1, pins: nextPins });

  const recent = readRecent(designRoot);
  let recentChanged = false;
  const opened: Record<string, number> = {};
  for (const [k, at] of Object.entries(recent.opened)) {
    const to = map.get(k);
    if (to) recentChanged = true;
    const key = to ?? k;
    opened[key] = Math.max(opened[key] ?? 0, at);
  }
  if (recentChanged) writeAtomic(recentPath(designRoot), { v: 1, opened });
}

/** A canvas went to the trash: its pin goes with it (§5.5). Its "last opened" ages out on its own. */
export function dropPin(designRoot: string, canvas: string) {
  if (!isCanvasKey(canvas)) return;
  const file = readPins(designRoot);
  if (!file.pins.some((p) => p.canvas === canvas)) return;
  writeAtomic(pinsPath(designRoot), {
    v: 1,
    pins: file.pins.filter((p) => p.canvas !== canvas),
  });
}
