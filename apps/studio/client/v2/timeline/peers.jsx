// client/v2/timeline/peers.jsx — S7.17 (07 · ve-together): teammates on the same video.
//
//   their playhead   a thin sky line on the track, one per teammate whose timeline follows this video
//   their word       the caption word a teammate is fixing is THEIRS until they leave it (Gate 0 A10): the tag
//                    "Tereza is fixing a caption" sits over it, the Transcript panel will not open it for you,
//                    and a clip op touching it answers `locked` before anything is sent
//   my word          the word I am fixing goes to the canvas (`timeline-word`), which publishes it on awareness
//
// A soft lock between people: advisory, so the UI refuses and no server does (V2-1.15 §13, DDR-120 kept; AI
// holds are the enforced kind). The canvas reports teammates over `timeline-peers` (already sanitized there,
// re-checked by the dgn table here — DDR-054); only the ACTIVE canvas's frame is believed.
//
// A clip op "touches" a word when it targets the clip that shows it (a word key is `src|wordId|clip`); a fix or a
// cut by transcript touches exactly the words it names.

import { useContext, useEffect, useRef, useSyncExternalStore } from 'react';

import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { ShellStoreContext } from '../../stores/shell-store.jsx';
import { useCompMedia } from '../transcript/comp-media-store.js';
import { wordKey } from '../transcript/transcript-model.js';

const NAME_MAX = 64;

// ── the store: the active canvas's teammates ────────────────────────────────────────────────────────
let state = { peers: [] };
const subs = new Set();
const emit = () => {
  for (const fn of subs) fn();
};

export const timelinePeers = {
  get: () => state,
  /** @param {Array<{ clientID: number, name: string, artboardId: string, frame?: number, word?: string }>} peers */
  set(peers) {
    state = { peers: Array.isArray(peers) ? peers : [] };
    emit();
  },
  reset() {
    if (state.peers.length === 0) return;
    state = { peers: [] };
    emit();
  },
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};

export function useTimelinePeers() {
  return useSyncExternalStore(timelinePeers.subscribe, timelinePeers.get, timelinePeers.get);
}

// ── the lane: the active canvas's `timeline-peers` ──────────────────────────────────────────────────
/**
 * @param {{ canvasOrigin: () => string, activeWin: () => Window|null,
 *   store?: { set: (peers: any[]) => void } }} deps
 */
export function createPeersLane(deps) {
  const store = deps.store ?? timelinePeers;
  return {
    onMessage(e) {
      if (e?.data?.dgn !== 'timeline-peers') return;
      const m = acceptFromCanvas(e, {
        canvasOrigin: deps.canvasOrigin(),
        active: deps.activeWin(),
      });
      if (m?.dgn !== 'timeline-peers') return;
      store.set(m.peers.map((p) => ({ ...p, name: String(p.name).slice(0, NAME_MAX) })));
    },
  };
}

/** The shell's mount (TimelineHost): always listening, so the island has its teammates the moment it rises. */
export function useTimelinePeersLane() {
  const store = useContext(ShellStoreContext);
  const core = store?.shellCore;
  const live = useRef({});
  live.current = {
    activePath: core?.activePath ?? null,
    iframesRef: core?.iframesRef,
    canvasOrigin: core?.cfg?.canvasOrigin,
  };
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const lane = createPeersLane({
      canvasOrigin: () => live.current.canvasOrigin || window.location.origin,
      activeWin: () => {
        const p = live.current.activePath;
        return p && p !== SYSTEM_TAB
          ? (live.current.iframesRef?.current?.get(p)?.contentWindow ?? null)
          : null;
      },
    });
    window.addEventListener('message', lane.onMessage);
    return () => window.removeEventListener('message', lane.onMessage);
  }, []);
  // another canvas: its people are not these people
  const activePath = core?.activePath ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: switching canvases is the trigger
  useEffect(() => {
    timelinePeers.reset();
  }, [activePath]);
}

// ── the rules ──────────────────────────────────────────────────────────────────────────────────────
/** `src|wordId|clip` → the clip's stableId (src may itself hold a `|`, the clip is the last part). */
export function clipOfWordKey(key) {
  if (typeof key !== 'string') return null;
  const i = key.lastIndexOf('|');
  return i > 0 && i < key.length - 1 ? key.slice(i + 1) : null;
}

/** The tag and the refusal, in the canvas's words (07 · ve-together). */
export const fixingText = (name) => `${name} is fixing a caption`;

/** The answer a touching op gets instead of being sent: the dispatcher's shape, code `locked`. */
export function lockedAnswer(name) {
  return { ok: false, code: 'locked', message: `${fixingText(name)}.` };
}

