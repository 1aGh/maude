// apps/studio/present/follow.ts — S3.7a: follow the presenter (S3-present-session §2, §4). Pure.
//
// The presenter's canvas publishes `present {v, sid, index, total, artboardId, seq, media}` on its collab
// awareness; a follower canvas (the audience window, a presentation-link viewer) reads the foreign states
// — already through `sanitizeForeignState`, so every `present` here is whole or null — and decides:
//
//   which session   `sid` from the follower URL, else the first presenter it saw. Pinned to that
//                   presenter's awareness client too, so another peer copying the sid takes nothing over
//   where it is     the pinned state's artboard; a LOWER `seq` for the same sid is ignored (a late relay)
//   who watches     the foreign states whose `watching` is that sid, plus this follower itself
//   ended           the pinned presenter stopped publishing (or left)
//
// A planted canvas can only lie about its OWN artboards: whatever it publishes, the follower moves among
// the artboards of the canvas it is showing, and a malformed state never got past the sanitizer.

// Type-only from use-collab: this module is also read by the shell bundle (client/v2/present/
// follow-model.js), which must not pull the collab runtime in.
import type { ForeignAwareness, PresentAwareness } from '../use-collab.tsx';

/** The `sid` grammar (use-collab.tsx `PRESENT_SID_RE`, S3-present-session §2). */
const PRESENT_SID_RE = /^[a-z0-9]{8,32}$/;

export const WATCHERS_SHOWN_MAX = 99;

/** A fresh presentation session id: 16 of [a-z0-9] (the `sid` grammar is 8–32). */
export function newPresentSid(rand: (n: number) => Uint8Array = defaultRandom): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (const b of rand(16)) out += alphabet[b % alphabet.length];
  return out;
}

function defaultRandom(n: number): Uint8Array {
  const a = new Uint8Array(n);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(a);
  else for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
  return a;
}

export interface FollowTarget {
  sid: string;
  /** The presenter's awareness client (the pin). */
  clientID: number;
  /** Sanitized display name — rendered as text only. */
  name: string;
  index: number;
  total: number;
  artboardId: string;
  seq: number;
}

export interface FollowView {
  /** The presenter's current position, or null while waiting / once ended. */
  target: FollowTarget | null;
  /** The session this follower follows (null until one was seen). */
  sid: string | null;
  /** The pinned presenter was seen and has stopped presenting. */
  ended: boolean;
  /** People following this session, this follower included. */
  watchers: number;
  /** The last presenter name seen (kept after `ended` so the bar can say who ended it). */
  presenterName: string;
}

export interface Follower {
  /** Feed the current foreign peers (sanitized); returns what to show. */
  update(peers: readonly ForeignAwareness[]): FollowView;
}

/**
 * One follower's view of the room. `wantSid` (the URL's `sid`, already grammar-checked or null) fixes the
 * session; without it the first presenter seen is kept, and a later presenter does not take over.
 */
export function createFollower(wantSid: string | null): Follower {
  const fixed = typeof wantSid === 'string' && PRESENT_SID_RE.test(wantSid) ? wantSid : null;
  let sid: string | null = fixed;
  let pin: number | null = null;
  let last: FollowTarget | null = null;
  let seen = false;
  let ended = false;
  let name = '';

  const toTarget = (p: ForeignAwareness, present: PresentAwareness): FollowTarget => ({
    sid: present.sid,
    clientID: p.clientID,
    name: p.name,
    index: present.index,
    total: present.total,
    artboardId: present.artboardId,
    seq: present.seq,
  });

  return {
    update(peers) {
      if (sid === null) {
        // The first presenter seen: lowest clientID among those presenting right now, so two followers
        // that join together agree.
        let first: ForeignAwareness | null = null;
        for (const p of peers) {
          if (p.present && (first === null || p.clientID < first.clientID)) first = p;
        }
        if (first?.present) sid = first.present.sid;
      }
      let mine: ForeignAwareness | null = null;
      if (sid !== null) {
        for (const p of peers) {
          if (!p.present || p.present.sid !== sid) continue;
          if (pin === null || p.clientID === pin) {
            mine = p;
            break;
          }
        }
      }
      if (mine?.present) {
        if (pin === null) pin = mine.clientID;
        seen = true;
        ended = false;
        name = mine.name;
        // A lower seq for the same session is a late relay: keep where we are.
        if (!last || mine.present.seq >= last.seq) last = toTarget(mine, mine.present);
      } else if (seen) {
        ended = true;
      }
      let watchers = 1; // this follower
      if (sid !== null) for (const p of peers) if (p.watching === sid) watchers += 1;
      return {
        target: ended ? null : last,
        sid,
        ended,
        watchers,
        presenterName: name,
      };
    },
  };
}

/** "N watching", "99+" above 99. */
export function watchersLabel(n: number): string {
  const k = Math.max(0, Math.trunc(n));
  return `${k > WATCHERS_SHOWN_MAX ? `${WATCHERS_SHOWN_MAX}+` : k} watching`;
}
