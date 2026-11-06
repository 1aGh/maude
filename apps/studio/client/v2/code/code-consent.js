// client/v2/code/code-consent.js — fix/207: this Mac's answer to "may the project's hub deliver
// shared code here?", in words and two fetches.
//
// Shared code is the `.ts`/`.js` modules a team adds to a project (helpers, components canvases
// import). It lands OUTSIDE the canvas sandbox — AI and the maude helpers read it, and canvases run
// it — so a Mac takes it only once the person says yes (DDR-054). The answer lives in the profile's
// hubs.json; the studio writes it (`POST /_api/sync/code-consent/set`, the window's own fetch only).
// Reached from Sync details' held row and the canvas-waiting card; registry actions
// `sync.allow-code` / `sync.stop-code`.

/** The sheet's words for `mode` 'allow' | 'stop', naming the hub by its host (CONTRACT §4). */
export function consentWords(mode, host) {
  const from = host ? ` from ${host}` : '';
  if (mode === 'stop')
    return {
      title: `Stop allowing shared code${from}?`,
      lines: [
        'Shared code already on this Mac stays. New or changed shared code from this project waits until you allow it again.',
        'Canvases that need code that hasn’t arrived can’t open until then.',
      ],
      go: 'Stop allowing',
    };
  return {
    title: `Allow shared code${from}?`,
    lines: [
      'Shared code is the .ts and .js files the people in this project add to it — helpers and components its canvases import.',
      'It runs on this Mac, outside the canvas sandbox: canvases run it when they open, and AI and the Maude tools read it. Allow it only if you trust the people who share this project.',
    ],
    fine: 'You can stop allowing it any time in Sync details.',
    go: 'Allow shared code',
  };
}

export const CONSENT_FAILED = 'That didn’t work. Nothing changed on this Mac.';

/** GET /_api/sync/code-consent → the view, or null (not syncing, or unreachable). */
export async function readCodeConsent(fetchImpl = globalThis.fetch) {
  try {
    const r = await fetchImpl('/_api/sync/code-consent', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && typeof j.consent === 'object' ? j.consent : null;
  } catch {
    return null;
  }
}

/** POST /_api/sync/code-consent/set → { ok: true, consent } | { ok: false, message }. */
export async function requestCodeConsent(allow, fetchImpl = globalThis.fetch) {
  try {
    const r = await fetchImpl('/_api/sync/code-consent/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allow: allow === true }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) return { ok: true, consent: j.consent ?? null };
    const said = typeof j.detail === 'string' ? j.detail : j.message;
    return {
      ok: false,
      message: typeof said === 'string' && said.length <= 200 ? said : CONSENT_FAILED,
    };
  } catch {
    return { ok: false, message: 'Maude isn’t reachable right now.' };
  }
}
