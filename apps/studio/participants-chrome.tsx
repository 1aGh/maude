/**
 * @file       participants-chrome.tsx — top-right avatar stack of live peers
 * @scope      apps/studio/participants-chrome.tsx
 * @purpose    Phase 8 Task 6 — show who's currently on the canvas. Colored
 *             initials in a circle per peer, with a popover for full name +
 *             "Follow" button. Follow mode publishes `followTarget` on my
 *             Awareness; a separate effect pulls the target's viewport on
 *             every update and calls controller.setViewport, snapping my pan
 *             + zoom to theirs in lockstep.
 *
 * Follow semantics — soft and one-way. The target peer doesn't know they're
 * being followed (no UI, no Awareness echo). Either party panning the canvas
 * breaks nothing on the other end; I just keep mirroring until I click my
 * own avatar to release. tldraw-style.
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { canvasModeStore } from './bridge/canvas-mode-store.ts';
import { PEER_NAME_MAX, PEERS_MAX } from './bridge/dgn-protocol.ts';
import { useArtboardsContext, useViewportControllerContext } from './canvas-lib.tsx';
import {
  canSummonWith,
  type PresenceDeps,
  PresenceOverlay,
  runPresenceAction,
  usePresence,
} from './presence/canvas-presence.tsx';
import { surfaceFromSearch } from './presence/fields.ts';
import { isEmbedCanvas } from './read-only-mode.ts';
import { type AgentPresence, useAgentPresence } from './use-agent-presence.tsx';
import { type ForeignAwareness, useCollab, useForeignAwareness } from './use-collab.tsx';

const CHROME_CSS = `
.dc-participants {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 10000;
  display: flex;
  align-items: center;
  pointer-events: auto;
  font-family: system-ui, -apple-system, sans-serif;
}
.dc-participant {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.02em;
  color: oklch(0.180 0.030 268);
  border: 1.5px solid var(--maude-chrome-bg-0, #fff);
  margin-left: -6px;
  cursor: pointer;
  position: relative;
  box-shadow: 0 1px 2px rgba(0,0,0,0.08);
  user-select: none;
  transition: transform 120ms ease, z-index 0ms 120ms;
}
.dc-participant:first-child { margin-left: 0; }
.dc-participant:hover {
  transform: scale(1.06);
  z-index: 10;
  transition-delay: 0ms;
}
.dc-participant:focus-visible {
  outline: 2px solid var(--maude-hud-accent, oklch(56% 0.170 50));
  outline-offset: 2px;
}
.dc-participant--following {
  outline: 1.5px solid var(--maude-hud-accent, oklch(56% 0.170 50));
  outline-offset: 1.5px;
}
.dc-participant-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 168px;
  padding: 10px 12px;
  background: var(--maude-chrome-bg-1, #fff);
  color: var(--maude-chrome-fg-0, #111);
  border: 1px solid var(--maude-chrome-border, rgba(0,0,0,0.16));
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.35;
  white-space: nowrap;
  box-shadow: 0 6px 18px var(--maude-chrome-shadow, rgba(0,0,0,0.10));
  z-index: 11;
}
.dc-participant-popover__name {
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--maude-chrome-fg-0, #111);
  letter-spacing: 0.01em;
}
.dc-participant-popover__btn {
  display: inline-block;
  padding: 4px 10px;
  background: var(--maude-hud-accent, oklch(56% 0.170 50));
  color: var(--maude-hud-accent-fg, #fff);
  border: none;
  border-radius: 2px;
  font-family: inherit;
  font-weight: 500;
  font-size: 11px;
  line-height: 1.3;
  cursor: pointer;
  letter-spacing: 0.02em;
}
.dc-participant-popover__btn:hover { background: var(--maude-hud-accent-hover, var(--maude-hud-accent, oklch(50% 0.170 50))); }
.dc-participant-popover__btn--stop {
  background: color-mix(in oklab, var(--maude-chrome-fg-0, #111) 10%, transparent);
  color: var(--maude-chrome-fg-0, #111);
  border: 1px solid var(--maude-chrome-border, rgba(0,0,0,0.12));
}
.dc-participant-popover__btn--stop:hover { background: color-mix(in oklab, var(--maude-chrome-fg-0, #111) 16%, transparent); }
@media (prefers-reduced-motion: reduce) {
  .dc-participant { transition: none; }
}
/* Phase 13.2 / DDR-078 — agent presence avatar. Looks like a peer chip + a
   subtle ✦ marker so an agent reads as distinct from a human collaborator. */
