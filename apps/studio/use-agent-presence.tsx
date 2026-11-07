/**
 * @file       use-agent-presence.tsx — Phase 13.2 / DDR-078 agent presence.
 * @scope      apps/studio/use-agent-presence.tsx
 * @purpose    Turn the Phase 8 `ai-activity` heartbeat into a *presence* peer:
 *             when an agent (`/design:edit` / `/design:new`) is editing THIS
 *             canvas, surface it like another connected human — an avatar in the
 *             participants stack + the activity overlay (DDR-075) tinted with the
 *             agent's own color + funny name. Pure client-side synthesis: the
 *             agent is NOT injected into Yjs awareness (no protocol surgery), it
 *             is a virtual participant derived from `ai-activity`.
 *
 * MVP scope (DDR-078): ONE agent per canvas (matches `ai-activity`'s file key).
 * Multiple agents across the project each show in their own canvas tab; multiple
 * agents on the SAME file at once would need `ai-activity` multi-author and is
 * deliberately deferred. No roaming cursor (avatar + overlay only).
 *
 * Subscription mirrors `ai-banner.tsx`: parent `dgn:'ai-activity'` postMessage
 * relay when embedded, own inspector WS when standalone, plus a GET /_api/ai
 * seed so a tab opened mid-edit shows the agent immediately. Provided ONCE per
 * canvas (canvas-lib bundle) so every DCArtboard + the chrome read one context —
 * same cross-bundle rule as the activity context (DDR-077 lesson).
 */

import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

import { AGENT_COLOR } from './use-collab.tsx';

/** Wire shape of an `ai-activity` entry (matches collab/ai-activity.ts). */
export interface AiEntry {
  file: string;
  author: string;
  startedAt: number;
  lastHeartbeat: number;
}

/** A virtual presence peer derived from an active agent. */
export interface AgentPresence {
  /** Stable per-session id (`author:startedAt`) — the funny-name + color seed. */
  id: string;
  /** Funny display name, e.g. "Bouncy Otter". */
  name: string;
  /** Deterministic peer color (shared palette with human peers). */
  color: string;
  /** The real author string the slash command reported ("Claude acting for X"). */
  author: string;
  startedAt: number;
}

// ---------------------------------------------------------------------------
// Funny-name generator — deterministic from the session seed so an agent keeps
// the same name + color across heartbeats. ~20×20 = 400 combinations.

const ADJECTIVES = [
  'Bouncy',
  'Zippy',
  'Sleepy',
  'Sneaky',
  'Witty',
  'Plucky',
  'Mellow',
  'Snappy',
  'Cosmic',
  'Fuzzy',
  'Jolly',
  'Nimble',
  'Breezy',
  'Quirky',
  'Dapper',
  'Wobbly',
  'Spry',
  'Peppy',
  'Groovy',
  'Sly',
];

const ANIMALS = [
  'Otter',
  'Walrus',
  'Lynx',
  'Heron',
  'Badger',
  'Falcon',
  'Mantis',
  'Newt',
  'Quokka',
  'Tapir',
  'Gecko',
  'Marten',
  'Pangolin',
  'Axolotl',
  'Ferret',
  'Puffin',
  'Capybara',
  'Narwhal',
  'Wombat',
  'Mongoose',
];

function hash32(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** Deterministic "Adjective Animal" from a seed (e.g. `author:startedAt`). */
export function agentFunnyName(seed: string): string {
  const h = hash32(seed || 'agent');
  const adj = ADJECTIVES[h % ADJECTIVES.length] as string;
  const animal = ANIMALS[(h >>> 8) % ANIMALS.length] as string;
  return `${adj} ${animal}`;
}

/**
 * Strip control chars + length-cap the author. The run registry names the agent
 * server-side, but the postMessage relay path never round-trips the
 * server, so we re-bound it here at the trust boundary (DDR-078 security
 * follow-up) — keeps a spoofed `author` from bloating the badge even if the
 * origin guard below ever regresses.
 */
function sanitizeAuthor(a: unknown): string {
  // Keep printable chars only (drop C0/C1 controls + DEL), cap length — no
  // control-char regex needed.
  let out = '';
  for (const ch of String(a ?? '')) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) out += ch;
    if (out.length >= 120) break;
  }
  return out;
}

