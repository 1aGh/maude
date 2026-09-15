// Cloud Phase 23 C3 — Maude Cloud in the sidebar footer.
//
// The same compact rail treatment as the GitHub IdentityBar directly below
// it, and deliberately the same `gi-*` chrome (one material, one dialog
// family). Differences that matter:
//
//   • Works in BOTH the desktop shell and a plain browser: the whole lane is
//     the dev-server's loopback `/_api/cloud/*` — no Tauri, no keychain, no
//     CORS. The credential never enters this JS; the server holds it.
//   • Sign-in is OUR device flow: the dashboard shows /activate, the person
//     types (or arrives with) the short code, this panel just polls.
//   • "Connect" attaches THIS project to the chosen cloud workspace — the
//     exact state `maude design link` writes, minus the terminal.

import { useEffect, useRef, useState } from 'react';

import { localIdentityMatches, parseFileDeepLink } from '../share-link.js';
import FileDeepLinkDialog from './file-deep-link-dialog.jsx';
import { safeName, syncPresentation } from '../../sync/presentation.ts';
import { invoke, isNativeApp, listen, openCloudUrl, openTeamProject } from '../github.js';

const api = async (path, init) => {
  const res = await fetch(path, init);
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
};

/**
 * Reach the OS browser from whichever surface this is running on.
 *
 * In the desktop shell `window.open` does nothing at all — WKWebView drops it
 * silently — which is what used to strand a person mid-sign-in holding a code
 * and no page to type it into. The shell therefore goes through the Rust
 * opener, which zone-locks the URL against the configured cloud address (the
 * webview is untrusted, DDR-054: there is deliberately no general opener).
 *
 * Best-effort by design: an older shell has no such command, a self-hosted
 * origin can drift, and the browser can block the popup — so every caller ALSO
 * shows the address as something the person can click or copy by hand.
 */
/**
 * Is this an address we are willing to render as a link at all?
 *
 * The zone lock lives in Rust, but the dialog SHOWS the address and offers to
 * copy it — so an off-zone `verification_url` (hostile/compromised control
 * plane, MITM'd plaintext self-host) would be presented in trusted app chrome
 * with a label inviting the person to open it by hand. Refusing to render it is
 * the only place that can be stopped (attacker pass 2026-08-04, B4).
 */
