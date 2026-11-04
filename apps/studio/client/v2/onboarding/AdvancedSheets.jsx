// client/v2/onboarding/AdvancedSheets.jsx — Home's host for the five Advanced sheets (02 ob-adv-sheets, S6.9).
// One id (client/v2/signin/advanced-rows.js) = one sheet; this is the only place that knows which Home route or
// shell command a sheet's button runs. Each sheet is a view (exported from ./index.js for S11.14), so Settings ›
// Connections mounts the same sheets with its own wiring.
//
//   hub            → /_home/hub/test; Sign in (#204 K2) → /_home/hub/signin/start, the shell opens the hub's
//                    own page (`open_team_server_signin`; with an invite, the hub's invite page), poll until
//                    the browser came back, then /_home/hub/prepare and Home's own open of the managed copy
//   folder-github  → the shell's folder picker (`open_project_folder`); "From GitHub" (S6.10) → Rust's
//                    github_repos / home_github_sign_in / github_clone / github_create, then `open_project({root})`
//   ai             → /_home/ai/{status,connect}  (install Claude Code, then the browser sign-in)
//   cli            → /_home/cli/{status,install} (a link to the bundled maude; the plugin when claude is there)
//   figma          → the target project opens with the `import-figma` intent (Q8)
//
// No credential reaches a log or comes back into the page: the app owns no team-server password (the hub's
// own page in the browser takes it, issue #204); the AI sign-in is the person's browser; nothing here stores
// a token.

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  aiConnect,
  aiStatus,
  cliInstall,
  cliStatus,
  hubPrepare,
  hubSignInCancel,
  hubSignInPoll,
  hubSignInStart,
  hubTest,
  inShell,
  openProject,
  openProjectFolder,
  openTeamServerSignIn,
  shellListen,
} from '../../home/home-api.js';
import { useGithubSegment } from './GithubSegment.jsx';
import { ConnectAiSheet } from './ConnectAiSheet.jsx';
import { CliSheet } from './CliSheet.jsx';
import { FigmaSheet } from './FigmaSheet.jsx';
import { FolderGithubSheet } from './FolderGithubSheet.jsx';
import { HubSheet } from './HubSheet.jsx';
import { connectClaudeHome } from './connect-ai-home.js';
import { HUB_WORDS } from './onboarding-model.js';

const CLI_POLL_MS = 1500;

function AiSheet({ onClose }) {
  const [connected, setConnected] = useState(false);
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState(null);
  const abort = useRef(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    aiStatus().then((r) => {
      if (alive.current && r.json?.available === true) setConnected(true);
    });
    return () => {
      alive.current = false;
      abort.current?.abort();
    };
  }, []);

  const connect = async () => {
    if (phase !== 'idle') return;
    setError(null);
    abort.current = new AbortController();
    const r = await connectClaudeHome({
      status: aiStatus,
      connect: aiConnect,
      signal: abort.current.signal,
      onPhase: (p) => alive.current && setPhase(p),
    });
    if (!alive.current) return;
    setPhase('idle');
    if (r.ok) {
      setConnected(true);
      setTimeout(() => alive.current && onClose(), 900);
    } else if (r.reason !== 'cancelled') setError(r.reason);
  };
  const cancel = () => {
    abort.current?.abort(); // withdraws the sign-in
    onClose();
  };
  return (
    <ConnectAiSheet
      connected={connected}
      phase={phase}
      error={error}
      onConnect={connect}
      onCancel={cancel}
    />
  );
}

function CliHost({ onClose }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const alive = useRef(true);
  const read = useCallback(async () => {
    const r = await cliStatus();
    if (alive.current && r.json && typeof r.json === 'object') setStatus(r.json);
    return r.json;
  }, []);
  useEffect(() => {
    alive.current = true;
    read();
    return () => {
      alive.current = false;
    };
  }, [read]);
  // the plugin step runs on after the link is made: follow it until it lands
  const running = status?.plugin?.phase === 'running';
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(read, CLI_POLL_MS);
    return () => clearInterval(t);
  }, [running, read]);

  const install = async () => {
    setBusy(true);
    setError(null);
    const r = await cliInstall();
    if (!alive.current) return;
    setBusy(false);
    if (r.json && typeof r.json === 'object' && typeof r.json.state === 'string') setStatus(r.json);
    if (!r.ok) setError(typeof r.json?.error === 'string' ? r.json.error : "Couldn't install it.");
  };
  return (
    <CliSheet status={status} busy={busy} error={error} onInstall={install} onCancel={onClose} />
  );
}

function FolderHost({ onClose, openFolder, profile, github: gh }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // S6.10: the GitHub segment — Rust lists, signs in and clones for `profile`; the clone opens as a tab
  const github = useGithubSegment({
    profile,
    invoke: gh?.invoke,
    listen: gh?.listen ?? shellListen,
    openRoot: gh?.openRoot ?? ((root) => openProject({ root })),
    onDone: onClose,
    setBusy,
    setError,
  });
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await openFolder();
      onClose();
    } catch (e) {
      setBusy(false);
      setError(typeof e === 'string' ? e : e?.message || "Couldn't open that folder.");
    }
  };
  return (
    <FolderGithubSheet
      busy={busy}
      error={error}
      onOpenFolder={go}
      onCancel={onClose}
      github={gh || inShell() ? github : null}
    />
  );
}

