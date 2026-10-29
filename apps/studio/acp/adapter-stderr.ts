// What the studio relays from the ACP adapter's stderr into its own log (the
// person's Diagnostics view). The adapter (@agentclientprotocol/claude-agent-acp)
// calls `unreachable()` for an SDK system message subtype it has no case for and
// logs `Unexpected case: <json>`. A newer installed `claude` than the adapter's
// SDK knows emits `subtype: "background_tasks_changed"` — harmless (the adapter
// ignores it) but noise on every turn. We drop exactly that known line, here and
// not by bumping the adapter (the lockfiles are release-sensitive); every OTHER
// `Unexpected case` still shows, so a real protocol surprise is not hidden.

const KNOWN_HARMLESS = /Unexpected case:.*"subtype"\s*:\s*"background_tasks_changed"/;

export function isKnownAdapterNoise(line: string): boolean {
  return KNOWN_HARMLESS.test(line);
}

/** Split one stderr chunk into lines and hand each non-empty, non-noise line to `sink`. */
export function relayAdapterStderr(chunk: string, sink: (line: string) => void): void {
  for (const raw of chunk.split('\n')) {
    const line = raw.trimEnd();
    if (line && !isKnownAdapterNoise(line)) sink(line);
  }
}
