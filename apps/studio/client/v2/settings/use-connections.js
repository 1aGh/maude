// client/v2/settings/use-connections.js — S11.14: the logic behind Settings › Connections, as hooks.
//
// Lifted out of the v1 rows Settings used to mount whole (CloudBar "settings", IdentityBar
// "settings", FigmaConnectCard, ProviderKeys). Same routes, same handlers, same events — so a change
// made here reaches the instances that still live elsewhere (the left panel's CloudBar host, which
// answers maude:// links, re-reads on CLOUD_CHANGED_EVENT; the GitHub rail on
// GITHUB_SIGNED_OUT_EVENT). The v1 files stay while those surfaces use them.
//
// Secrets: no hook keeps a token. The ones a person types (Replace…, a Figma token) go straight into
// one POST and the field is cleared; nothing reads a token back — the hub's comes back as its last
// four characters at most (`/_api/connections/hub`).

import { useCallback, useEffect, useRef, useState } from 'react';

import { connectClaude } from '../ai/connect-flow.js';
import { CLOUD_CHANGED_EVENT, connectOutcomeNote, openExternal } from '../../panels/CloudBar.jsx';
import { GITHUB_SIGNED_OUT_EVENT } from '../../panels/IdentityBar.jsx';
import {
  cloudSignedIn,
  cloudSignInPrepare,
  fetchIdentity,
  isNativeApp,
  isSignedIn,
  onDeviceCode,
  onSignedIn,
  signIn as githubSignIn,
  signOut as githubSignOut,
} from '../../github.js';

