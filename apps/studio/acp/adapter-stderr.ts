// What the studio relays from the ACP adapter's stderr into its own log (the
// person's Diagnostics view). The adapter (@agentclientprotocol/claude-agent-acp)
// calls `unreachable()` for an SDK message it has no case for and logs
// `Unexpected case: <json>`. Two of those are known and not surprises:
//
//   · `subtype: "background_tasks_changed"` — the live set of background tasks
//     (subagents, background commands). Not noise any more (issue #177): it is
//     the one place that snapshot reaches us, so it goes to `onBackground` (see
//     background-tasks.ts) instead of the log.
//   · `type: "command_lifecycle"` — queued / started / completed of the host's
//     own prompts in Claude Code's input queue. Dropped quietly.
//
// We handle these here and not by bumping the adapter (the lockfiles are
// release-sensitive); every OTHER `Unexpected case` still shows, so a real
// protocol surprise is not hidden.

import {
  type BackgroundSnapshot,
  isCommandLifecycleLine,
  parseBackgroundLine,
} from './background-tasks.ts';

const BACKGROUND_LINE = /Unexpected case:.*"subtype"\s*:\s*"background_tasks_changed"/;

export function isKnownAdapterNoise(line: string): boolean {
  return BACKGROUND_LINE.test(line) || isCommandLifecycleLine(line);
}

/** One whole stderr line: a background snapshot goes to `onBackground`, noise is dropped, the rest to `sink`. */
export function relayAdapterLine(
  raw: string,
  sink: (line: string) => void,
  onBackground?: (snap: BackgroundSnapshot) => void
): void {
  const line = raw.trimEnd();
  if (!line) return;
  const snap = parseBackgroundLine(line);
  if (snap) {
    onBackground?.(snap);
    return;
  }
  if (!isKnownAdapterNoise(line)) sink(line);
}

/** Split one stderr chunk into lines and hand each non-empty, non-noise line to `sink`. */
export function relayAdapterStderr(
  chunk: string,
  sink: (line: string) => void,
  onBackground?: (snap: BackgroundSnapshot) => void
): void {
  for (const raw of chunk.split('\n')) relayAdapterLine(raw, sink, onBackground);
}
