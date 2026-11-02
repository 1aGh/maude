/**
 * @file       presence/model.ts — S9.23: who is here, where, and the Follow / Bring state machines.
 * @purpose    Pure rules the shell's faces (client/v2/presence/*) and the canvas's follow chrome
 *             (presence/canvas-presence.tsx) both read, so the words and the order agree on both sides:
 *               · the words      "On A4 · plakát · Can edit" · "in a browser · Can view" · "idle · 4 min"
 *               · the crowd      three faces and "+8"; the list says where each person is (co-twelve)
 *               · Follow         ends on esc / scroll / click, or when the person leaves (co-follow)
 *               · Bring          the latest `summon.at` wins; leaving one is final for that ask (co-bring)
 *               · the glide      spring 420 ms, 40 ms apart, nearest first; reduced motion = appears
 *
 * React-free, DOM-free, deterministic — `now` is always passed in. Words per CONTRACT §3–§4.
 */

import { IDLE_MS, type Summon, type Surface } from './fields.ts';
import { type PersonTone, toneFor } from './tones.ts';

/** The fields of a foreign peer this module reads (a `ForeignAwareness` satisfies it). */
export interface PresencePeer {
  clientID: number;
  name: string;
  artboard?: string | null;
  idleSince?: number | null;
  surface?: Surface;
  inComments?: boolean;
  summon?: Summon | null;
  followTarget?: number | null;
  cursor?: { x: number; y: number } | null;
}

// ── words ────────────────────────────────────────────────────────────────────────────────────────

/** CONTRACT §6: the four roles in one vocabulary. Unknown → null (the line then omits it). */
export function roleWord(role: string | null | undefined): string | null {
  switch (role) {
    case 'owner':
    case 'member':
      return 'Can edit';
    case 'viewer':
      return 'Can comment';
    case 'observer':
      return 'Can view';
    default:
      return null;
  }
}

export function firstName(name: string): string {
  const n = String(name ?? '').trim();
  return n.split(/\s+/)[0] || n;
}

/** Whole minutes idle at `now`, never below the 3 the cursor greys at. */
export function idleMinutes(idleSince: number, now: number): number {
  return Math.max(Math.floor(IDLE_MS / 60_000), Math.floor((now - idleSince) / 60_000));
}

export function idleLabel(idleSince: number, now: number): string {
  const m = idleMinutes(idleSince, now);
  return m >= 60 ? `idle · ${Math.floor(m / 60)} h` : `idle · ${m} min`;
}

export const isIdle = (p: Pick<PresencePeer, 'idleSince'>): boolean =>
  typeof p.idleSince === 'number' && p.idleSince > 0;

export interface WhereOpts {
  /** artboard id → its label, from the canvas index (null when unknown). */
  labelOf?: (id: string) => string | null | undefined;
  /** name → role id, when the hub told us. */
  roleOf?: (p: PresencePeer) => string | null | undefined;
  now: number;
}

/**
 * The line under a person's name in the list. Idle wins (it is what the cursor shows); then the
 * Comments panel; then the artboard they are on; then the browser.
 */
export function whereOf(p: PresencePeer, { labelOf, roleOf, now }: WhereOpts): string {
  if (isIdle(p)) return idleLabel(p.idleSince as number, now);
  const role = roleWord(roleOf?.(p));
  const browser = p.surface === 'browser';
  if (p.inComments) return 'in Comments';
  const board = p.artboard ? (labelOf?.(p.artboard) ?? null) : null;
  if (board) return browser ? `${board} · in a browser` : board;
  if (browser) return role ? `in a browser · ${role}` : 'in a browser';
  return 'on this canvas';
}

/** The face menu's header line: "On A4 · plakát · Can edit". */
export function menuSubline(p: PresencePeer, { labelOf, roleOf, now }: WhereOpts): string {
  if (isIdle(p))
    return [idleLabel(p.idleSince as number, now), roleWord(roleOf?.(p))]
      .filter(Boolean)
      .join(' · ');
  const board = p.artboard ? (labelOf?.(p.artboard) ?? null) : null;
  const where = p.inComments ? 'In Comments' : board ? `On ${board}` : 'On this canvas';
  return [where, roleWord(roleOf?.(p))].filter(Boolean).join(' · ');
}

