// _agent-browser-bin.mjs — the one lookup for the agent-browser executable (2.0.5 app finding).
// The desktop sidecar pins the bundled engine with MAUDE_AGENT_BROWSER (sidecar.rs); the shell
// helpers read the same name (screenshot.sh, canvas-rects.sh, perf.sh, photo-bg-remove.sh).
// MAUDE_AGENT_BROWSER_BIN is the older spelling and keeps working. Neither set: PATH lookup.

export function resolveAgentBrowserBin(env = process.env) {
  return env.MAUDE_AGENT_BROWSER || env.MAUDE_AGENT_BROWSER_BIN || 'agent-browser';
}
