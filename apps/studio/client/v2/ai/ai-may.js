// client/v2/ai/ai-may.js — P8 c7 (03 `ai-advanced`, "AI may"): what the person lets AI use, per Mac.
//
//   Change canvases        is the ask-before mode ("AI changes nothing" modes = off) — not stored here
//   Use Assets and footage \ stored here, sent as the `may` field of every prompt / warm frame (ask-frame.js) and
//   Search the web         /  HELD by the server: an off switch is a deny rule the session is spawned with plus a
//                             refusal in the bridge's permission gate (acp/may-scope.ts, decision
//                             maude/v2-p8-c7-ai-may-enforced). The agent is also told with ONE bracket line
//                             (`[maude-may no-assets no-web]`): a hint that saves it wasted calls, never the control.
// Both default ON; no bracket line while both are on, so the ask text is byte-for-byte what it was.

export const MAY_KEY = 'maude-ai-may';
export const MAY_DEFAULT = Object.freeze({ assets: true, web: true });

export function readMay(storage) {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(MAY_KEY);
    const o = raw ? JSON.parse(raw) : null;
    return { assets: o?.assets !== false, web: o?.web !== false };
  } catch {
    return { ...MAY_DEFAULT };
  }
}

export function writeMay(may, storage) {
  try {
    (storage ?? globalThis.localStorage)?.setItem(
      MAY_KEY,
      JSON.stringify({ assets: may.assets !== false, web: may.web !== false })
    );
  } catch {
    /* private window / blocked storage — the switch just doesn't persist */
  }
}

/** The one line a prompt carries when something is off; `null` when AI may use everything. */
export function mayLine(may) {
  const off = [];
  if (may?.assets === false) off.push('no-assets');
  if (may?.web === false) off.push('no-web');
  return off.length ? `[maude-may ${off.join(' ')}]` : null;
}
