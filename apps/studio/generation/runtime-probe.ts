// generation/runtime-probe.ts — shared "what can this machine actually do"
// probing for the optional local runtimes (the Gemma scout's mlx-vlm/Ollama, the
// subtitle stack's whisper.cpp).
//
// Two jobs, both learned the hard way:
//
//   1. Probes SPAWN. They sit behind un-authenticated (same-origin + loopback)
//      GETs, so an unthrottled probe is a way to stall the single-threaded Bun
//      event loop. Everything here is TTL-cached: at most one spawn per key per
//      PROBE_TTL_MS regardless of request rate, while still noticing a
//      mid-session install within the TTL.
//
//   2. A card must never print an instruction this machine can't follow.
//      `brew install …` is noise without Homebrew; a venv one-liner is noise
//      without python3. Callers build their setup routes from these probes and
//      return only the viable ones, best first.

import { spawnSync } from 'node:child_process';

const PROBE_TTL_MS = 30_000;
const probeCache = new Map<string, { at: number; value: boolean }>();

export function cachedProbe(key: string, compute: () => boolean): boolean {
  const now = Date.now();
  const hit = probeCache.get(key);
  if (hit && now - hit.at < PROBE_TTL_MS) return hit.value;
  const value = compute();
  probeCache.set(key, { at: now, value });
  return value;
}

/** Is a command on PATH? */
export function hasCommandCached(cmd: string): boolean {
  return cachedProbe(`has:${cmd}`, () => {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    return spawnSync(finder, [cmd], { stdio: 'ignore', windowsHide: true }).status === 0;
  });
}

/** One way to get a runtime onto THIS machine. `command` is copy/paste; `link`
 *  is a URL — the desktop shell has no general URL opener by design (DDR-054),
 *  so the client renders a copyable link rather than a button that can't work. */
export interface SetupOption {
  id: string;
  kind: 'command' | 'link';
  label: string;
  command?: string;
  url?: string;
  note?: string;
}