export function isDisplayableUrl(url, cloudUrl) {
  let u;
  let base;
  try {
    u = new URL(String(url));
    base = new URL(String(cloudUrl ?? DEFAULT_CLOUD_URL));
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  // Same two arms the Rust opener enforces. A scheme check alone was NOT enough:
  // `https://evil.example/activate?code=…` from a hostile or MITM'd control plane
  // passed it and still rendered as a live href with a Copy button — and a
  // middle-click or "Open link" never reaches the click handler, let alone Rust
  // (attacker re-review 2026-08-04, NEW-3).
  if (u.origin === base.origin) return true;
  const host = u.hostname;
  return (
    u.protocol === 'https:' &&
    !u.port &&
    (u.pathname === '' || u.pathname === '/') &&
    !u.search &&
    !u.hash &&
    (host === DEFAULT_CLOUD_HOST || host.endsWith(`.${DEFAULT_CLOUD_HOST}`))
  );
}

/**
 * Reach the OS browser. Resolves to true when the open was accepted.
 *
 * A refusal must NOT be swallowed: the Rust side refusing is precisely the
 * security event, and a silently dead click under a label reading "if your
 * browser didn't open, go to:" teaches the person to copy the address into a
 * browser the lock cannot see (B4). Callers surface the failure instead.
 */
export function openExternal(url) {
  if (!url) return Promise.resolve('failed');
  if (isNativeApp()) {
    return openCloudUrl(url).then(
      () => 'ok',
      // A REFUSAL is the security event and reads differently from "no browser
      // would start" — collapsing both into one boolean lost the distinction the
      // dialog needs to say something true.
      (err) => (/Refusing to open/i.test(String(err)) ? 'refused' : 'failed')
    );
  }
  // `window.open(..., 'noopener')` returns null even on SUCCESS (that is the
  // whole point of noopener), so its result says nothing about whether a tab
  // opened. Treating null as failure made the browser build print "Maude
  // couldn't open your browser" on every single sign-in — training people that
  // the one warning this dialog has is noise (attacker re-review, NEW-2).
  try {
    window.open(url, '_blank', 'noopener');
    return Promise.resolve('ok');
  } catch {
    return Promise.resolve('failed');
  }
}

/**
 * Parse a maude://open/<project>?code=mhc_… deep link. Untrusted input — a
 * drive-by page can navigate to maude:// — so nothing here is acted on
 * without the person pressing Connect, and the code is only ever exchanged
 * against the app's own configured Maude Cloud address.
 */
export function parseDeepLink(url) {
  const m = /^maude:\/\/open\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?\?(.*)$/.exec(String(url ?? ''));
  if (!m) return null;
  // The platform caps a project id at 40 chars (deriveProjectId), but that bound
  // lives server-side and a drive-by maude:// link never passes through it — so
  // without this, arbitrary attacker text renders in the dialog's heading, prose
  // and aria-label. Nothing longer can name a real project anyway.
  if (m[1].length > 40) return null;
  const params = new URLSearchParams(m[2]);
  if (params.has('open') || params.getAll('code').length !== 1) return null;
  const code = params.get('code') ?? '';
  if (!/^mhc_[0-9a-f]{16,128}$/.test(code)) return null;
  return { project: m[1], code };
}

/**
 * A viewer's browser home for a project — the project's OWN address.
 *
 * It used to derive `view-<host>`, which no longer exists: the read-only gallery
 * was deleted in Cloud Phase 25 C5, and `tenantFromHostname` now hard-refuses any
 * `view-` label (deliberately, so a leftover custom domain can't spin up a cell
 * literally named `view-alligators`). So this returned a guaranteed 404 — which
 * was invisible while `window.open` was a no-op in the desktop shell, and would
 * have become a visibly dead menu item the moment the opener started working
 * (attacker re-review 2026-08-04). The browser door replaced the gallery: the
 * real project, for people who actually have access.
 */
export function shareViewUrl(projectUrl, projectId) {
  try {
    const u = new URL(projectUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return `https://${projectId}.${DEFAULT_CLOUD_HOST}`;
  }
}

/** Where Maude Cloud lives by default — mirrors the Rust opener's compiled host. */
const DEFAULT_CLOUD_URL = 'https://cloud.maude.sh';
const DEFAULT_CLOUD_HOST = 'cloud.maude.sh';

/**
 * Fold a name the way the PLATFORM does, so a folder and a project id can be
 * compared at all.
 *
 * This mirrors `deriveProjectId` (apps/cloud/checkout.mjs) deliberately, NFKD
 * strip and 40-char cap included. A plain kebab-case fold looked equivalent and
 * wasn't: `Zkušební tým` derives the id `zkusebni-tym` on the platform but folded
 * to `zku-ebn-t-m` here, so every accented project name failed to match its own
 * workspace and warned on a perfectly legitimate connect — and any name over 40
 * characters did the same, because the platform truncates and this didn't. A
 * warning that fires on correct behaviour is a warning people learn to dismiss.
 */
const norm = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40)
    .replace(/-+$/, '');

/** The host an address carries, or '' if it isn't a readable URL. */
const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

/** The project label a cell address carries, or '' if it carries none. */
function projectFromHubUrl(hubUrl, cloudHost) {
  const host = hostOf(hubUrl);
  if (!cloudHost || host === cloudHost) return '';
  // `<project>.cloud.maude.sh` — only meaningful INSIDE the configured zone.
  if (!host.endsWith(`.${cloudHost}`)) return '';
  return norm(host.slice(0, -(cloudHost.length + 1)).replace(/^view-/, ''));
}

/**
 * Is this project row the one THIS folder is already linked to?
 *
 * Fix 7 of the 2026-08-10 sync RCA: every row used to render the same
 * `Connect <name>` button, including the project this folder was already
 * syncing with — the UI lying about an established link. Only a CREDENTIALED
 * link counts (the `linkedHub` half alone comes from a committed config.json —
 * attacker-authorable, B2), so a linked-but-uncredentialed row still offers
 * Connect: it genuinely needs the sign-in.
 *
 * Addresses inside the configured cloud zone compare by the project label they
 * carry (`projectFromHubUrl`, NFKD-folded like the platform); addresses that
 * carry none (self-hosts, e2e stubs at `http://127.0.0.1:<port>`) fall back to
 * an exact origin match, so two stubs on different ports never collapse.
 */
export function isLinkedProjectRow({ projectUrl, linkedHubUrl, linkedHubCredentialed, cloudUrl }) {
  if (!linkedHubUrl || !linkedHubCredentialed) return false;
  const cloudHost = hostOf(cloudUrl);
  const linked = projectFromHubUrl(linkedHubUrl, cloudHost);
  const row = projectFromHubUrl(projectUrl, cloudHost);
  if (linked && row) return linked === row;
  try {
    return new URL(String(projectUrl)).origin === new URL(String(linkedHubUrl)).origin;
  } catch {
    return false;
  }
}

/**
 * Does this folder look like the cloud project a link is naming?
 *
 * A hint about a decision the person makes — never an authorization gate. It
 * exists because the confusing half of "Open in Maude" is that it attaches
 * whatever folder happens to be open, so somebody with one project open who
 * presses it on another is one click from syncing the wrong designs into the
 * wrong workspace.
 *
 * WHAT THIS FUNCTION LEARNED THE HARD WAY (attacker pass 2026-08-04, B1): the
 * first version treated a near-match — either name containing the other — as
 * agreement, to avoid crying wolf over `alligators-web` vs `alligators`. That
 * reasoning assumed a NON-ADVERSARIAL name collision. It isn't one: the name
 * being compared against is a cloud project id, which anyone can register. An
 * attacker registers `alligators-design-sync`, it contains `alligators`, and the
 * hint falls silent on exactly the case it exists for. The server's 409 does not
 * stand behind it either, because the claim and the actual project agree — it
 * genuinely IS the attacker's project.
 *
 * So a near-match no longer resolves to "fine". It gets its OWN state, and says
 * out loud that two similar names are still two different workspaces. Only an
 * exact match (or a credentialed link) is silent.
 *
 * States: 'linked' (a real, credentialed link to this project) · 'match' (the
 * names are the same) · 'similar' (alike but NOT the same — warn, softly) ·
 * 'mismatch' (unrelated, or linked elsewhere — warn) · 'unknown' (no signal:
 * status hasn't resolved, or the addresses carry no project name, as on every
 * self-host and e2e stub at `http://127.0.0.1:<port>`). 'unknown' warns too —
 * quietly, because failing open here is what B3 was.
 */
export function localIdentityHint({
  localProject,
  linkedHubUrl,
  linkedHubCredentialed,
  cloudUrl,
  claimed,
  resolved = true,
}) {
  if (!resolved) return 'unknown';
  const want = norm(claimed);
  if (!want) return 'unknown';

  // A linkedHub only reassures when a stored credential corroborates it — the
  // config file it comes from is committed and travels with the repo (B2).
  const linkedProject = linkedHubUrl ? projectFromHubUrl(linkedHubUrl, hostOf(cloudUrl)) : '';
  if (linkedProject && linkedHubCredentialed) {
    return linkedProject === want ? 'linked' : 'mismatch';
  }

  // Otherwise the folder's own name is the signal — the one that catches the
  // reported case (one project open, "Open in Maude" pressed on another).
  const local = norm(localProject);
  if (!local) return 'unknown';
  if (local === want) return 'match';
  const shorter = local.length <= want.length ? local : want;
  const related = shorter.length >= 4 && (local.includes(want) || want.includes(local));
  return related ? 'similar' : 'mismatch';
}

/**
 * What to say after a successful Connect.
 *
 * The old copy said "Linked to <X> — restart the studio server to start
 * syncing", which was three problems in one line: it named a thing the person
 * cannot see (there is no visible server in the desktop app), gave them a task
 * instead of a result, and never explained what connecting had achieved. The
 * server now cycles the sync runtime itself, so this reports an OUTCOME —
 * and on the paths where syncing genuinely didn't start, it says which one and
 * what to do, rather than prescribing a restart for every cause.
 *
 * Returns `{ text, title }` — `text` is the rail's one line, `title` the full
 * sentence on hover (the rail truncates).
 */
export function connectOutcomeNote(project, sync, live) {
  // The project name and `sync.detail` both originate at the hub, and the
  // fallback path below puts them in trusted app chrome uncapped — including a
  // `title=` tooltip, where a newline renders. `safeName` strips control and
  // bidi-override characters, collapses whitespace and bounds the length; the
  // live path already went through it inside `syncPresentation`.
  const name = safeName(project, 'the workspace');

  // The LIVE payload wins whenever there is one.
  //
  // `sync` is the attach response, and it reports an intention: the supervisor
  // answers `{ syncing: true }` as soon as `runtime.start()` did not throw and
  // one local canvas qualified — before a socket, before a token was accepted,
  // before a byte moved. Rendered once and never updated, it was the whole of
  // the reported complaint ("vyskočí modal, pak vidím jen syncing canvases, ale
  // reálně se nic nestane"). `live` comes off the `sync:status` bus that is
  // already wired to this app, so the same sentence now MOVES: connecting →
  // syncing 40/75 → synced. That motion is the feedback that was missing.
  //
  // Same rule as the status bar (`syncPresentation`), deliberately — the old
  // hover text told the person to go look at that slot for the real answer,
  // which only worked as long as the two agreed, and they did not.
  if (live) {
    const p = syncPresentation(live, { project: name });
    if (p) {
      const detail = p.names.length ? ` (${p.names.join(', ')})` : '';
      return {
        text: p.title,
        title: `${p.title}${detail}${p.next ? ` — ${p.next}` : ''}`,
      };
    }
  }

  if (sync?.syncing) {
    const n = sync.canvases ?? 0;
    return {
      text: `Connecting to ${name} — ${n} canvas${n === 1 ? '' : 'es'}…`,
      title: `Opening ${n} canvas${n === 1 ? '' : 'es'} against the ${name} workspace. This line updates as they settle.`,
    };
  }
  if (sync?.reason === 'nothing-syncable') {
    return {
      text: `Connected to ${name} — nothing to sync yet.`,
      title: safeName(sync.detail, 'No canvases in this project are syncable yet.'),
    };
  }
  const detail = safeName(sync?.detail, 'restart Maude to start syncing.');
  return {
    text: `Connected to ${name} — ${detail}`,
    title: detail,
  };
}

function Spark({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      <path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" />
    </svg>
  );
}

function Icon({ name, size = 15 }) {
  const p = {
    'chevron-up': <polyline points="3.5 10 8 5.5 12.5 10" />,
    check: <polyline points="3 8.5 6.5 12 13 4.5" />,
    external: (
      <>
        <path d="M6 3.5H3.2A.7.7 0 0 0 2.5 4.2v8.6a.7.7 0 0 0 .7.7h8.6a.7.7 0 0 0 .7-.7V10" />
        <line x1="8" y1="8" x2="13" y2="3" />
        <polyline points="9.5 3 13 3 13 6.5" />
      </>
    ),
    copy: (
      <>
        <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.2" />
        <path d="M3 10.5V3.2A.7.7 0 0 1 3.7 2.5H10" />
      </>
    ),
    // Direction, not departure — the decision modal's two sides are joined by
    // "flows into", and the `external` glyph read as "opens in the browser".
    'arrow-right': (
      <>
        <line x1="2.5" y1="8" x2="12.5" y2="8" />
        <polyline points="9 4.5 12.5 8 9 11.5" />
      </>
    ),
    link: (
      <>
        <path d="M6.5 9.5l3-3" />
        <path d="M7.5 4.5l1-1a2.47 2.47 0 0 1 3.5 3.5l-1 1" />
        <path d="M8.5 11.5l-1 1a2.47 2.47 0 0 1-3.5-3.5l1-1" />
      </>
    ),
    signout: (
      <>
        <path d="M6.5 13.5H3.2a.7.7 0 0 1-.7-.7V3.2a.7.7 0 0 1 .7-.7h3.3" />
        <line x1="13" y1="8" x2="6.5" y2="8" />
        <polyline points="10 5 13 8 10 11" />
      </>
    ),
  }[name];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p}
    </svg>
  );
}

