// client/v2/ai/connect-flow.js — S5.13: what the sheet's Connect does. The v1 cold start already knows how
// (panels/ReadinessList.jsx SetupAction): install Claude Code when it is missing, then open the browser sign-in,
// then wait until `claude` reports present. One click, both steps, the endpoints v1 uses — no second flow.
//
//   connectClaude({ fetchImpl, sleep, signal, onPhase })  → { ok: true } | { ok: false, reason }
//
// Phases: 'installing' · 'waiting' (for the browser). Cancel = abort the signal (the sign-in is withdrawn).
// Pure of React so test/v2-ai-needs-you.test.ts drives it with a scripted fetch.

const SIGNIN_POLL_MS = 2000;
const SIGNIN_MAX_MS = 120_000;
const INSTALL_POLL_MS = 1500;
const INSTALL_MAX_MS = 180_000;

const json = (res) => res.json().catch(() => null);

export async function connectClaude({
  fetchImpl = (...a) => fetch(...a),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
  signal,
  onPhase = () => {},
  force = false, // Settings › Connections › Change… signs in again even when `claude` already reports present
} = {}) {
  const cancelled = () => signal?.aborted === true;
  const post = (url) =>
    fetchImpl(url, { method: 'POST' })
      .then(json)
      .catch(() => ({ ok: false, reason: 'Could not reach Maude.' }));
  const claudeItem = async () => {
    const report = await fetchImpl('/_api/preflight')
      .then(json)
      .catch(() => null);
    return report?.items?.find((i) => i.id === 'claude') ?? null;
  };

  const first = await claudeItem();
  if (first?.status === 'present' && !force) return { ok: true };

  if (first?.action === 'install' && !force) {
    onPhase('installing');
    const started = await post('/_api/claude/install');
    if (!started?.ok)
      return { ok: false, reason: started?.reason || 'Could not start the installer.' };
    let deadline = now() + INSTALL_MAX_MS;
    for (;;) {
      if (cancelled()) return { ok: false, reason: 'cancelled' };
      if (now() > deadline) return { ok: false, reason: 'Install is taking longer than expected.' };
      const state = await fetchImpl('/_api/claude/install-status')
        .then(json)
        .catch(() => null);
      if (state?.phase === 'running')
        deadline = now() + INSTALL_MAX_MS; // progressing: never cut off
      else if (state?.phase === 'done') {
        if (!state.ok) return { ok: false, reason: state.reason || 'Install failed.' };
        break;
      }
      await sleep(INSTALL_POLL_MS);
    }
  }

  const signin = await post('/_api/claude/signin');
  if (!signin?.ok) return { ok: false, reason: signin?.reason || 'Could not start sign-in.' };
  onPhase('waiting');
  const deadline = now() + SIGNIN_MAX_MS;
  for (;;) {
    if (cancelled()) {
      await fetchImpl('/_api/claude/signin-cancel', { method: 'POST' }).catch(() => {});
      return { ok: false, reason: 'cancelled' };
    }
    if (now() > deadline) return { ok: false, reason: 'Sign-in timed out. Try again.' };
    await sleep(SIGNIN_POLL_MS);
    if ((await claudeItem())?.status === 'present') return { ok: true };
  }
}
