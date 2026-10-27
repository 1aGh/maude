// V2-8.17 (#121) — overlapping edits made while apart, in the legacy shared
// document (DDR-064).
//
// The shared Y.Text merges two concurrent edits of the same span character by
// character: two peers who retitled one canvas while the hub was out of reach
// both came back to "tedemmatigner frozenfrozen", and nobody was told. Accepted
// revisions (DDR-241) answer it with acceptance order; the legacy mode is the
// default for existing projects, so it needs its own answer, on the client,
// with nothing new asked of the hub (a 1.x peer and a 1.x hub stay as they are).
//
// THE EPISODE. A local edit enters the document; until the hub has acknowledged
// every change this connection sent (Hocuspocus `SyncStatus`, the provider's
// `unsyncedChanges` reaching 0), the edit is unconfirmed. A remote change that
// arrives in that window was taken by the hub BEFORE ours: the hub answers each
// update synchronously — apply, broadcast to every socket, then acknowledge the
// sender — so on every socket the order of "their change" and "our ack" is the
// order the hub took them in. That makes the side that sees a remote change
// while its own is unconfirmed exactly the side whose edit the hub took second:
// the same peer accepted revisions would have rejected (decision
// v2-p8-offline-resume-is-acceptance-order). It is the only side that acts.
//
// THEIRS. The document's own update event cannot say what the remote side
// wrote: it carries only what was NEW here, and a span both sides deleted is
// not new. So the raw update as the hub sent it is replayed onto a SHADOW
// document built from the state our edit was made on — base + their changes,
// none of ours. Overlap is then the rule a live save already uses
// (`mergeSource`, source-merge.ts): edits that touch. Non-touching edits are
// left to the CRDT merge, exactly as before.
//
// WHEN THE ORDER SAYS NOTHING (V2-8.9 final review, M1). "Their change before
// our ack" means "the hub took theirs first" only while ONE connection carried
// both. If our edit went out and the socket dropped before its ack, the hub may
// already hold it, and a teammate may have built on it; the reconnect then
// replays their work onto a shadow that lacks ours, and that shadow's body is
// one nobody wrote. So the check stands down — back to the CRDT merge, which
// keeps what both sides wrote — whenever it cannot state the remote side truly:
//   - a drop while any edit of the episode may have reached the hub ends it
//     (the next edit opens a new one, on a base that holds the edit in flight,
//     so the shadow lacks nothing a teammate could have built on);
//   - a remote update the shadow cannot fully apply (Yjs left structs or
//     deletes pending) depends on something the shadow lacks — our edit — so
//     it was not taken before ours, whatever the socket said.
// An edit made while the socket was down has reached no hub, so the failed
// reconnect attempts that follow leave its episode open: that is #121's case.

import * as decoding from 'lib0/decoding';
import * as Y from 'yjs';

import { htmlFromDoc } from './codec.ts';
import { MAX_HTML_BYTES } from './limits.ts';
import { mergeSource } from './source-merge.ts';

/** Hocuspocus `MessageType.Sync`; y-protocols sync step 2 and update. */
const MESSAGE_SYNC = 0;
const SYNC_STEP_2 = 1;
const SYNC_UPDATE = 2;

/**
 * The document update a raw Hocuspocus message carries, or null for every other
 * message (awareness, auth, stateless, sync status, sync step 1) and for bytes
 * that do not parse. Wire shape: varString document name, varUint message type,
 * then y-protocols' varUint sync type + varUint8Array update.
 */
export function syncUpdateFromMessage(data: Uint8Array): Uint8Array | null {
  try {
    const d = decoding.createDecoder(data);
    decoding.readVarString(d);
    if (decoding.readVarUint(d) !== MESSAGE_SYNC) return null;
    const type = decoding.readVarUint(d);
    if (type !== SYNC_STEP_2 && type !== SYNC_UPDATE) return null;
    return decoding.readVarUint8Array(d);
  } catch {
    return null;
  }
}

/** What both sides did to one canvas body while apart. */
export interface OfflineOverlap {
  /** The body both sides last shared. */
  base: string;
  /** This side's body (what this disk holds). */
  mine: string;
  /** The remote side's body — the version the hub took first. */
  theirs: string;
}

export interface OverlapWatch {
  /** Is a local edit waiting for the hub's acknowledgement? */
  readonly open: boolean;
  /**
   * A local body edit is about to enter `doc`. The first one of an episode
   * captures the state it was made on; later ones keep that base.
   */
  beforeLocal(doc: Y.Doc): void;
  /** The body this side holds after its edit landed. */
  afterLocal(mine: string): void;
  /** A raw update from the hub (before the provider applies it). */
  remote(update: Uint8Array): void;
  /** The hub acknowledged every change this connection sent. */
  confirmed(): void;
  /**
   * The provider's socket went up (`true`) or down (`false`). A drop while an
   * edit of the episode may have reached the hub ends the episode.
   */
  connection(up: boolean): void;
  /**
   * After a remote change reached the document: did it touch our unconfirmed
   * edit? Returns the three bodies (and ends the episode) when it did.
   */
  check(): OfflineOverlap | null;
}

/** Bound on what one episode keeps — past it the episode is dropped (pre-V2-8.17 behaviour). */
const MAX_EPISODE_BYTES = 4 * MAX_HTML_BYTES;
const MAX_EPISODE_UPDATES = 512;

interface Episode {
  baseState: Uint8Array;
  baseText: string;
  mine: string;
  shadow: Y.Doc | null;
  bytes: number;
  updates: number;
  /** Was the socket up at any moment of the episode (its edits may have reached the hub)? */
  exposed: boolean;
}

export function createOverlapWatch(): OverlapWatch {
  let ep: Episode | null = null;
  /** Unknown until the provider says — assume up, so a drop ends what it can. */
  let online = true;

  function end(): void {
    ep?.shadow?.destroy();
    ep = null;
  }

  return {
    get open() {
      return ep !== null;
    },
    beforeLocal(doc) {
      if (ep) return;
      const baseText = htmlFromDoc(doc);
      ep = {
        baseState: Y.encodeStateAsUpdate(doc),
        baseText,
        mine: baseText,
        shadow: null,
        bytes: 0,
        updates: 0,
        exposed: online,
      };
    },
    afterLocal(mine) {
      if (ep) ep.mine = mine;
    },
    remote(update) {
      if (!ep) return;
      ep.bytes += update.byteLength;
      ep.updates += 1;
      if (ep.bytes > MAX_EPISODE_BYTES || ep.updates > MAX_EPISODE_UPDATES) {
        end();
        return;
      }
      try {
        if (!ep.shadow) {
          ep.shadow = new Y.Doc();
          Y.applyUpdate(ep.shadow, ep.baseState);
        }
        Y.applyUpdate(ep.shadow, update);
        // Taken before ours, it could not depend on ours: pending state means
        // it does, so the hub's order is not what this episode assumed.
        if (ep.shadow.store.pendingStructs || ep.shadow.store.pendingDs) end();
      } catch {
        // An update this replica cannot read says nothing reliable about the
        // remote side's body; leave the merge to the CRDT, as before.
        end();
      }
    },
    confirmed() {
      end();
    },
    connection(up) {
      online = up;
      if (!ep) return;
      if (up) ep.exposed = true;
      else if (ep.exposed) end();
    },
    check() {
      if (!ep?.shadow) return null;
      const theirs = htmlFromDoc(ep.shadow);
      const { baseText: base, mine } = ep;
      if (theirs === base || theirs === mine || mine === base) return null;
      if (mergeSource(base, mine, theirs).ok) return null;
      end();
      return { base, mine, theirs };
    },
  };
}
