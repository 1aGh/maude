// client/v2/onboarding/connect-ai-home.js — what "Connect" does on Home's Connect AI sheet (S6.9). A project
// window's ConnectSheet drives `/_api/claude/*` (v2/ai/connect-flow.js); Home has no project server, so the same
// two steps — install Claude Code when it is missing, then the browser sign-in — go through the Home server's
// `/_home/ai/{status,connect}` (S6.6, over the same DDR-166 module). One click, both steps, then wait until the
// status says AI editing is available. No key, token or path passes through here: the status carries none.
//
//   connectClaudeHome({ status, connect, sleep, now, signal, onPhase }) → { ok: true } | { ok: false, reason }
//   status()  → { ok, json: { available, claudeInstalled, install, signinInFlight } }   (home-api `aiStatus`)
//   connect(step: 'install'|'signin'|'cancel') → { ok, json: { ok, error? } }           (home-api `aiConnect`)
//
// Phases: 'installing' · 'waiting' (for the browser). Cancel = abort the signal; the sign-in is withdrawn.

const SIGNIN_POLL_MS = 2000;
const SIGNIN_MAX_MS = 120_000;
const INSTALL_POLL_MS = 1500;
const INSTALL_MAX_MS = 180_000;
/** Consecutive reads of "no sign-in running and still not connected" before the attempt is called over. */
const SETTLE_READS = 2;

export async function connectClaudeHome({
  status,
  connect,
  signal,
  // a pause ends the moment Cancel aborts the signal, so the withdrawal is not a poll late
  sleep = (ms) =>
    new Promise((r) => {
      const t = setTimeout(r, ms);
      signal?.addEventListener('abort', () => (clearTimeout(t), r()), { once: true });
    }),
  now = () => Date.now(),
  onPhase = () => {},
}) {
  const cancelled = () => signal?.aborted === true;
  const read = async () => {
    const r = await status();
    return r?.ok && r.json && typeof r.json === 'object' ? r.json : null;
  };
  const refused = (r, fallback) =>
    typeof r?.json?.error === 'string' && r.json.error ? r.json.error : fallback;

  const first = await read();
  if (first?.available) return { ok: true };

  if (first && first.claudeInstalled === false) {
    onPhase('installing');
    const started = await connect('install');
    if (!started?.ok || !started.json?.ok)
      return { ok: false, reason: refused(started, 'Could not start the installer.') };
    let deadline = now() + INSTALL_MAX_MS;
    for (;;) {
      if (cancelled()) {
        await connect('cancel');
        return { ok: false, reason: 'cancelled' };
      }
      if (now() > deadline) return { ok: false, reason: 'Install is taking longer than expected.' };
      const s = await read();
      const phase = s?.install?.phase;
      if (phase === 'running')
        deadline = now() + INSTALL_MAX_MS; // progressing: never cut off
      else if (phase === 'done') {
        if (!s.install.ok)
          return {
            ok: false,
            reason: typeof s.install.reason === 'string' ? s.install.reason : 'Install failed.',
          };
        break;
      }
      await sleep(INSTALL_POLL_MS);
    }
  }

  const started = await connect('signin');
  if (!started?.ok || !started.json?.ok)
    return { ok: false, reason: refused(started, 'Could not start sign-in.') };
  onPhase('waiting');
  const deadline = now() + SIGNIN_MAX_MS;
  let idleReads = 0;
  for (;;) {
    if (cancelled()) {
      await connect('cancel');
      return { ok: false, reason: 'cancelled' };
    }
    if (now() > deadline) {
      await connect('cancel');
      return { ok: false, reason: 'Sign-in timed out. Try again.' };
    }
    await sleep(SIGNIN_POLL_MS);
    const s = await read();
    if (s?.available) return { ok: true };
    idleReads = s && s.signinInFlight === false ? idleReads + 1 : 0;
    if (idleReads >= SETTLE_READS)
      return { ok: false, reason: "Sign-in didn't finish. Try again." };
  }
}