// ── the crowd ────────────────────────────────────────────────────────────────────────────────────

/** Faces drawn before the "+N" (co-twelve: three faces and +8). */
export const FACES_SHOWN = 3;

/** Active people first (so a crowd's faces are people who are here), then the idle ones. */
export function orderPeers<T extends PresencePeer>(peers: readonly T[]): T[] {
  const active = peers.filter((p) => !isIdle(p));
  const idle = peers
    .filter(isIdle)
    .sort((a, b) => (b.idleSince as number) - (a.idleSince as number));
  return [...active, ...idle];
}

export function collapseFaces<T extends PresencePeer>(
  peers: readonly T[],
  shown: number = FACES_SHOWN
): { shown: T[]; more: number } {
  const ordered = orderPeers(peers);
  if (ordered.length <= shown) return { shown: ordered, more: 0 };
  return { shown: ordered.slice(0, shown), more: ordered.length - shown };
}

export interface PeopleRow {
  clientID: number;
  name: string;
  tone: PersonTone;
  where: string;
  idle: boolean;
}

export interface PeopleList {
  heading: string;
  sub: string;
  rows: PeopleRow[];
}

/** "12 on Combine-kampan · you + 11", then a row per person with where they are. */
export function peopleList(
  peers: readonly PresencePeer[],
  opts: WhereOpts & { canvasLabel: string }
): PeopleList {
  const total = peers.length + 1;
  const heading =
    total === 1 ? `Just you on ${opts.canvasLabel}` : `${total} on ${opts.canvasLabel}`;
  const sub = total === 1 ? '' : `you + ${total - 1}`;
  const rows = orderPeers(peers).map((p) => ({
    clientID: p.clientID,
    name: p.name,
    tone: toneFor(p.name),
    where: whereOf(p, opts),
    idle: isIdle(p),
  }));
  return { heading, sub, rows };
}

// ── Bring everyone here ──────────────────────────────────────────────────────────────────────────

/** A Bring older than this no longer pulls someone who only just arrived (an ask is a moment). */
export const SUMMON_FRESH_MS = 10_000;
/** Clock skew we forgive in `summon.at`. */
const SUMMON_SKEW_MS = 60_000;

/** The latest Bring on the canvas wins (Q9). */
export function pickSummon(
  peers: readonly PresencePeer[],
  now: number
): { clientID: number; summon: Summon } | null {
  let best: { clientID: number; summon: Summon } | null = null;
  for (const p of peers) {
    const s = p.summon;
    if (!s || s.at > now + SUMMON_SKEW_MS) continue;
    if (!best || s.at > best.summon.at) best = { clientID: p.clientID, summon: s };
  }
  return best;
}

/** How many people's cameras follow `me` — the spotlight pill's "3 people". */
export function followersOf(peers: readonly PresencePeer[], me: number): number {
  return peers.filter((p) => p.followTarget === me).length;
}

// ── Follow ───────────────────────────────────────────────────────────────────────────────────────

export interface FollowState {
  /** The clientID whose camera mine mirrors, or null. */
  target: number | null;
  /** The Bring that put me here (null for a Follow I chose). */
  summonId: string | null;
  /** Brings I left: esc is final for that ask, so a re-publish never moves me again. */
  left: readonly string[];
}

export const NOT_FOLLOWING: FollowState = Object.freeze({ target: null, summonId: null, left: [] });
const LEFT_KEEP = 8;

export function followPeer(s: FollowState, clientID: number): FollowState {
  return { ...s, target: clientID, summonId: null };
}

export function toggleFollow(s: FollowState, clientID: number): FollowState {
  return s.target === clientID ? leaveFollow(s) : followPeer(s, clientID);
}

