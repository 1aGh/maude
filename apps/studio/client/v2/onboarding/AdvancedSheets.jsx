// client/v2/onboarding/AdvancedSheets.jsx — Home's host for the five Advanced sheets (02 ob-adv-sheets, S6.9).
// One id (client/v2/signin/advanced-rows.js) = one sheet; this is the only place that knows which Home route or
// shell command a sheet's button runs. Each sheet is a view (exported from ./index.js for S11.14), so Settings ›
// Connections mounts the same sheets with its own wiring.
//
//   hub            → the one "Link your server" dialog (2.1.1 T5, v2/link-server/; it replaced HubSheet):
//                    /_home/hub/test as the address is typed; Sign in (#204 K2) → /_home/hub/signin/start,
//                    the shell opens the hub's own page (`open_team_server_signin`; with an invite, the hub's
//                    invite page), poll until the browser came back, then /_home/hub/prepare and Home's own
//                    open of the managed copy. Home has no sign-in-key or folder path (named gap), so the
//                    dialog draws no Advanced here.
//   folder-github  → the shell's folder picker (`open_project_folder`); "From GitHub" (S6.10) → Rust's
//                    github_repos / home_github_sign_in / github_clone / github_create, then `open_project({root})`
//   ai             → /_home/ai/{status,connect}  (install Claude Code, then the browser sign-in)
//   cli            → /_home/cli/{status,install} (a link to the bundled maude; the plugin when claude is there)
//   figma          → the target project opens with the `import-figma` intent (Q8)
//
// No credential reaches a log or comes back into the page: the app owns no team-server password (the hub's
// own page in the browser takes it, issue #204); the AI sign-in is the person's browser; nothing here stores
// a token.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
import { answerOf, checkAnswerOf } from '../link-server/link-server-model.js';
import { LinkServerDialog } from '../link-server/LinkServerDialog.jsx';
import { connectClaudeHome } from './connect-ai-home.js';

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
 * Home's "Link your server" API (2.1.1 T5): the same dialog a project tab opens, wired to Home's own routes
 * for `profile`. `finish` prepares the managed copy and opens it as a tab (Home's `openPrepared`).
 */
export function homeLinkApi({ profile, openPrepared }) {
  return {
    context: 'home',
    folders: false,
    check: async (url) => checkAnswerOf(await hubTest(url)),
    signInStart: async (url, invite) => answerOf(await hubSignInStart(profile, url, invite)),
    signInPoll: async (id) => answerOf(await hubSignInPoll(id)),
    signInCancel: (id) => hubSignInCancel(id),
    openSignIn: openTeamServerSignIn,
    finish: async (url) => {
      const r = await hubPrepare(profile, url);
      if (!r.ok || !r.json?.ok) return { ok: false, error: r.json?.error };
      await openPrepared(r, r.json.name, profile);
      return { ok: true };
    },
  };
}

/** #204 K2 + 2.1.1 T5 — the hub row's host: the one dialog with Home's API. `pollMs` is a test seam. */
function HubHost({ onClose, profile, openPrepared, pollMs = HUB_POLL_MS }) {
  const api = useMemo(() => homeLinkApi({ profile, openPrepared }), [profile, openPrepared]);
  return <LinkServerDialog api={api} onClose={onClose} pollMs={pollMs} />;
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