// `onLinkedHub` lifts the resolved link state to the app shell (DDR-218): the
// GitPanel's cloud-managed posture turns on the same `linkedHub.credentialed`
// fact this panel's Connected row does, and CloudBar owns every action that
// changes it (status resolve, attach, detach) — so it reports, the app decides.
export default function CloudBar({ syncStatus, onLinkedHub, onLocalProject, onOpenFile, filesReady }) {
  const [state, setState] = useState('loading'); // loading | out | in
  const [email, setEmail] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [device, setDevice] = useState(null); // { userCode, verificationUrl, deviceCode }
  const [projects, setProjects] = useState(null);
  const [busy, setBusy] = useState('');
  // What the last Connect attached, NOT the sentence it produced.
  //
  // This used to hold the rendered `{ text, title }`, which is why the note was
  // frozen: a string computed once at the moment the dialog closed could only
  // ever describe that moment. Keeping the INPUTS and deriving the sentence on
  // every render is the whole liveness mechanism — `syncStatus` arrives on the
  // already-wired `sync:status` bus, so no polling and no second fetch.
  const [connected, setConnected] = useState(null); // { project, sync }
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [openFailed, setOpenFailed] = useState(''); // '' | 'refused' | 'failed'
  const [cloudUrl, setCloudUrl] = useState('https://cloud.maude.sh');
  // `resolved` gates the deep-link dialog: rendering the decision before the
  // data it turns on made the hint fail OPEN on the launch path (B3).
  const [local, setLocal] = useState({ project: '', linkedHub: null, resolved: false });
  const [pending, setPending] = useState(null); // { project, code } from maude://
  const railRef = useRef(null);
  const pollRef = useRef(null);

  // Derived, not stored — so the sentence follows the link instead of freezing
  // at the instant the confirm dialog closed. `syncStatus` is the live payload
  // App already receives; when it is absent (older server, first render) the
  // attach response is still the fallback and the note degrades to what it
  // said before, never to nothing.
  const note = connected
    ? connectOutcomeNote(connected.project, connected.sync, syncStatus)
    : null;

  useEffect(() => {
    api('/_api/cloud/status')
      .then((r) => {
        if (r.json?.url) setCloudUrl(r.json.url);
        // Resolved even on an error body — what must never happen is staying
        // un-resolved forever and leaving the dialog unreachable; an empty
        // project name resolves to 'unknown', which warns rather than reassures.
        setLocal({
          project: r.json?.project ?? '',
          linkedHub: r.json?.linkedHub ?? null,
          resolved: true,
        });
        onLinkedHub?.(r.json?.linkedHub ?? null);
        onLocalProject?.(r.json?.project ?? null);
        if (r.ok && r.json?.connected) {
          setEmail(r.json.email);
          setState('in');
        } else setState('out');
      })
      .catch(() => {
        // A rejected fetch (the sidecar restarting under a launch-path deep link)
        // would otherwise leave `resolved` false forever — and since the dialog
        // is gated on it, the parked link would never be shown at all, silently
        // burning a one-shot two-minute code. Resolve into the 'unknown' branch,
        // which warns, and let the rail fall back to signed-out.
        setLocal((l) => ({ ...l, resolved: true }));
        setState('out');
      });
    return () => clearInterval(pollRef.current);
  }, []);

  // maude:// deep links (Phase 17) — native shell only. The link that LAUNCHED
  // the app is parked in the shell (take once); links while running arrive as
  // events. Either way: ask, never auto-connect.
  useEffect(() => {
    if (!isNativeApp()) return undefined;
    const consume = (url) => {
      const connect = parseDeepLink(url);
      const file = connect ? null : parseFileDeepLink(url);
      const parsed = connect ? { ...connect, kind: 'connect' } : file ? { ...file, kind: 'file' } : null;
      if (!parsed) return;
      // NEVER replace a link the person is already looking at. The dialog is a
      // single slot, so an overwrite would swap the code out from under a
      // click that was aimed at the previous one — the person confirms the
      // name they read and connects the link that arrived last (validate
      // 2026-07-30, attacker A1). A second link waits its turn instead.
      setPending((current) => current ?? parsed);
    };
    invoke('take_pending_deep_link')
      .then((url) => url && consume(url))
      .catch(() => {});
    let unlisten = null;
    listen('maude://deep-link', consume).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  const fileMatches = pending?.kind === 'file' && local.resolved && localIdentityMatches(local, pending.project);
  useEffect(() => {
    if (!fileMatches || !filesReady || !onOpenFile) return;
    onOpenFile(pending.rel);
    setPending(null);
  }, [fileMatches, filesReady, pending, onOpenFile]);

  async function connectPending() {
    if (!pending) return;
    setBusy('deeplink');
    setError('');
    const r = await api('/_api/cloud/attach/code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Send the project the LINK claimed — the one this person just read in
      // the confirm strip. The server compares it against what the exchange
      // actually opens and refuses a mismatch, so a familiar name wrapped
      // around somebody else's code cannot borrow that consent.
      body: JSON.stringify({ code: pending.code, project: pending.project }),
    });
    setBusy('');
    setPending(null);
    if (r.ok && r.json?.ok) {
      setConnected({ project: r.json.project ?? pending.project, sync: r.json.sync });
      adoptLink(r.json.url);
    } else {
      setError(r.json?.error || 'The workspace could not be connected.');
    }
  }

  // Plan T22: the link's project opened as ITS OWN copy — the designer's
  // default, and the one answer that can't sync the wrong folder anywhere. The
  // server still checks the claimed name against what the code opens.
  async function openPendingManaged() {
    if (!pending) return;
    setBusy('deeplink');
    setError('');
    const r = await openTeamProject({ kind: 'handoff', code: pending.code, claimedProject: pending.project });
    setPending(null);
    if (!r.ok) {
      setBusy('');
      setError(r.error || 'The project could not be opened.');
    }
  }

  // A successful attach IS a credentialed link — mirror it into `local` so the
  // project list flips to Connected without a second status fetch (the server
  // just wrote both halves: linkedHub in config.json + the hub credential).
  function adoptLink(url) {
    if (typeof url === 'string' && url) {
      setLocal((l) => ({ ...l, linkedHub: { url, credentialed: true } }));
      onLinkedHub?.({ url, credentialed: true });
    }
  }

  // Escape answers the decision modal the same way the scrim does: Not now.
  // Declining must always be the cheap move — the dashboard re-mints a code on
  // the next "Open in Maude".
  useEffect(() => {
    if (!pending) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setPending(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pending]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDoc = (e) => {
      if (railRef.current && !railRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  async function startSignIn() {
    setError('');
    const r = await api('/_api/cloud/signin/start', { method: 'POST' });
    if (!r.ok || !r.json?.ok) {
      setError(r.json?.error || 'Maude Cloud could not be reached.');
      return;
    }
    setDevice(r.json);
    setOpenFailed('');
    openExternal(r.json.verificationUrl).then((s) => setOpenFailed(s === 'ok' ? '' : s));
    pollRef.current = setInterval(async () => {
      const p = await api('/_api/cloud/signin/poll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceCode: r.json.deviceCode }),
      });
      if (p.json?.pending) return;
      clearInterval(pollRef.current);
      if (p.ok && p.json?.ok) {
        setEmail(p.json.email);
        setState('in');
        setDevice(null);
      } else {
        setDevice(null);
        setError(p.json?.error || 'The sign-in did not finish. Try again.');
      }
    }, (r.json.interval ?? 5) * 1000);
  }

  function cancelSignIn() {
    clearInterval(pollRef.current);
    setDevice(null);
  }

  async function openMenu() {
    const next = !menuOpen;
    setMenuOpen(next);
    if (next && projects === null) {
      const r = await api('/_api/cloud/projects');
      setProjects(r.ok && r.json?.ok ? r.json.projects : []);
      if (!r.ok && r.status === 401) {
        setMenuOpen(false);
        setState('out');
        setEmail(null);
      }
    }
  }

  async function connect(projectId) {
    setBusy(projectId);
    setConnected(null);
    setError('');
    const r = await api('/_api/cloud/attach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: projectId }),
    });
    setBusy('');
    if (r.ok && r.json?.ok) {
      setConnected({ project: r.json.project ?? projectId, sync: r.json.sync });
      adoptLink(r.json.url);
    } else {
      setError(r.json?.error || 'The workspace could not be connected.');
    }
    setMenuOpen(false);
  }

  /** The in-app `maude design unlink` — drops the link AND stops syncing now. */
  async function disconnect() {
    setBusy('disconnect');
    setError('');
    const r = await api('/_api/cloud/detach', { method: 'POST' });
    setBusy('');
    setMenuOpen(false);
    if (r.ok && r.json?.ok) {
      setLocal((l) => ({ ...l, linkedHub: null }));
      setConnected(null);
      onLinkedHub?.(null);
    } else {
      setError(r.json?.error || 'The workspace could not be disconnected.');
    }
  }

  async function signOut() {
    setMenuOpen(false);
    await api('/_api/cloud/signout', { method: 'POST' });
    setEmail(null);
    setProjects(null);
    setState('out');
  }

  // One clipboard write, one 1.5 s "Copied" flash. The code and the link are the
  // same gesture, so they share the mechanism — and both swallow a refusal
  // (no clipboard permission) silently: the value is on screen either way.
  function copyToClipboard(text, mark) {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(
      () => {
        mark(true);
        setTimeout(() => mark(false), 1500);
      },
      () => {}
    );
  }

  const copyCode = () => copyToClipboard(device?.userCode, setCopied);
  const copyLink = () => copyToClipboard(device?.verificationUrl, setCopiedLink);

  if (state === 'loading') return null;

  const hint = pending
    ? localIdentityHint({
        localProject: local.project,
        linkedHubUrl: local.linkedHub?.url,
        linkedHubCredentialed: local.linkedHub?.credentialed,
        cloudUrl,
        claimed: pending.project,
        resolved: local.resolved,
      })
    : 'unknown';
  // Anything but a clean, corroborated agreement gets the warning treatment and
  // a demoted Connect. Silence is reserved for the two cases we can vouch for.
  const reassured = hint === 'linked' || hint === 'match';

  return (
    <div className="gi-rail cb-rail" ref={railRef} data-testid="cloud-bar">
      {/* Not until `local` has resolved: the launch-path deep link can beat the
          status fetch, and a modal rendered without the local half showed no
          warning and a primary Connect — failing OPEN in the one scenario with
          the least context (attacker pass B3). */}
      {pending?.kind === 'file' && local.resolved && !fileMatches && <FileDeepLinkDialog key={pending.project + pending.rel} pending={pending} local={local} cloudUrl={cloudUrl} onClose={() => setPending(null)} />}
      {pending?.kind === 'connect' && local.resolved && (
        <div
          className="gi-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`Connect this folder to ${pending.project}`}
        >
          <div className="gi-scrim" aria-hidden="true" onClick={() => setPending(null)} />
          <div className="gi-dialog gi-dialog--code" data-testid="cloud-deeplink-dialog">
            <div className="gi-dc-head">
              <span className="gi-dc-marks"><Icon name="link" size={24} /></span>
              <h2>Connect to {pending.project}?</h2>
            </div>
            {/* Both sides, named. The old strip said "Connect this project to X?"
                — which never told anyone WHICH project "this" was, the one thing
                the decision turns on. */}
            <div className="gi-dl-pair">
              <span className="gi-dl-side">
                <span className="gi-dl-lbl">This folder</span>
                <span className="gi-dl-val" data-testid="cloud-deeplink-local">{local.project || 'the open project'}</span>
              </span>
              <span className="gi-dl-arrow" aria-hidden="true"><Icon name="arrow-right" size={16} /></span>
              <span className="gi-dl-side">
                <span className="gi-dl-lbl">Cloud project</span>
                <span className="gi-dl-val">{pending.project}</span>
              </span>
            </div>
            <p className="gi-dl-what">
              This folder’s <code>.design/</code> canvases will sync with the {pending.project}{' '}
              workspace. Nothing else in this repo is uploaded.
            </p>
            {hint === 'linked' && (
              <p className="gi-dl-note">This folder is already linked to {pending.project} — connecting refreshes the link.</p>
            )}
            {!reassured && (
              <div className="gi-dl-warn" data-testid="cloud-deeplink-mismatch">
                <strong>
                  {hint === 'similar' ? (
                    <>
                      {local.project} and {pending.project} are different workspaces.
                    </>
                  ) : hint === 'unknown' ? (
                    <>Maude can’t tell which project this folder is.</>
                  ) : (
                    <>
                      This folder looks like {local.project || 'something else'}, not{' '}
                      {pending.project}.
                    </>
                  )}
                </strong>
                <span>
                  Connecting will sync <em>this folder’s</em> designs into {pending.project}. If you
                  meant to work on {pending.project}, open its folder in Maude and press “Open in
                  Maude” again. Don’t have it on this machine? It opens in{' '}
                  {isDisplayableUrl(cloudUrl, cloudUrl) ? (
                    <a
                      className="gi-dc-link-a"
                      href={cloudUrl}
                      rel="noopener noreferrer"
                      target="_blank"
                      onClick={(e) => {
                        e.preventDefault();
                        openExternal(cloudUrl);
                      }}
                    >
                      your browser
                    </a>
                  ) : (
                    'your browser'
                  )}
                  .
                </span>
              </div>
            )}
            {isNativeApp() && (
              <div className="gi-dl-open">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy === 'deeplink'}
                  onClick={openPendingManaged}
                  data-testid="cloud-deeplink-open"
                >
                  {busy === 'deeplink' ? 'Opening…' : `Open ${pending.project}`}
                </button>
                <span className="gi-dc-foot-note">
                  Opens the project in its own copy on this computer. Nothing in this folder changes.
                </span>
              </div>
            )}
            <div className="gi-dc-foot">
              {/* On a mismatch the safe action leads and connecting is the one you
                  have to mean. No project switcher lives here on purpose: the
                  handoff code is one-shot with a two-minute life, and a switch
                  restarts the server — the person would come back to a dead code
                  and a question they already answered. */}
              {!reassured ? (
                <>
                  <button type="button" className="btn" onClick={() => setPending(null)} data-testid="cloud-deeplink-dismiss">
                    Not now
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={busy === 'deeplink'}
                    onClick={connectPending}
                    data-testid="cloud-deeplink-connect"
                  >
                    {busy === 'deeplink' ? 'Connecting…' : 'Connect anyway'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy === 'deeplink'}
                    onClick={connectPending}
                    data-testid="cloud-deeplink-connect"
                  >
                    {busy === 'deeplink' ? 'Connecting…' : 'Connect'}
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={() => setPending(null)} data-testid="cloud-deeplink-dismiss">
                    Not now
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {state === 'out' && (
        <>
          <button type="button" className="btn btn--ghost btn--sm gi-rail-signin" onClick={startSignIn} data-testid="cloud-signin">
            <Spark size={14} /> Sign in to Maude Cloud
          </button>
          {error && <span className="gi-rail-err" title={error}>{error}</span>}
        </>
      )}

      {state === 'in' && (
        <>
          <button
            type="button"
            className={'gi-rail-account' + (menuOpen ? ' is-open' : '')}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={openMenu}
            title={`Maude Cloud — ${email ?? 'connected'}`}
            data-testid="cloud-account"
          >
            <span className="gi-avatar gi-avatar--fallback" aria-hidden="true"><Spark size={14} /></span>
            <span className="gi-rail-login">{email ?? 'Maude Cloud'}</span>
            <span className="gi-rail-caret"><Icon name="chevron-up" size={13} /></span>
          </button>
          {/* A live region: the sentence now CHANGES as the link settles, and a
              screen-reader user has to hear that transition rather than only
              whatever text happened to be there when they last tabbed past.
              `polite` — it is progress, never an interruption. */}
          {note && (
            <span
              className="gi-rail-hint"
              title={note.title}
              role="status"
              aria-live="polite"
              data-testid="cloud-connect-note"
            >
              {note.text}
            </span>
          )}
          {error && <span className="gi-rail-err" title={error}>{error}</span>}
          {menuOpen && (
            <div className="gi-menu" role="menu" aria-label="Maude Cloud">
              <div className="gi-menu-hd">
                <span className="gi-avatar gi-avatar--fallback" aria-hidden="true"><Spark size={16} /></span>
                <span className="gi-menu-id">
                  <span className="gi-menu-name">Maude Cloud</span>
                  <span className="gi-menu-login">{email ?? 'connected'}</span>
                </span>
              </div>
              {projects === null && <div className="gi-menu-item" aria-disabled="true">Loading projects…</div>}
              {Array.isArray(projects) && projects.length === 0 && (
                <div className="gi-menu-item" aria-disabled="true">No projects yet — start one on the dashboard.</div>
              )}
              {Array.isArray(projects) &&
                projects.map((p) =>
                  p.role === 'viewer' ? (
                    // Viewer dignity (Phase 17 T4): no dead Connect that would
                    // 403 at the workspace — viewing has a first-class home in
                    // the browser, and the label says why.
                    <button
                      key={p.id}
                      type="button"
                      className="gi-menu-item"
                      role="menuitem"
                      onClick={() => openExternal(shareViewUrl(p.url, p.id))}
                      title="Viewing works in the browser. Editing in the app needs the member role — ask whoever runs the project."
                      data-testid={`cloud-project-${p.id}`}
                    >
                      <Icon name="external" size={15} /> View {p.name || p.id} in the browser
                      <span className="gi-menu-login" style={{ marginLeft: 'auto' }}>viewer</span>
                    </button>
                  ) : isLinkedProjectRow({
                      projectUrl: p.url,
                      linkedHubUrl: local.linkedHub?.url,
                      linkedHubCredentialed: local.linkedHub?.credentialed,
                      cloudUrl,
                    }) ? (
                    // The project this folder is ALREADY linked to. Connected is
                    // a state, not an action — the one action left is leaving.
                    // (Same wrapper shape as the "Loading projects…" row; the
                    // button is the focusable menu entry.)
                    <div
                      key={p.id}
                      className="gi-menu-item is-connected"
                      data-testid={`cloud-project-${p.id}`}
                    >
                      <Icon name="check" size={15} /> {p.name || p.id}
                      <span className="gi-menu-login" style={{ marginLeft: 'auto' }}>Connected</span>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        role="menuitem"
                        disabled={busy === 'disconnect'}
                        onClick={disconnect}
                        aria-label={`Disconnect this folder from ${p.name || p.id}`}
                        data-testid={`cloud-disconnect-${p.id}`}
                      >
                        {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
                      </button>
                    </div>
                  ) : (
                    <button
                      key={p.id}
                      type="button"
                      className="gi-menu-item"
                      role="menuitem"
                      disabled={busy === p.id}
                      onClick={() => connect(p.id)}
                      title={`Connect this project to ${p.url} (${p.role})`}
                      data-testid={`cloud-project-${p.id}`}
                    >
                      <Icon name="link" size={15} /> {busy === p.id ? 'Connecting…' : `Connect ${p.name || p.id}`}
                      <span className="gi-menu-login" style={{ marginLeft: 'auto' }}>{p.stateLabel}</span>
                    </button>
                  )
                )}
              <div className="gi-menu-sep" />
              <button type="button" className="gi-menu-item" role="menuitem" onClick={() => openExternal(cloudUrl)}>
                <Icon name="external" size={15} /> Open the dashboard
              </button>
              <button type="button" className="gi-menu-item gi-menu-item--danger" role="menuitem" onClick={signOut}>
                <Icon name="signout" size={15} /> Sign out
              </button>
            </div>
          )}
        </>
      )}

      {device && (
        <div className="gi-modal" role="dialog" aria-modal="true" aria-label="Sign in to Maude Cloud" onKeyDown={(e) => { if (e.key === 'Escape') cancelSignIn(); }}>
          <div className="gi-scrim" aria-hidden="true" onClick={cancelSignIn} />
          <div className="gi-dialog gi-dialog--code" data-testid="cloud-device-dialog">
            <div className="gi-dc-head">
              <span className="gi-dc-marks"><Spark size={26} /></span>
              <h2>Sign in to Maude Cloud</h2>
              {/* Says what to DO, not what supposedly already happened. The old
                  copy claimed the browser had opened — a claim this surface
                  cannot make, since the shell's open is best-effort and the
                  person is the one who finds out it didn't. */}
              <p>Confirm this code on your Maude Cloud dashboard to connect.</p>
            </div>
            <div className="gi-code">
              <span className="gi-code-val" data-testid="cloud-user-code">{device.userCode}</span>
              <button type="button" className="btn btn--ghost gi-code-copy" onClick={copyCode} aria-label="Copy the code">
                <Icon name="copy" size={15} /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            {/* The manual path, always present — never conditional on whether the
                open "worked". It is the only thing standing between an older
                shell / a drifted self-host origin / a blocked popup and a dead
                end. The address already carries the code (`/activate?code=…`),
                so following it is one click, not a re-type. */}
            {device.verificationUrl && isDisplayableUrl(device.verificationUrl, cloudUrl) && (
              <div className="gi-dc-link">
                <span className="gi-dc-link-lbl">
                  {openFailed === 'failed'
                    ? 'Maude couldn’t open your browser. Open this address yourself:'
                    : 'If your browser didn’t open, go to:'}
                </span>
                <div className="gi-dc-link-row">
                  <a
                    className="gi-dc-url gi-dc-link-a"
                    href={device.verificationUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                    data-testid="cloud-signin-link"
                    onClick={(e) => {
                      e.preventDefault();
                      openExternal(device.verificationUrl).then((s) =>
                        setOpenFailed(s === 'ok' ? '' : s)
                      );
                    }}
                  >
                    {device.verificationUrl}
                  </a>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={copyLink} aria-label="Copy the link">
                    <Icon name="copy" size={14} /> {copiedLink ? 'Copied' : 'Copy link'}
                  </button>
                </div>
              </div>
            )}
            {openFailed === 'refused' && (
              // A REFUSAL is not "your browser didn't open" — it is Maude saying
              // that address isn't Maude Cloud. Saying so, and NOT offering to
              // help open it, is the whole difference (attacker re-review NEW-2).
              <div className="gi-dl-warn" data-testid="cloud-signin-refused">
                <strong>Maude wouldn’t open that address.</strong>
                <span>It isn’t a Maude Cloud address. Sign in on your dashboard instead.</span>
              </div>
            )}
            {device.verificationUrl && !isDisplayableUrl(device.verificationUrl, cloudUrl) && (
              // An address we won't put behind a link or a copy button. Naming it
              // is the point — silently dropping it would look like a bug.
              <div className="gi-dl-warn" data-testid="cloud-signin-badurl">
                <strong>Maude Cloud sent an address that doesn’t look right.</strong>
                <span>
                  Nothing was opened. Sign in on your dashboard directly instead of following it.
                </span>
              </div>
            )}
            <div className="gi-dc-status" aria-live="polite">
              <span className="gi-pulse" aria-hidden="true" />
              <span>Waiting for you to confirm in the browser…</span>
            </div>
            <div className="gi-dc-foot">
              <button type="button" className="btn btn--ghost" onClick={cancelSignIn}>Cancel</button>
              <span className="gi-dc-foot-note">Nothing is stored until you confirm.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