.dc-participant--agent { box-shadow: 0 1px 2px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04); }
.dc-participant-agent-marker {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--maude-chrome-bg-0, #fff);
  color: var(--maude-chrome-fg-0, #111);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  line-height: 1;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.14);
  pointer-events: none;
}
.dc-participant-popover__sub {
  font-size: 11px;
  color: var(--maude-chrome-fg-2, #666);
  margin-top: -4px;
  margin-bottom: 6px;
  white-space: normal;
  max-width: 200px;
}
/* Phase 30 / DDR-120 — soft editing-presence. A peer (or a bridged agent)
   actively editing this canvas gets a gently-pulsing ring + a ✎ marker in the
   peer's OWN identity hue (--dc-edit-ring, set inline from peer.color) so the
   agent pulses violet, not the indigo accent. A heads-up, never a lock. */
.dc-participant--editing { animation: dc-participant-edit-pulse 1.8s ease-in-out infinite; }
@keyframes dc-participant-edit-pulse {
  0%, 100% { box-shadow: 0 1px 2px rgba(0,0,0,0.08), 0 0 0 2px var(--dc-edit-ring, var(--maude-hud-accent, oklch(56% 0.170 50))); }
  50% { box-shadow: 0 1px 2px rgba(0,0,0,0.08), 0 0 0 4px color-mix(in oklab, var(--dc-edit-ring, var(--maude-hud-accent, oklch(56% 0.170 50))) 45%, transparent); }
}
.dc-participant-edit-marker {
  position: absolute;
  right: -3px;
  top: -3px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--maude-chrome-bg-0, #fff);
  color: var(--dc-edit-ring, var(--maude-hud-accent, oklch(56% 0.170 50)));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  line-height: 1;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.14);
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .dc-participant--editing { animation: none; box-shadow: 0 1px 2px rgba(0,0,0,0.08), 0 0 0 2px var(--dc-edit-ring, var(--maude-hud-accent, oklch(56% 0.170 50))); }
}
`.trim();

function ensureChromeStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dc-participants-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-participants-css';
  s.textContent = CHROME_CSS;
  document.head.appendChild(s);
}

/**
 * Phase 30 / DDR-120 — true when a foreign peer is THIS machine's own
 * server-side editing echo: a peer carrying my own name with editing set but
 * no cursor/selection. That's the room's projection of my own agent/inspector
 * edit (which I already see via the local ai-activity avatar), so I skip it. A
 * remote peer never matches (different name), so they still get the heads-up.
 */
function isOwnEditingEcho(peer: ForeignAwareness, myName: string | undefined): boolean {
  return peer.name === myName && !!peer.editing && !peer.cursor && !peer.selection;
}

function initialsFor(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const first = parts[0] ?? '';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const second = parts[1] ?? '';
  return ((first[0] ?? '') + (second[0] ?? '')).toUpperCase();
}

interface AvatarProps {
  peer: ForeignAwareness;
  isFollowing: boolean;
  onToggleFollow: (clientID: number) => void;
}

function Avatar({ peer, isFollowing, onToggleFollow }: AvatarProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editing = !!peer.editing;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const cls = `dc-participant${isFollowing ? ' dc-participant--following' : ''}${editing ? ' dc-participant--editing' : ''}`;
  // `--dc-edit-ring` drives the editing pulse/marker off the peer's own hue.
  const style = (
    editing ? { background: peer.color, '--dc-edit-ring': peer.color } : { background: peer.color }
  ) as React.CSSProperties;
  return (
    <div
      ref={rootRef}
      className={cls}
      style={style}
      onClick={() => setOpen((v) => !v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setOpen((v) => !v);
        }
      }}
      role="button"
      tabIndex={0}
      title={editing ? `${peer.name} — editing this canvas` : peer.name}
      aria-label={editing ? `${peer.name}, editing this canvas` : peer.name}
      aria-expanded={open}
    >
      {initialsFor(peer.name)}
      {editing && (
        <span className="dc-participant-edit-marker" aria-hidden="true">
          ✎
        </span>
      )}
      {open && (
        <div className="dc-participant-popover" onClick={(e) => e.stopPropagation()}>
          <div className="dc-participant-popover__name">{peer.name}</div>
          {editing && <div className="dc-participant-popover__sub">Editing this canvas</div>}
          <button
            type="button"
            className={`dc-participant-popover__btn${isFollowing ? ' dc-participant-popover__btn--stop' : ''}`}
            onClick={() => {
              onToggleFollow(peer.clientID);
              setOpen(false);
            }}
          >
            {isFollowing ? 'Stop following' : `Follow ${peer.name.split(/\s+/)[0]}`}
          </button>
        </div>
      )}
    </div>
  );
}

// Phase 13.2 / DDR-078 — an agent rendered as a presence peer. No "Follow"
// (an agent has no viewport to mirror); a ✦ marker + an "AI agent" popover
// subtitle distinguish it from a human collaborator.
function AgentAvatar({ agent }: { agent: AgentPresence }): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="dc-participant dc-participant--agent"
      style={{ background: agent.color }}
      onClick={() => setOpen((v) => !v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setOpen((v) => !v);
        }
      }}
      role="button"
      tabIndex={0}
      title={`${agent.name} (AI agent)`}
      aria-label={`${agent.name}, AI agent`}
      aria-expanded={open}
    >
      {initialsFor(agent.name)}
      <span className="dc-participant-agent-marker" aria-hidden>
        ✦
      </span>
      {open && (
        <div className="dc-participant-popover" onClick={(e) => e.stopPropagation()}>
          <div className="dc-participant-popover__name">{agent.name}</div>
          <div className="dc-participant-popover__sub">AI agent · {agent.author}</div>
        </div>
      )}
    </div>
  );
}

/** Inside the Maude shell (an iframe that is not an embed): the cluster owns the faces. */
export function isHostedByShell(): boolean {
  return typeof window !== 'undefined' && window.parent !== window && !isEmbedCanvas();
}

/** The `peers` payload: the table's caps applied here too, so an honest canvas never trips them.
 *  Names only — the cluster draws initials, so no colour crosses. */
export function peersPayload(
  list: readonly (Pick<ForeignAwareness, 'clientID' | 'name'> &
    Partial<
      Pick<ForeignAwareness, 'artboard' | 'idleSince' | 'surface' | 'inComments' | 'summon'>
    >)[],
  followTarget: number | null = null
): Array<{
  clientID: number;
  name: string;
  following?: boolean;
  artboard?: string;
  idleSince?: number;
  surface?: 'browser';
  inComments?: boolean;
}> {
  return list.slice(0, PEERS_MAX).map((p) => {
    const out: ReturnType<typeof peersPayload>[number] = {
      clientID: p.clientID,
      name: String(p.name ?? '').slice(0, PEER_NAME_MAX),
    };
    if (p.clientID === followTarget) out.following = true;
    // S9.23 — presence, only when it says something (a quiet peer's entry is the pre-v2 shape).
    if (p.artboard) out.artboard = p.artboard;
    if (p.idleSince) out.idleSince = p.idleSince;
    if (p.surface === 'browser') out.surface = 'browser';
    if (p.inComments) out.inComments = true;
    return out;
  });
}
const peerListKey = (list: readonly ForeignAwareness[]) =>
  list
    .map(
      (p) =>
        `${p.clientID}:${p.name}:${p.artboard ?? ''}:${p.idleSince ?? ''}:${p.surface ?? ''}:${p.inComments ? 1 : 0}:${p.summon?.id ?? ''}`
    )
    .join('|');

export function ParticipantsChrome(): JSX.Element | null {
  ensureChromeStyles();
  const collab = useCollab();
  const peers = useForeignAwareness();
  const agent = useAgentPresence();
  const controller = useViewportControllerContext();
  const world = useArtboardsContext();

  // Phase 30 / DDR-120 — drop the authoring machine's own server-side editing
  // echo: a foreign peer carrying MY name with editing set but no cursor/
  // selection is the room's projection of my own agent/inspector edit, which I
  // already see via the local ai-activity avatar. A remote peer never matches
  // (different name), so they still get the "X is editing" heads-up.
  const myName = collab?.myName;
  const visiblePeers = useMemo(
    () => peers.filter((p) => !isOwnEditingEcho(p, myName)),
    [peers, myName]
  );

  // S9.23 — presence (publish, Follow, Go to, Bring everyone here) lives in presence/canvas-presence.tsx;
  // this component hands it the live collaborators through a ref so its deps keep one identity.
  const live = useRef({ collab, controller, world });
  live.current = { collab, controller, world };
  const deps = useMemo<PresenceDeps>(
    () => ({
      publish: (patch) => live.current.collab?.publishAwareness(patch as never),
      myClientID: () => live.current.collab?.awareness.clientID ?? -1,
      myCursor: () => live.current.collab?.awareness.getLocalState()?.cursor ?? null,
      setViewport: (v) => live.current.controller?.setViewport(v),
      frameArtboard: (id) => {
        const rect = live.current.world?.rectFor(id);
        if (!rect || !live.current.controller) return false;
        live.current.controller.jumpTo(rect);
        return true;
      },
      camera: () => live.current.controller?.viewport ?? null,
      viewCentre: () => {
        const host = live.current.world?.hostRef.current;
        const vp = live.current.controller?.viewport;
        if (!host || !vp) return null;
        return {
          x: (host.clientWidth / 2 - vp.x) / vp.zoom,
          y: (host.clientHeight / 2 - vp.y) / vp.zoom,
        };
      },
      canSummon: () => canSummonWith(canvasModeStore(window).get().caps),
      reducedMotion: () =>
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      now: () => Date.now(),
    }),
    []
  );
  const published = useMemo(
    () => ({
      artboard: world?.activeArtboardId ?? null,
      surface: surfaceFromSearch(typeof window === 'undefined' ? '' : window.location.search),
    }),
    [world?.activeArtboardId]
  );
  const view = usePresence(visiblePeers, deps, published);
  const followTarget = view.follow.target;

  // V2-4.3b — hosted by the shell, the Share cluster shows who is here (its faces), so this stack
  // steps aside and the canvas reports its peers instead: `{dgn:'peers'}` on every change, and again
  // whenever the shell (re)seeds `set-mode` — it does that when this canvas becomes the active one,
  // and the shell takes `peers` from the active canvas only.
  const hosted = isHostedByShell();
  const peerKey = hosted ? `${peerListKey(visiblePeers)}#${followTarget ?? ''}` : '';
  // Follow / Go to / Bring everyone here / Stop come from the shell over the parent-gated `run-action`
  // lane (the faces' menu and the registry's `presence.*` rows); the state rides back on `peers`.
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    if (!hosted) return;
    const onRunAction = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const m = e.data as {
        dgn?: string;
        v?: unknown;
        id?: unknown;
        params?: Record<string, unknown>;
      } | null;
      if (m?.dgn !== 'run-action' || m.v !== 1 || typeof m.id !== 'string') return;
      runPresenceAction(viewRef.current, m.id, m.params);
    };
    window.addEventListener('message', onRunAction);
    return () => window.removeEventListener('message', onRunAction);
  }, [hosted]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `peerKey` is the list's value identity
  useEffect(() => {
    if (!hosted) return;
    const post = () => {
      try {
        window.parent.postMessage(
          { dgn: 'peers', peers: peersPayload(visiblePeers, followTarget) },
          '*'
        );
      } catch {
        /* detached */
      }
    };
    post();
    const store = canvasModeStore(window);
    let seq = store.get().modeSeq;
    return store.subscribe((s) => {
      if (s.modeSeq === seq) return;
      seq = s.modeSeq;
      post();
    });
  }, [hosted, peerKey]);
  const overlay = <PresenceOverlay view={view} camera={deps.camera()} />;
  if (hosted) return overlay;

  // Render whenever there's a visible human peer OR an active agent (so an agent
  // shows even with no human collaborators connected).
  if (visiblePeers.length === 0 && !agent) return overlay;

  return (
    <>
      <div className="dc-participants" aria-label="Active collaborators">
        {visiblePeers.map((p) => (
          <Avatar
            key={p.clientID}
            peer={p}
            isFollowing={followTarget === p.clientID}
            onToggleFollow={view.toggle}
          />
        ))}
        {agent ? <AgentAvatar key={agent.id} agent={agent} /> : null}
      </div>
      {overlay}
    </>
  );
}

export { initialsFor, isOwnEditingEcho };
