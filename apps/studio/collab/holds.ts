// V2-1.15 §4 #13 — a person's live hold, read server-side for the AI's edit check.
//
// The `holding` awareness field (§5.12) rides each canvas room's Awareness: a tab on this Mac
// publishes into it over the loopback socket, a person on another Mac arrives through the hub
// bridge (awareness-bridge.ts). The agent routes (`routes/agent.ts`, `deps.personHolds`) ask
// "who holds what on THIS canvas right now" so a write that reaches a held element is denied
// `soft-locked`. Advisory between people (DDR-120) — only the AI is refused.
//
// The grammar below is the server's own copy of `sanitizeHoldingState` (use-collab.tsx — a React
// module the server does not load); `test/p8-person-holds.test.ts` pins the two to agree.

import type { PersonHold } from '../routes/agent.ts';
import type { Registry } from './registry.ts';

/** A hold nobody refreshed for this long is free (V2-1.15 §5.12), measured by THIS clock. */
export const HOLD_FREE_MS = 30_000;
const HOLD_SKEW_MS = 5000;
const HOLD_KEYS = ['artboard', 'element', 'print', 'at', 'actor'];
const HOLD_PRINT_MAX = 512;
const HOLD_ARTBOARD_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HOLD_ELEMENT_RE = /^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*|[0-9a-f]{8})$/;
const HOLD_ELEMENT_MAX = 48;
const NAME_MAX = 80;

/** The element id of a well-formed, fresh hold; null for anything else (dropped whole). */
export function liveHoldElement(raw: unknown, now: number): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const h = raw as Record<string, unknown>;
  const keys = Object.keys(h);
  if (keys.length > HOLD_KEYS.length || keys.some((k) => !HOLD_KEYS.includes(k))) return null;
  const { artboard, element, print, at } = h;
  if (typeof artboard !== 'string' || !HOLD_ARTBOARD_RE.test(artboard)) return null;
  if (typeof element !== 'string' || element.length > HOLD_ELEMENT_MAX) return null;
  if (!HOLD_ELEMENT_RE.test(element)) return null;
  if (print !== undefined && (typeof print !== 'string' || print.length > HOLD_PRINT_MAX))
    return null;
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0 || at > now + HOLD_SKEW_MS)
    return null;
  // a hold nobody refreshed lately is free — the publisher refreshes `at` at least every 10 s
  if (now - at > HOLD_FREE_MS) return null;
  return element;
}

/**
 * `deps.personHolds` for one project: the holds on `canvas` (a designRoot-relative canvas path)
 * from that canvas's room, if one is live. `slugOf` is the project's canvas slug function.
 */
export function personHoldsOf(
  registry: Pick<Registry, 'peek'>,
  slugOf: (rel: string) => string,
  now: () => number = Date.now
): (canvas?: string) => PersonHold[] {
  return (canvas) => {
    if (!canvas) return [];
    const room = registry.peek(slugOf(canvas));
    if (!room) return [];
    const t = now();
    const out: PersonHold[] = [];
    for (const state of room.awareness.getStates().values()) {
      if (!state || typeof state !== 'object') continue;
      const s = state as { holding?: unknown; name?: unknown };
      const element = liveHoldElement(s.holding, t);
      if (element === null) continue;
      const name = typeof s.name === 'string' ? s.name.slice(0, NAME_MAX) : '';
      out.push({ canvas, element, name });
    }
    return out;
  };
}
