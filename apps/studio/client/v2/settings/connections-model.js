// client/v2/settings/connections-model.js — S11.14: Settings › Connections as data (06 ad-edge-hub).
//
// PURE (no DOM, no React, no fetch). One row per connection — Maude Cloud · your team's own server ·
// GitHub · AI images, video and voice · Figma — each with its status line, its one action and its own
// "› Advanced" fold (fold id `connections.<row>`). The words are CONTRACT §3–§4's and the canvas's.
//
// The secrets rule lives here too: a token is never a value of this model. The hub's access token is
// drawn from the server's `tokenLast4` alone (routes/connections.ts) — at most four characters, behind
// the mask — and a Figma or provider key only ever reads as "configured".

/** The fold ids, one per connection row (registered in fold-store.js FOLD_PANELS). */
export const CONNECTION_ROWS = Object.freeze(['cloud', 'hub', 'github', 'ai', 'figma']);
export const connectionFoldId = (row) => `connections.${row}`;

const MASK = '••••';

/** "•••• •••• a91f" — four characters at most, and only when the server named them. */
export function maskedToken(last4) {
  const tail = typeof last4 === 'string' && /^[\x21-\x7e]{4}$/.test(last4) ? last4 : MASK;
  return `${MASK} ${MASK} ${tail}`;
}

const hostOf = (url) => {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return '';
  }
};

/**
 * Is this hub address one of Maude Cloud's own (the cloud host, or a project cell under it)? Anything
 * else — a LAN address, a Tailscale name, a test stub — is "your team's own server".
 */
export function isCloudHub(hubUrl, cloudUrl) {
  const host = hostOf(hubUrl);
  const cloud = hostOf(cloudUrl);
  if (!host || !cloud) return false;
  return host === cloud || host.endsWith(`.${cloud}`);
}

/** "saved just now" · "saved 1 min ago" · "saved 14 min ago" · "saved at 14:05" · null (never a guess). */
export function savedWords(ms, now = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const age = Math.max(0, now - ms);
  if (age < 60_000) return 'saved just now';
  if (age < 60 * 60_000) return `saved ${Math.floor(age / 60_000)} min ago`;
  const d = new Date(ms);
  return `saved at ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * The team-server row. `linkedHub` is `/_api/cloud/status`'s `{ url, credentialed }`; a link to a
 * cloud project is the Maude Cloud row's, not this one's.
 * @returns {{ linked: boolean, title: string, status: string, tone: 'ok'|'' , action: 'sign-out'|'sign-in'|'add' }}
 */
export function hubRow({ linkedHub, cloudUrl, project, lastSyncAt, now = Date.now() } = {}) {
  const url = linkedHub?.url;
  if (!url || isCloudHub(url, cloudUrl))
    return {
      linked: false,
      title: 'Your team’s own server',
      status: 'A self-hosted server, beside the cloud. Sign in with your email and password.',
      tone: '',
      action: 'add',
    };
  const name = project ? `${project} — your team’s own server` : 'Your team’s own server';
  if (!linkedHub.credentialed)
    return {
      linked: true,
      title: name,
      status: 'Not signed in — this folder names the server, this Mac has no sign-in for it.',
      tone: '',
      action: 'sign-in',
    };
  const saved = savedWords(lastSyncAt, now);
  return {
    linked: true,
    title: name,
    status: saved ? `Connected · ${saved}` : 'Connected',
    tone: 'ok',
    action: 'sign-out',
  };
}

/** The Maude Cloud row: who is signed in, or that nobody is. */
export function cloudRow({ state, email } = {}) {
  if (state === 'in')
    return { status: `Signed in as ${email || 'your account'}`, tone: 'ok', action: 'sign-out' };
  if (state === 'loading') return { status: 'Checking…', tone: '', action: null };
  return { status: 'Where your projects live. Not signed in.', tone: '', action: 'sign-in' };
}

/** GitHub: a browser tab has no keychain to hold a token, and says so in the row. */
export function githubRow({ native, state, login } = {}) {
  if (!native)
    return {
      status: 'Signing in with GitHub needs the Maude desktop app.',
      tone: '',
      action: null,
    };
  if (state === 'in')
    return { status: `Connected as @${login || 'your account'}`, tone: 'ok', action: 'disconnect' };
  if (state === 'loading') return { status: 'Checking GitHub…', tone: '', action: null };
  return { status: 'Not connected', tone: '', action: 'connect' };
}

/** "2 keys · Gemini, ElevenLabs" from `/_api/generate/providers` — the names only, never a key. */
export function providerSummary(providers) {
  if (!Array.isArray(providers)) return 'Checking…';
  const set = providers.filter((p) => p?.configured && p.auth === 'api-key');
  if (set.length === 0) return 'No keys yet';
  const names = set.map((p) => String(p.label ?? p.id));
  return `${set.length} ${set.length === 1 ? 'key' : 'keys'} · ${names.join(', ')}`;
}

/** Figma: connected for imports, or not. The token reads "configured" and nothing else. */
export function figmaRow(status) {
  if (status === null || status === undefined)
    return { status: 'Checking…', tone: '', configured: false };
  return status.configured
    ? { status: 'Connected · for imports', tone: 'ok', configured: true }
    : { status: 'Not connected', tone: '', configured: false };
}

/** What a Figma Test answers, in words. */
export function figmaTestWords(result) {
  if (!result) return null;
  if (result.ok) return { ok: true, text: `Connected as ${result.handle || 'your Figma account'}` };
  return { ok: false, text: result.error || 'Figma did not accept that token.' };
}