const api = async (path, init) => {
  try {
    const res = await fetch(path, init);
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: {} };
  }
};
const post = (path, body) =>
  api(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

// ── Maude Cloud: the account, the device-code sign-in, the cloud projects on this Mac ────────────

export function useCloudConnection({ onLinkedHub, onLocalProject, syncStatus } = {}) {
  const [state, setState] = useState('loading'); // loading | out | in
  const [email, setEmail] = useState(null);
  // The address this Mac signs in against (`status.url`) — never a hard-coded vendor URL.
  const [cloudUrl, setCloudUrl] = useState('');
  const [local, setLocal] = useState({ project: '', linkedHub: null });
  const [projects, setProjects] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [device, setDevice] = useState(null);
  const [openFailed, setOpenFailed] = useState('');
  const [connected, setConnected] = useState(null); // { project, sync } of the last Connect
  const pollRef = useRef(null);
  const selfRef = useRef({});
  const liftRef = useRef({ onLinkedHub, onLocalProject });
  liftRef.current = { onLinkedHub, onLocalProject };

  const announce = useCallback(() => {
    try {
      window.dispatchEvent(
        new CustomEvent(CLOUD_CHANGED_EVENT, { detail: { from: selfRef.current } })
      );
    } catch {
      /* no window — nobody to tell */
    }
  }, []);

  const loadStatus = useCallback(async () => {
    const r = await api('/_api/cloud/status');
    if (r.json?.url) setCloudUrl(r.json.url);
    const linkedHub = r.json?.linkedHub ?? null;
    setLocal({ project: r.json?.project ?? '', linkedHub });
    liftRef.current.onLinkedHub?.(linkedHub);
    liftRef.current.onLocalProject?.(r.json?.project ?? null);
    if (r.ok && r.json?.connected) {
      setEmail(r.json.email ?? null);
      setState('in');
    } else setState('out');
  }, []);

  const loadProjects = useCallback(async () => {
    const r = await api('/_api/cloud/projects');
    setProjects(r.ok && r.json?.ok ? r.json.projects : []);
    if (!r.ok && r.status === 401) {
      setState('out');
      setEmail(null);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    return () => clearInterval(pollRef.current);
  }, [loadStatus]);

  useEffect(() => {
    const onChanged = (e) => {
      if (e.detail?.from === selfRef.current) return;
      setProjects(null);
      loadStatus();
    };
    window.addEventListener(CLOUD_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CLOUD_CHANGED_EVENT, onChanged);
  }, [loadStatus]);

  // The list is always open in Settings: read it as soon as there is an account to read it with.
  useEffect(() => {
    if (state === 'in' && projects === null) loadProjects();
  }, [state, projects, loadProjects]);

  const adoptLink = (url) => {
    if (typeof url !== 'string' || !url) return;
    const linkedHub = { url, credentialed: true };
    setLocal((l) => ({ ...l, linkedHub }));
    liftRef.current.onLinkedHub?.(linkedHub);
    announce();
  };

  async function startSignIn() {
    setError('');
    // V2-3.8: never sign in over another account's cloud credential.
    try {
      if (await cloudSignInPrepare()) return; // moved to its own profile — reloading
    } catch (e) {
      setError(String(e?.message || e || 'Maude Cloud sign-in could not start.'));
      return;
    }
    const r = await post('/_api/cloud/signin/start');
    if (!r.ok || !r.json?.ok) {
      setError(r.json?.error || 'Maude Cloud could not be reached.');
      return;
    }
    setDevice(r.json);
    setOpenFailed('');
    openExternal(r.json.verificationUrl).then((s) => setOpenFailed(s === 'ok' ? '' : s));
    pollRef.current = setInterval(
      async () => {
        const p = await post('/_api/cloud/signin/poll', { deviceCode: r.json.deviceCode });
        if (p.json?.pending) return;
        clearInterval(pollRef.current);
        setDevice(null);
        if (p.ok && p.json?.ok) {
          setEmail(p.json.email ?? null);
          setState('in');
          cloudSignedIn().catch(() => undefined); // V2-3.8: may move it to its own profile
          announce();
        } else setError(p.json?.error || 'The sign-in did not finish. Try again.');
      },
      (r.json.interval ?? 5) * 1000
    );
  }

  function cancelSignIn() {
    clearInterval(pollRef.current);
    setDevice(null);
  }

  async function signOut() {
    setBusy('signout');
    await post('/_api/cloud/signout');
    setBusy('');
    setEmail(null);
    setProjects(null);
    setState('out');
    announce();
  }

  /** `connections.cloud-project-connect` — POST /_api/cloud/attach. */
  async function connect(projectId) {
    setBusy(projectId);
    setConnected(null);
    setError('');
    const r = await post('/_api/cloud/attach', { project: projectId });
    setBusy('');
    if (r.ok && r.json?.ok) {
      setConnected({ project: r.json.project ?? projectId, sync: r.json.sync });
      adoptLink(r.json.url);
    } else setError(r.json?.error || 'The workspace could not be connected.');
  }

  /** `connections.cloud-project-disconnect` — POST /_api/cloud/detach: drops the link and its sign-in. */
  async function disconnect() {
    setBusy('disconnect');
    setError('');
    const r = await post('/_api/cloud/detach');
    setBusy('');
    if (r.ok && r.json?.ok) {
      setLocal((l) => ({ ...l, linkedHub: null }));
      setConnected(null);
      liftRef.current.onLinkedHub?.(null);
      announce();
    } else setError(r.json?.error || 'The workspace could not be disconnected.');
  }

  const note = connected ? connectOutcomeNote(connected.project, connected.sync, syncStatus) : null;

  return {
    state,
    email,
    cloudUrl,
    local,
    projects,
    busy,
    error,
    note,
    device,
    openFailed,
    setOpenFailed,
    startSignIn,
    cancelSignIn,
    signOut,
    connect,
    disconnect,
    reload: loadStatus,
    announce,
  };
}

// ── The team server this folder syncs with: its Advanced details, Replace… ──────────────────────

export function useHubDetails(linkedUrl) {
  const [details, setDetails] = useState(null); // null = not read yet
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const r = await api('/_api/connections/hub');
    setDetails(r.ok && r.json?.ok ? (r.json.hub ?? null) : null);
  }, []);

  useEffect(() => {
    if (linkedUrl) load();
    else setDetails(null);
  }, [linkedUrl, load]);

  /**
   * `connections.replace-hub-token` — through the existing credential route (`POST /_api/hub/link`,
   * the per-profile store). The token is sent once and never kept; the caller clears its field.
   */
  async function replace(token) {
    const t = String(token ?? '').trim();
    if (!t || !linkedUrl || busy) return false;
    setBusy(true);
    setError('');
    const r = await post('/_api/hub/link', { url: linkedUrl, token: t });
    setBusy(false);
    if (!r.ok || !r.json?.ok) {
      setError(r.json?.error || 'The new token could not be saved.');
      return false;
    }
    await load();
    try {
      window.dispatchEvent(new CustomEvent(CLOUD_CHANGED_EVENT, { detail: { from: 'replace' } }));
    } catch {
      /* no window */
    }
    return true;
  }

  return { details, busy, error, replace, reload: load };
}

// ── GitHub: the shell's device flow, the keychain token ─────────────────────────────────────────