/** Teammates whose playhead is on this video. */
export function peerHeadsFor(peers, artboardId) {
  if (!artboardId) return [];
  return (peers ?? []).filter((p) => p.artboardId === artboardId && Number.isInteger(p.frame));
}

/** Who holds this caption word on this video, or null. */
export function wordHolder(peers, artboardId, wordKey) {
  if (!artboardId || !wordKey) return null;
  const p = (peers ?? []).find((x) => x.artboardId === artboardId && x.word === wordKey);
  return p ? p.name : null;
}

/** Who holds a caption word inside this clip of this video, or null. */
export function clipHolder(peers, artboardId, stableId) {
  if (!artboardId || !stableId) return null;
  const p = (peers ?? []).find(
    (x) => x.artboardId === artboardId && x.word && clipOfWordKey(x.word) === stableId
  );
  return p ? p.name : null;
}

/** The first of `keys` a teammate holds on this video, or null. */
export function keysHolder(peers, artboardId, keys) {
  for (const k of keys ?? []) {
    const name = wordHolder(peers, artboardId, k);
    if (name) return name;
  }
  return null;
}

/** Verbs that name no clip, or that touch words not clips (a cut by transcript is checked by its words). */
const WORD_LEVEL_VERBS = new Set([
  'insert',
  'video.captions.add',
  'video.easing.set',
  'cut-source-range',
]);

/**
 * The clip-op gate `runClipVerb` asks before it sends: the holder's name when the op touches a teammate's word.
 * @param {string} verb @param {string|null} artboardId @param {string|null} stableId
 */
export function clipOpHolder(verb, artboardId, stableId, peers = timelinePeers.get().peers) {
  if (WORD_LEVEL_VERBS.has(verb)) return null;
  return clipHolder(peers, artboardId, stableId);
}

// ── my word → the canvas ───────────────────────────────────────────────────────────────────────────
/**
 * Tell the active canvas which caption word I am fixing (null = I left it). Re-sent when the canvas or the word
 * changes; cleared on unmount.
 * @param {string|null} artboardId @param {string|null} wordKey
 */
export function useMyCaptionWord(artboardId, wordKey) {
  const store = useContext(ShellStoreContext);
  const post = store?.shellCore?.postToActiveCanvas;
  const activePath = store?.shellCore?.activePath ?? null;
  const postRef = useRef(post);
  postRef.current = post;
  const on = artboardId && wordKey ? `${artboardId}\u0000${wordKey}` : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `on` + the canvas are the value identity
  useEffect(() => {
    const send = postRef.current;
    if (!send) return undefined;
    send(
      on
        ? { dgn: 'timeline-word', artboardId, wordKey }
        : { dgn: 'timeline-word', artboardId: null }
    );
    if (!on) return undefined;
    return () => postRef.current?.({ dgn: 'timeline-word', artboardId: null });
  }, [on, activePath]);
}

// ── the view ───────────────────────────────────────────────────────────────────────────────────────
/** Where a caption word starts on this video (its first frame), from the comp's words; null when not shown. */
export function wordStart(words, key) {
  const w = (words ?? []).find((x) => wordKey(x) === key);
  return w && Number.isFinite(w.f0) ? w.f0 : null;
}

/**
 * Teammates' playheads (a thin sky line each) and, over a word one of them is fixing, their tag.
 * @param {{ canvas: string|null, artboardId: string|null, x: (frame: number) => number, gutter: number,
 *   total: number }} props
 */
export function PeerHeads({ canvas, artboardId, x, gutter, total }) {
  const { peers } = useTimelinePeers();
  const { media } = useCompMedia(canvas, artboardId);
  const wordFrame = (key) => wordStart(media?.words, key);
  if (!artboardId) return null;
  const last = Math.max(0, (total || 1) - 1);
  const clampF = (f) => Math.min(last, Math.max(0, f));
  const heads = peerHeadsFor(peers, artboardId);
  const fixing = peers.filter((p) => p.artboardId === artboardId && p.word);
  return (
    <>
      {heads.map((p) => (
        <span
          key={`h${p.clientID}`}
          className="tl-peer-head"
          data-testid={`timeline-peer-head-${p.clientID}`}
          title={p.name}
          aria-hidden="true"
          style={{ left: gutter + x(clampF(p.frame)) }}
        />
      ))}
      {fixing.map((p) => {
        const at = wordFrame(p.word) ?? (Number.isInteger(p.frame) ? p.frame : 0);
        return (
          <span
            key={`t${p.clientID}`}
            className="tl-peer-tag"
            data-testid={`timeline-peer-tag-${p.clientID}`}
            style={{ left: gutter + x(clampF(at)) }}
          >
            {fixingText(p.name)}
          </span>
        );
      })}
    </>
  );
}
