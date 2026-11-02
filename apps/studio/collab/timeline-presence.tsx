// collab/timeline-presence.tsx — S7.17 (07 · ve-together): the canvas's half of working on one video together.
//
// The shell has no awareness connection; the canvas has one (S3-present-session §1). So this layer, mounted in
// the canvas's editing chrome, does three things and renders nothing:
//
//   1. publishes THIS person's playhead — `timeline: { artboardId, frame }` — while one whole video artboard is
//      selected (the timeline island is up on it), throttled to a few updates a second; null otherwise;
//   2. publishes the caption word this person is fixing — `editing: { since, kind: 'caption-word', … }` — as the
//      shell says over `timeline-word` (the Transcript panel's field); `{ artboardId: null }` clears it;
//   3. reports the teammates' playheads and words to the shell (`timeline-peers`), from the awareness the trust
//      boundary already sanitized (`useForeignAwareness`), so the island draws them.
//
// The words of the lock are the shell's ("Tereza is fixing a caption"); its rules are collab/timeline-awareness.ts.

import { useEffect, useMemo, useRef } from 'react';

import { acceptFromShell, PEER_NAME_MAX, PEERS_MAX } from '../bridge/dgn-protocol.ts';
import { artboardKindOf } from '../editing/anchor-report.ts';
import { articleOf } from '../editing/empty-report.ts';
import { selectedArtboardOf } from '../editing/empty-reporter.tsx';
import { type ForeignAwareness, useCollab, useForeignAwareness } from '../use-collab.tsx';
import { useSelectionSet } from '../use-selection-set.tsx';
import { playheadFrameOf, usePlayhead } from '../video-comp.tsx';
import {
  type CaptionWordEditing,
  captionWordOf,
  isWordKey,
  type TimelineAwareness,
} from './timeline-awareness.ts';

/** A playhead update goes out at most this often while it moves (the last one always lands). */
export const HEAD_THROTTLE_MS = 250;

export interface TimelinePublisherDeps {
  publish(patch: {
    timeline?: TimelineAwareness | null;
    editing?: CaptionWordEditing | null;
  }): void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export interface TimelinePublisher {
  /** Where my playhead is (null = no video artboard followed). */
  head(artboardId: string | null, frame: number | null): void;
  /** The caption word I am in (null = I left it). */
  word(artboardId: string | null, wordKey?: string | null): void;
  dispose(): void;
}

/**
 * The local publisher: a playhead throttled (leading + trailing) to HEAD_THROTTLE_MS, a word at once. Nothing is
 * re-sent when nothing changed, so a re-render costs no awareness update.
 */
export function createTimelinePublisher(deps: TimelinePublisherDeps): TimelinePublisher {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimer ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let sentHead: string | null = null; // `${artboardId}@${frame}` last published, 'none' after a clear
  let pendingHead: TimelineAwareness | null | undefined;
  let lastHeadAt = Number.NEGATIVE_INFINITY;
  let timer: unknown = null;
  let sentWord: string | null = null;

  const keyOf = (t: TimelineAwareness | null) => (t ? `${t.artboardId}@${t.frame}` : 'none');
  function flush(): void {
    timer = null;
    if (pendingHead === undefined) return;
    const next = pendingHead;
    pendingHead = undefined;
    const key = keyOf(next);
    if (key === sentHead) return;
    sentHead = key;
    lastHeadAt = now();
    deps.publish({ timeline: next });
  }
  return {
    head(artboardId, frame) {
      const next =
        artboardId && typeof frame === 'number' && Number.isInteger(frame) && frame >= 0
          ? { artboardId, frame }
          : null;
      if (keyOf(next) === sentHead && timer === null) return;
      pendingHead = next;
      // leaving the video is said at once; a moving playhead waits for its slot
      const wait = next === null ? 0 : Math.max(0, lastHeadAt + HEAD_THROTTLE_MS - now());
      if (wait === 0) {
        if (timer !== null) clearTimer(timer);
        flush();
      } else if (timer === null) {
        timer = setTimer(flush, wait);
      }
    },
    word(artboardId, wordKey) {
      const next: CaptionWordEditing | null =
        artboardId && isWordKey(wordKey)
          ? { since: now(), kind: 'caption-word', artboardId, wordKey }
          : null;
      const key = next ? `${next.artboardId}|${next.wordKey}` : 'none';
      if (key === (sentWord ?? 'none')) return;
      sentWord = key;
      deps.publish({ editing: next });
    },
    dispose() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}

export interface TimelinePeerEntry {
  clientID: number;
  name: string;
  artboardId: string;
  frame?: number;
  word?: string;
}

/**
 * The `timeline-peers` payload: every teammate with a playhead or a caption word, the table's caps applied here
 * too (an honest canvas never trips them). A peer's word is on its own artboard; a playhead elsewhere is kept.
 */
export function timelinePeersPayload(peers: readonly ForeignAwareness[]): TimelinePeerEntry[] {
  const out: TimelinePeerEntry[] = [];
  for (const p of peers) {
    if (out.length >= PEERS_MAX) break;
    const word = captionWordOf(p.editing);
    const head = p.timeline ?? null;
    if (!head && !word) continue;
    const name = String(p.name ?? '').slice(0, PEER_NAME_MAX);
    if (head) {
      const e: TimelinePeerEntry = {
        clientID: p.clientID,
        name,
        artboardId: head.artboardId,
        frame: head.frame,
      };
      if (word && word.artboardId === head.artboardId) e.word = word.wordKey;
      out.push(e);
      if (word && word.artboardId !== head.artboardId && out.length < PEERS_MAX)
        out.push({ clientID: p.clientID, name, artboardId: word.artboardId, word: word.wordKey });
    } else if (word) {
      out.push({ clientID: p.clientID, name, artboardId: word.artboardId, word: word.wordKey });
    }
  }
  return out;
}

/** The selected whole artboard, when it is a video (the island is up on it). */
function followedVideo(id: string | null): string | null {
  if (!id || typeof document === 'undefined') return null;
  const article = articleOf(document, id);
  return article && artboardKindOf(article) === 'video' ? id : null;
}

export function TimelinePresence(): null {
  const collab = useCollab();
  const peers = useForeignAwareness();
  const { selected } = useSelectionSet();
  const artboardId = followedVideo(selectedArtboardOf(selected));
  usePlayhead(artboardId); // re-render as the clip moves
  const frame = artboardId ? playheadFrameOf(artboardId) : null;

  const collabRef = useRef(collab);
  collabRef.current = collab;
  const pub = useMemo(
    () =>
      createTimelinePublisher({
        publish: (patch) => collabRef.current?.publishAwareness(patch),
      }),
    []
  );
  useEffect(() => () => pub.dispose(), [pub]);
  useEffect(() => {
    pub.head(artboardId, frame);
  });
  // leaving the page: no playhead, no word (awareness GC would free them too, 30 s later)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHide = () => {
      pub.head(null, null);
      pub.word(null);
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [pub]);

  // the shell says which word I am in
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      if ((e.data as { dgn?: unknown } | null)?.dgn !== 'timeline-word') return;
      const m = acceptFromShell(e, window);
      if (m?.dgn !== 'timeline-word') return;
      pub.word(m.artboardId, m.wordKey ?? null);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pub]);

  // teammates → the shell's island
  const payload = timelinePeersPayload(peers);
  const key = JSON.stringify(payload);
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return;
    if (sent.current === key) return;
    sent.current = key;
    try {
      window.parent.postMessage({ dgn: 'timeline-peers', peers: payload }, '*');
    } catch {
      /* detached */
    }
  });
  return null;
}