export function useGitHubConnection() {
  const native = isNativeApp();
  const [state, setState] = useState(native ? 'loading' : 'out');
  const [login, setLogin] = useState(null);
  const [signing, setSigning] = useState(false);
  const [device, setDevice] = useState(null);
  const [error, setError] = useState('');
  const selfRef = useRef({});

  useEffect(() => {
    if (!native) return undefined;
    let alive = true;
    (async () => {
      try {
        if (!(await isSignedIn())) {
          if (alive) setState('out');
          return;
        }
        const r = await fetchIdentity();
        if (!alive) return;
        if (r.ok && r.json?.ok) {
          setLogin(r.json.login);
          setState('in');
        } else setState('out');
      } catch {
        if (alive) setState('out');
      }
    })();
    const p = onSignedIn((who) => {
      setLogin(who);
      setState('in');
    });
    const onOut = (e) => {
      if (e.detail?.from === selfRef.current) return;
      setLogin(null);
      setState('out');
    };
    window.addEventListener(GITHUB_SIGNED_OUT_EVENT, onOut);
    return () => {
      alive = false;
      p?.then?.((fn) => fn?.());
      window.removeEventListener(GITHUB_SIGNED_OUT_EVENT, onOut);
    };
  }, [native]);

  async function signIn() {
    setError('');
    setSigning(true);
    const un = onDeviceCode((payload) => setDevice(payload));
    try {
      const who = await githubSignIn();
      const r = await fetchIdentity();
      setLogin(r.ok && r.json?.ok ? r.json.login : who);
      setState('in');
    } catch (e) {
      setError(String(e?.message || e || 'Sign-in didn’t finish. Please try again.'));
    } finally {
      setSigning(false);
      setDevice(null);
      un?.then?.((fn) => fn?.());
    }
  }

  async function signOut() {
    try {
      await githubSignOut();
    } catch {
      /* idempotent */
    }
    setLogin(null);
    setState('out');
    try {
      window.dispatchEvent(
        new CustomEvent(GITHUB_SIGNED_OUT_EVENT, { detail: { from: selfRef.current } })
      );
    } catch {
      /* no window */
    }
  }

  return {
    native,
    state,
    login,
    signing,
    device,
    error,
    signIn,
    signOut,
    closeDevice: () => setDevice(null),
  };
}

// ── AI provider keys (the names; a key reads "configured" and nothing else) ─────────────────────

export function useProviderKeys() {
  const [providers, setProviders] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api('/_api/generate/providers');
    if (r.ok) {
      setProviders(Array.isArray(r.json?.providers) ? r.json.providers : []);
      setError('');
    } else {
      setProviders([]);
      setError('The provider list could not be read.');
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return { providers, error, reload: load };
}

// ── AI — your Claude account (02 ob-settings): connected or not, and the browser sign-in ─────────

export function useClaudeAccount() {
  const [state, setState] = useState('loading'); // loading | in | out
  const [phase, setPhase] = useState('idle'); // idle | installing | waiting
  const [error, setError] = useState('');
  const ctlRef = useRef(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      ctlRef.current?.abort();
    };
  }, []);

  const load = useCallback(async () => {
    const r = await api('/_api/preflight');
    if (!alive.current) return;
    const item = r.ok ? r.json?.items?.find?.((i) => i.id === 'claude') : null;
    setState(item?.status === 'present' ? 'in' : 'out');
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  /** Connect (or Change…): the one flow the AI panel's sheet runs — install if missing, then browser sign-in. */
  async function connect({ force = false } = {}) {
    if (ctlRef.current) return false;
    const ctl = new AbortController();
    ctlRef.current = ctl;
    setError('');
    const r = await connectClaude({ signal: ctl.signal, onPhase: setPhase, force });
    ctlRef.current = null;
    if (!alive.current) return false;
    setPhase('idle');
    if (r.ok) await load();
    else if (r.reason !== 'cancelled') setError(r.reason || 'Could not connect.');
    return r.ok;
  }
  function cancel() {
    ctlRef.current?.abort();
  }

  return { state, phase, error, connect, cancel, setError };
}

// ── Figma: the personal access token, Test, Disconnect (D14) ────────────────────────────────────

export function useFigmaConnection() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState(null); // { ok, handle?, error? } of the last Test
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const r = await api('/_api/figma/status');
    setStatus(r.ok ? r.json : { configured: false });
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  /** `connections.figma-test` — POST /_api/figma/probe: spends the token on one Figma call. */
  async function runTest() {
    setBusy(true);
    setTest(null);
    const r = await post('/_api/figma/probe');
    setBusy(false);
    setTest(
      r.json?.ok ? { ok: true, handle: r.json.handle || '' } : { ok: false, error: r.json?.error }
    );
  }

  async function save(token) {
    const t = String(token ?? '').trim();
    if (!t || busy) return false;
    setBusy(true);
    setError('');
    const r = await post('/_api/figma/connect', { token: t });
    setBusy(false);
    if (!r.ok) {
      setError(r.json?.error || 'Could not save the token.');
      return false;
    }
    await load();
    await runTest();
    return true;
  }

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    await api('/_api/figma/connect', { method: 'DELETE' });
    setBusy(false);
    setTest(null);
    await load();
  }

  return { status, busy, test, error, runTest, save, disconnect };
}
