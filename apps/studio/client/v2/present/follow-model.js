// client/v2/present/follow-model.js — S3.7a: what the follow bar says (04 Modes md-present-link). Pure.
//
// Input: the follower canvas's last `present-follow-state` (already through the dgn table, so ints are
// bounded and `presenterName` ≤ 64). Output: words and one action, rendered as TEXT only.
//
//   waiting   "Waiting for the presenter…"
//   live      "● Live · <avatar> <name> is on 6 of 14"
//   drifted   "<name> is on 6 of 14 · you're on 5"   + Catch up (primary)
//   ended     "<name> ended the presentation"        + Open the canvas (a role that may open it)
import { watchersLabel } from '../../../present/follow.ts';

const NAME_MAX = 64;

/** The page re-clamps what the (untrusted) canvas sent: control and bidi characters out, ≤ 64. */
export function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  let out = '';
  for (const ch of raw) {
    const cp = ch.codePointAt(0) ?? 0;
    const unsafe =
      cp <= 0x1f ||
      (cp >= 0x7f && cp <= 0x9f) ||
      (cp >= 0x200b && cp <= 0x200f) ||
      (cp >= 0x202a && cp <= 0x202e) ||
      (cp >= 0x2066 && cp <= 0x2069) ||
      cp === 0xfeff;
    if (!unsafe) out += ch;
  }
  return out.trim().slice(0, NAME_MAX);
}

/**
 * @param {null | {live:boolean, sid:string|null, presenterName:string, presenterIndex:number,
 *   index:number, total:number, watchers:number, ended:boolean}} s
 * @returns {{ phase:'waiting'|'live'|'drifted'|'ended', name:string, live:boolean, presenterAt:string,
 *   youAt:string, watchers:string, action:null|'catch-up'|'open-canvas' }}
 */
export function followBarModel(s) {
  const name = cleanName(s?.presenterName) || 'The presenter';
  const watchers = watchersLabel(s?.watchers ?? 1);
  if (!s || s.sid === null || (s.total === 0 && !s.ended)) {
    return {
      phase: 'waiting',
      name,
      live: false,
      presenterAt: '',
      youAt: '',
      watchers,
      action: null,
    };
  }
  if (s.ended) {
    return {
      phase: 'ended',
      name,
      live: false,
      presenterAt: '',
      youAt: '',
      watchers,
      action: 'open-canvas',
    };
  }
  const presenterAt = `${s.presenterIndex + 1} of ${s.total}`;
  const youAt = `${s.index + 1}`;
  if (s.live)
    return { phase: 'live', name, live: true, presenterAt, youAt, watchers, action: null };
  return { phase: 'drifted', name, live: false, presenterAt, youAt, watchers, action: 'catch-up' };
}
