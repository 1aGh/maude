// client/v2/shell/team-switch.js — 2.0.5 W4b: Switch / Sign in for a team-server project.
//
// Option A of the W4 open point: a team server's credential lands in the project's PROFILE
// (`hubs.json`), so signing in as someone else on a profile other projects share would re-sign them
// too — V2-3.8 forbids it. So, in the app:
//   1. `team_sign_in_prepare` (Rust, project tabs only; the caller's label + origin are checked
//      there). `true` = this project shared its profile: it is now bound to a fresh profile of its
//      own and its server restarts onto it — the page reloads signed out, and the person signs in
//      there (the card then offers "Sign in to <host>…"). Stop here.
//   2. `false` = this project is alone on its profile: run the team server's own sign-in page
//      (`/_api/hub-signin/start` → `open_team_server_signin` → poll). The server's route restarts
//      sync for this project's own server once the new sign-in is stored.
// No credential crosses this page; it only passes the server address and an attempt id.
//
// Pure over its effects (`invoke`, `api`, `openPage`, `wait`) so the test drives it with stubs.

const POLL_MS = 1500;
const POLL_CAP = 400; // 10 min at 1.5 s — the attempt's own lifetime

export const TEAM_SWITCH_WORDS = Object.freeze({
  moved:
    'This project now has an account of its own on this Mac. Sign in to the team server again once it reloads.',
  refused: 'Maude won’t open that address. Check the server address in Settings › Connections.',
  failed: 'Maude couldn’t open your browser. Try again.',
  start: 'The sign-in could not start. Try again.',
  unfinished: 'The sign-in did not finish. Try again.',
  needsApp: 'Switching a team-server account needs the Maude desktop app.',
});

const hostOf = (url) => {
  try {
    return new URL(String(url)).host;
  } catch {
    return String(url || '');
  }
};

/**
 * @returns {Promise<{ ok: boolean, moved?: boolean, url?: string, user?: string|null, error?: string }>}
 */
export async function runTeamSwitch({ url, native, invoke, api, openPage, wait, cancelled }) {
  if (!native || typeof invoke !== 'function')
    return { ok: false, error: TEAM_SWITCH_WORDS.needsApp };
  if (!url) return { ok: false, error: TEAM_SWITCH_WORDS.start };
  let moved;
  try {
    moved = await invoke('team_sign_in_prepare');
  } catch (e) {
    return { ok: false, error: String(e?.message || e || TEAM_SWITCH_WORDS.start) };
  }
  if (moved === true) return { ok: true, moved: true, message: TEAM_SWITCH_WORDS.moved };

  const post = (path, body) =>
    api(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const r = await post('/_api/hub-signin/start', { url });
  if (!r?.ok || !r.json?.ok || !r.json.id)
    return { ok: false, error: r?.json?.error || TEAM_SWITCH_WORDS.start };
  const id = r.json.id;
  const opened = await openPage(r.json.signInUrl);
  if (opened !== 'ok') {
    void post('/_api/hub-signin/cancel', { id });
    return {
      ok: false,
      error: opened === 'refused' ? TEAM_SWITCH_WORDS.refused : TEAM_SWITCH_WORDS.failed,
    };
  }
  for (let i = 0; i < POLL_CAP; i++) {
    await wait(POLL_MS);
    if (cancelled?.()) {
      void post('/_api/hub-signin/cancel', { id });
      return { ok: false, cancelled: true };
    }
    const p = await post('/_api/hub-signin/poll', { id });
    if (p?.json?.pending) continue;
    if (p?.ok && p.json?.ok && p.json.url) {
      const user = typeof p.json.user?.email === 'string' ? p.json.user.email : null;
      return {
        ok: true,
        url: p.json.url,
        user,
        message: user
          ? `Signed in to ${hostOf(p.json.url)} as ${user}.`
          : `Signed in to ${hostOf(p.json.url)}.`,
      };
    }
    return { ok: false, error: p?.json?.error || TEAM_SWITCH_WORDS.unfinished };
  }
  void post('/_api/hub-signin/cancel', { id });
  return { ok: false, error: TEAM_SWITCH_WORDS.unfinished };
}