/** esc / a scroll / a click / the pill: my camera is mine again. A Bring I leave stays left. */
export function leaveFollow(s: FollowState): FollowState {
  if (s.target === null && s.summonId === null) return s;
  const left = s.summonId ? [...s.left, s.summonId].slice(-LEFT_KEEP) : s.left;
  return { target: null, summonId: null, left };
}

/** Which input ends a Follow: esc, the wheel (a scroll) and a pointer press outside the pill. */
export function endsFollow(e: {
  kind: 'key' | 'wheel' | 'pointer';
  key?: string;
  insidePill?: boolean;
}): boolean {
  if (e.kind === 'key') return e.key === 'Escape';
  if (e.kind === 'wheel') return true;
  return !e.insidePill;
}

/**
 * Re-evaluate after the peers moved: release when the target left or the Bring that moved me ended
 * (Stop clears the field), and join the latest fresh Bring I have not left. Returns `s` itself when
 * nothing changes, so a caller can bail out of a render.
 */
export function syncFollow(
  s: FollowState,
  peers: readonly PresencePeer[],
  now: number
): FollowState {
  let cur = s;
  const alive = (id: number | null) => id !== null && peers.some((p) => p.clientID === id);
  const best = pickSummon(peers, now);
  if (cur.target !== null) {
    if (!alive(cur.target)) cur = { ...cur, target: null, summonId: null };
    else if (cur.summonId && best?.summon.id !== cur.summonId)
      cur = { ...cur, target: null, summonId: null };
  }
  if (best && best.summon.id !== cur.summonId && !cur.left.includes(best.summon.id)) {
    if (now - best.summon.at <= SUMMON_FRESH_MS) {
      cur = { ...cur, target: best.clientID, summonId: best.summon.id };
    }
  }
  return cur.target === s.target && cur.summonId === s.summonId && cur.left === s.left ? s : cur;
}

// ── the glide ────────────────────────────────────────────────────────────────────────────────────

export const GLIDE_MS = 420;
export const GLIDE_STAGGER_MS = 40;
export const WAKE_FADE_MS = 160;
export const FRAME_DRAW_MS = 220;
/** Reduced motion collapses every duration to this (DS motion contract). */
export const REDUCED_MS = 1;

export interface GlideStep {
  clientID: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  delay: number;
  duration: number;
  /** Dotted wake in the person's colour; none under reduced motion. */
  wake: boolean;
}

/**
 * Where each cursor goes when I Bring everyone here: they land around my cursor, nearest first,
 * 40 ms apart, each on a 420 ms spring. Reduced motion = everyone appears at once, no wake.
 * People without a cursor (idle, in a browser, off-canvas) start at the landing point.
 */
export function glidePlan(
  peers: readonly PresencePeer[],
  landing: { x: number; y: number },
  reduced: boolean,
  ring = 44
): { steps: GlideStep[]; totalMs: number } {
  const dist = (p: PresencePeer) =>
    p.cursor ? Math.hypot(p.cursor.x - landing.x, p.cursor.y - landing.y) : 0;
  const ordered = [...peers].sort((a, b) => dist(a) - dist(b) || a.clientID - b.clientID);
  const n = ordered.length;
  const steps = ordered.map((p, i): GlideStep => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(n, 1);
    const to = { x: landing.x + Math.cos(angle) * ring, y: landing.y + Math.sin(angle) * ring };
    return {
      clientID: p.clientID,
      from: p.cursor ? { x: p.cursor.x, y: p.cursor.y } : { ...landing },
      to,
      delay: reduced ? 0 : i * GLIDE_STAGGER_MS,
      duration: reduced ? REDUCED_MS : GLIDE_MS,
      wake: !reduced,
    };
  });
  const totalMs =
    steps.reduce((m, s) => Math.max(m, s.delay + s.duration), 0) + (reduced ? 0 : WAKE_FADE_MS);
  return { steps, totalMs };
}