/** Build the virtual presence peer from an `ai-activity` entry. */
export function deriveAgent(entry: AiEntry): AgentPresence {
  const author = sanitizeAuthor(entry.author);
  const id = `${author}:${entry.startedAt}`;
  const name = agentFunnyName(id);
  // DS colors-presence contract: the agent rides --presence-agent, a hue no
  // human peer can hash to — attribution stays unambiguous on a shared canvas.
  return { id, name, color: AGENT_COLOR, author, startedAt: entry.startedAt };
}

// ---------------------------------------------------------------------------

function readMetaFile(explicit?: string): string {
  if (explicit) return explicit;
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __canvas_meta_file__?: string };
    if (typeof w.__canvas_meta_file__ === 'string') return w.__canvas_meta_file__;
  }
  return '';
}

const AgentPresenceContext = createContext<AgentPresence | null>(null);

export interface AgentPresenceProviderProps {
  /** Canvas file key (designRel-prefixed, matching the `ai-activity` key). */
  file?: string;
  /** Test/seed override — when provided, the live subscription is skipped. */
  initialAgent?: AgentPresence | null;
  children: ReactNode;
}

export function AgentPresenceProvider({
  file,
  initialAgent,
  children,
}: AgentPresenceProviderProps) {
  const myFile = readMetaFile(file);
  const [entry, setEntry] = useState<AiEntry | null>(null);

  useEffect(() => {
    if (initialAgent !== undefined) return; // seeded (tests) — no live wiring
    if (!myFile || typeof window === 'undefined') return;
    let cancelled = false;

    // Seed: a tab opened mid-edit should show the agent without waiting for the
    // next heartbeat.
    fetch('/_api/ai', { headers: { 'Cache-Control': 'no-store' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { entries?: AiEntry[] } | null) => {
        if (cancelled || !j?.entries) return;
        const mine = j.entries.find((e) => e && e.file === myFile);
        if (mine) setEntry(mine);
      })
      .catch(() => {
        /* network blip — live messages will fill in */
      });

    // Embedded: parent relays ai-activity via postMessage (ai-banner pattern).
    const onMessage = (e: MessageEvent) => {
      // DDR-078 security follow-up: only the trusted embedding parent relays
      // ai-activity. Reject same-window self-posts (a hostile canvas faking a
      // "Claude is editing" identity) and any non-parent source. Standalone
      // (no parent) receives ai-activity via its own WS, never via postMessage.
      if (e.source !== window.parent || window.parent === window) return;
      const m = e.data as { dgn?: string; file?: string; entry?: AiEntry | null } | null;
      if (!m || typeof m !== 'object' || m.dgn !== 'ai-activity') return;
      if (m.file !== myFile) return;
      setEntry(m.entry ?? null);
    };
    window.addEventListener('message', onMessage);

    // Standalone (no embedding parent): dial the inspector WS ourselves.
    let ws: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    function connectStandalone() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const sock = new WebSocket(`${proto}//${location.host}/_ws`);
      ws = sock;
      sock.addEventListener('message', (ev) => {
        try {
          if (typeof ev.data !== 'string') return;
          const m = JSON.parse(ev.data) as { type?: string; file?: string; entry?: AiEntry | null };
          if (m.type !== 'ai-activity' || m.file !== myFile) return;
          setEntry(m.entry ?? null);
        } catch {
          /* binary collab frame — ignore */
        }
      });
      sock.addEventListener('close', () => {
        ws = null;
        reconnect = setTimeout(connectStandalone, 2000);
      });
    }
    if (window.parent === window) connectStandalone();

    return () => {
      cancelled = true;
      window.removeEventListener('message', onMessage);
      if (reconnect) clearTimeout(reconnect);
      ws?.close();
    };
  }, [myFile, initialAgent]);

  const agent = useMemo<AgentPresence | null>(() => {
    if (initialAgent !== undefined) return initialAgent;
    return entry ? deriveAgent(entry) : null;
  }, [entry, initialAgent]);

  return <AgentPresenceContext.Provider value={agent}>{children}</AgentPresenceContext.Provider>;
}

/** The agent currently editing this canvas, or null. Inert outside the provider. */
export function useAgentPresence(): AgentPresence | null {
  return useContext(AgentPresenceContext);
}