function FigmaHost({ target, onClose, startFigma }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const go = async (link = '') => {
    setBusy(true);
    setError(null);
    const ok = await startFigma(link);
    if (ok === false) {
      setBusy(false);
      setError("Couldn't open the project. Nothing changed.");
      return;
    }
    onClose();
  };
  return <FigmaSheet target={target} busy={busy} error={error} onImport={go} onCancel={onClose} />;
}

/** How often Home asks whether the browser came back (the hub's code lives a minute). */
export const HUB_POLL_MS = 1500;

/**
 * #204 K2 — the hub sheet's host: Sign in opens the hub's own page and waits for the browser to come back to
 * Home's server; Cancel forgets the attempt (a late return then changes nothing). `pollMs` is a test seam.
 */
function HubHost({ onClose, profile, openPrepared, pollMs = HUB_POLL_MS }) {
  const attempt = useRef(null); // { id, stop: (r) => void }
  useEffect(
    () => () => {
      const a = attempt.current;
      attempt.current = null;
      if (a) {
        a.stop({ ok: false, cancelled: true });
        void hubSignInCancel(a.id);
      }
    },
    []
  );

  const waitForBrowser = (id) =>
    new Promise((resolve) => {
      let timer = null;
      const stop = (r) => {
        clearTimeout(timer);
        resolve(r);
      };
      attempt.current = { id, stop };
      const tick = async () => {
        const p = await hubSignInPoll(id);
        if (attempt.current?.id !== id) return; // cancelled meanwhile
        if (p.json?.pending) {
          timer = setTimeout(tick, pollMs);
          return;
        }
        attempt.current = null;
        stop(
          p.ok && p.json?.ok && p.json.url
            ? { ok: true, url: p.json.url }
            : { ok: false, error: p.json?.error || HUB_WORDS.unreachable }
        );
      };
      timer = setTimeout(tick, 0); // the first ask at once, then every pollMs
    });

  return (
    <HubSheet
      onCancel={onClose}
      onTest={async (url) => {
        const r = await hubTest(url);
        return r.json?.ok
          ? { ok: true, version: r.json.version ?? null }
          : { ok: false, error: r.json?.error || HUB_WORDS.unreachable };
      }}
      onSignIn={async ({ url, invite, onWaiting }) => {
        const s = await hubSignInStart(profile, url, invite);
        if (!s.ok || !s.json?.ok)
          return { ok: false, error: s.json?.error || HUB_WORDS.unreachable };
        const id = s.json.id;
        const opened = await openTeamServerSignIn(s.json.signInUrl);
        if (opened !== 'ok') {
          void hubSignInCancel(id);
          return {
            ok: false,
            error: opened === 'refused' ? HUB_WORDS.refused : HUB_WORDS.noBrowser,
          };
        }
        onWaiting();
        const done = await waitForBrowser(id);
        if (!done.ok) return done;
        const r = await hubPrepare(profile, done.url);
        if (!r.ok || !r.json?.ok)
          return { ok: false, error: r.json?.error || HUB_WORDS.unreachable };
        await openPrepared(r, r.json.name, profile);
        onClose();
        return { ok: true };
      }}
      onAbortSignIn={() => {
        const a = attempt.current;
        attempt.current = null;
        if (!a) return;
        void hubSignInCancel(a.id);
        a.stop({ ok: false, cancelled: true });
      }}
    />
  );
}

/**
 * @param {{ open: string|null, onClose: () => void, profile: string, target?: object|null,
 *           openPrepared: (prep: object, name: string, profile: string) => Promise<unknown>,
 *           startFigma: () => Promise<boolean|undefined>, openFolder?: () => Promise<unknown>,
 *           github?: { invoke?: Function, listen?: Function, openRoot?: Function } | null }} props
 *   `github` is a seam for tests (and Settings › Connections): the shell invoke / listen / open the
 *   GitHub segment uses. Without it the segment is drawn only inside the app.
 */
export function AdvancedSheets({
  open,
  onClose,
  profile,
  target = null,
  openPrepared,
  startFigma,
  openFolder = () => openProjectFolder(),
  github = null,
}) {
  if (open === 'hub')
    return <HubHost onClose={onClose} profile={profile} openPrepared={openPrepared} />;
  if (open === 'folder-github')
    return (
      <FolderHost onClose={onClose} openFolder={openFolder} profile={profile} github={github} />
    );
  if (open === 'ai') return <AiSheet onClose={onClose} />;
  if (open === 'cli') return <CliHost onClose={onClose} />;
  if (open === 'figma')
    return <FigmaHost target={target} onClose={onClose} startFigma={startFigma} />;
  return null;
}
