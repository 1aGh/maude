// The studio room's relay strip for Present — S3.7b, S3-present-session §2 (D11).
//
// Twin of the hub's `apps/hub/src/present-strip.mjs`, for the hop the hub
// cannot see: in a cell every browser follower joins the STUDIO CHILD's room
// (`collab/room.ts`), and only the child's own provider reaches the hub. A
// read-only collab conn (a cell socket the proxy did not vouch writable) may
// watch, but may not broadcast a presentation, so its awareness frames lose
// `present` (the position followers obey) and `pointer` (the presenter's laser
// dot) before the room applies them. `watching` and every other field pass.
//
// The desktop's own tabs are the Mac owner's (readOnly false) and are never
// stripped — that is how a Can view presenter's local audience window still
// follows (D11), while the hub strips the same state on its way to anyone else.

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

import { MESSAGE_AWARENESS } from '../collab/protocol.ts';

/** The awareness keys only an editor of the canvas may publish (hub twin: PRESENTER_ONLY_FIELDS). */
export const PRESENTER_ONLY_FIELDS: readonly string[] = Object.freeze(['present', 'pointer']);

/**
 * One incoming frame with the presenter-only fields removed from every state
 * it carries. Returns the SAME array when nothing changed (or it is not an
 * awareness frame), a re-encoded frame when a field was removed, and null for
 * an awareness frame that does not decode (the caller drops it — never applied
 * unread).
 */
export function stripPresenterAwareness(payload: Uint8Array): Uint8Array | null {
  let entries: { clientID: number; clock: number; json: string }[];
  let changed = false;
  try {
    const outer = decoding.createDecoder(payload);
    if (decoding.readVarUint(outer) !== MESSAGE_AWARENESS) return payload;
    const update = decoding.readVarUint8Array(outer);
    const dec = decoding.createDecoder(update);
    const count = decoding.readVarUint(dec);
    entries = [];
    for (let i = 0; i < count; i++) {
      const clientID = decoding.readVarUint(dec);
      const clock = decoding.readVarUint(dec);
      let json = decoding.readVarString(dec);
      const state = JSON.parse(json);
      if (state && typeof state === 'object' && !Array.isArray(state)) {
        let hit = false;
        for (const key of PRESENTER_ONLY_FIELDS) {
          if (Object.hasOwn(state, key)) {
            delete state[key];
            hit = true;
          }
        }
        if (hit) {
          json = JSON.stringify(state);
          changed = true;
        }
      }
      entries.push({ clientID, clock, json });
    }
  } catch {
    return null;
  }
  if (!changed) return payload;
  const inner = encoding.createEncoder();
  encoding.writeVarUint(inner, entries.length);
  for (const e of entries) {
    encoding.writeVarUint(inner, e.clientID);
    encoding.writeVarUint(inner, e.clock);
    encoding.writeVarString(inner, e.json);
  }
  const out = encoding.createEncoder();
  encoding.writeVarUint(out, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(out, encoding.toUint8Array(inner));
  return encoding.toUint8Array(out);
}
