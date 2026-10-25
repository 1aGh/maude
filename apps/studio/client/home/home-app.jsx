// client/home/home-app.jsx — the Home page (V2-1.1 §5.6), rendered when `/_config.mode === 'home'`.
//
// Phase 3 ships a FUNCTIONAL Home (kg decision:maude/v2-phase3-split-and-home-scope): Pinned, Recent
// canvases, Projects by account, ⌘K Search, Open project…, pins. The designed Home of canvases 01/02
// (the question, starters, Shared with you, sign-in card, first run) is S6 and extends this file —
// the `home-ask` slot below is where the question goes. Layout lifts 11 `pn-home` / `pn-home-search`.
//
// Data (§5.6): 1 `shell_state` → 2 `/_home/index?pids&running` → 3 `/_home/cloud?profile` per profile
// → 4 the merge (home-model.js) → 5 live: `shell://state` and `index://changed` re-run 1–2 for the
// changed pids only. Every fetch goes through home-api.js (`x-maude-home: <page secret>`). Outside the desktop
// app nothing here throws: the shell calls resolve null and the page shows the index read-only.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createLocal,
  createLocalFromPrompt,
  getCloud,
  getIndex,
  getFirstRunSeen,
  getRecentSearches,
  inShell,
  managedProjectOpen,
  markFirstRunSeen,
  openCellDoor,
  openCloudUrl,
  openProject,
  openProjectFolder,
  pendingInviteAccept,
  pendingInviteLeave,
  prepareCloud,
  prepareCloudLink,
  relinkProject,
  saveRecentSearch,
  search,
  setPin,
  shellListen,
  shellState,
  takePendingDeepLink,
  thumbObjectUrl,
} from './home-api.js';
import { parseMaudeLink } from '../share-link.js';
import { browserDoorOf } from '../v2/cloud/browser-door.js';
import { AdvancedSheets } from '../v2/onboarding/AdvancedSheets.jsx';
import { CreateLocalSheet } from '../v2/signin/CreateLocalSheet.jsx';
import { SignInCard, SignInQuiet } from '../v2/signin/SignInCard.jsx';
import { SignInToast } from '../v2/signin/SignInToast.jsx';
import { ADVANCED_ROWS } from '../v2/signin/advanced-rows.js';
import { cardMode, isFirstRun, signedInToast } from '../v2/signin/signin-model.js';
import { useCloudSignIn } from '../v2/signin/use-signin.js';
import { useWhatsNewLine } from '../v2/signin/use-whats-new-line.js';
import { WhatsNewDialog, WhatsNewLine } from '../v2/signin/WhatsNewLine.jsx';
import { ProjectPill } from '../v2/shell/project-pill.jsx';
import { HomeAsk } from './HomeAsk.jsx';
import { HOME_MENU, homeMenuCtx, homeMenuState } from './home-menu.js';
import { InviteSheet } from './InviteSheet.jsx';
import { INVITE_WORDS, joinPendingAndOpen, useInviteFlow } from './invite-flow.js';
import { HIcon, HMark, HSpark, ProjectSquare } from './home-icons.jsx';
import {
  accountFace,
  buildHomeModel,
  canvasCount,
  cloudRoleWord,
  ownerWord,
  capProjectGroups,
  defaultTarget,
  indexQuery,
  invitedRows,
  linkProfile,
  localPidForLink,
  newThisWeek,
  relativeTime,
  rowSlug,
  sharedRows,
  targetChoices,
  thumbUrl,
} from './home-model.js';
import { pickStarters } from './home-starters.js';
import { ProjectsEmpty, SharedWithYou } from './Shelves.jsx';

// ── theme: the Home window follows the Mac's appearance (light is the v2 default) ──────────────
// S6.9 — every row of the Advanced options flyout now opens its sheet
const ADVANCED_IDS = ADVANCED_ROWS.map((r) => r.id);

function systemTheme() {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function useSystemTheme() {
  const [theme, setTheme] = useState(systemTheme);
  useEffect(() => {
    let mq;
    try {
      mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    } catch {
      mq = null;
    }
    if (!mq?.addEventListener) return undefined;
    const on = () => setTheme(systemTheme());
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return theme;
}

/** In a browser (no shell) the page reads the pids to show from its own `?pids=` — dev only. */
function browserPids() {
  try {
    const raw = new URLSearchParams(window.location.search).get('pids') || '';
    return raw.split(',').filter((p) => /^l[0-9a-f]{16}$/.test(p));
  } catch {
    return [];
  }
}

// ── data ─────────────────────────────────────────────────────────────────────────────────────
function useHomeData() {
  const [shell, setShell] = useState(null);
  const [index, setIndex] = useState(null); // Map pid → HomeProjectIndex
  const [clouds, setClouds] = useState([]);
  // S6.8: the cloud listings have answered once (signed in or not) — the first-run card waits for it
  const [cloudsReady, setCloudsReady] = useState(false);
  const [status, setStatus] = useState('loading'); // loading | ready | offline
  const shellRef = useRef(null);
  const native = inShell();

  const fetchIndexFor = useCallback(async (s, only) => {
    const q = s ? indexQuery(s) : { pids: browserPids(), running: [] };
    const pids = only ? q.pids.filter((p) => only.includes(p)) : q.pids;
    if (!pids.length) {
      if (!only) setIndex(new Map());
      return true;
    }
    const r = await getIndex(
      pids,
      q.running.filter((p) => pids.includes(p))
    );
    if (!r.ok || !Array.isArray(r.json?.projects)) return false;
    setIndex((prev) => {
      const next = new Map(only && prev ? prev : []);
      for (const p of r.json.projects) next.set(p.pid, p);
      return next;
    });
    return true;
  }, []);

  const fetchClouds = useCallback(async (s) => {
    const ids = (s?.profiles ?? []).map((p) => p.id).filter(Boolean);
    if (!ids.length) {
      setClouds([]);
      setCloudsReady(true);
      return;
    }
    const answers = await Promise.all(ids.map((id) => getCloud(id)));
    setClouds(
      answers.map((a) => (a.json && typeof a.json === 'object' ? a.json : null)).filter(Boolean)
    );
    setCloudsReady(true);
  }, []);

  const readShell = useCallback(async () => {
    if (!native) return null;
    try {
      const s = await shellState();
      return s && Array.isArray(s.projects) ? s : null;
    } catch {
      return null;
    }
  }, [native]);

  const loadAll = useCallback(async () => {
    const s = await readShell();
    shellRef.current = s;
    setShell(s);
    const ok = await fetchIndexFor(s, null);
    setStatus(ok ? 'ready' : 'offline');
    fetchClouds(s);
  }, [readShell, fetchIndexFor, fetchClouds]);

  // step 5 — re-run 1–2 for the pids whose place changed (or that are new)
  const onShellState = useCallback(
    async (payload) => {
      const prev = shellRef.current;
      const s = payload && Array.isArray(payload.projects) ? payload : await readShell();
      if (!s) return;
      shellRef.current = s;
      setShell(s);
      const before = new Map((prev?.projects ?? []).map((p) => [p.pid, p]));
      const changed = s.projects
        .filter((p) => {
          const b = before.get(p.pid);
          return !b || b.place !== p.place || b.root !== p.root;
        })
        .map((p) => p.pid);
      if (changed.length) fetchIndexFor(s, changed);
      const profiles = (s.profiles ?? []).map((p) => p.id).join();
      if (profiles !== (prev?.profiles ?? []).map((p) => p.id).join()) fetchClouds(s);
    },
    [readShell, fetchIndexFor, fetchClouds]
  );

  useEffect(() => {
    loadAll();
    let alive = true;
    const offs = [];
    shellListen('shell://state', (p) => onShellState(p)).then((off) =>
      alive ? offs.push(off) : off()
    );
    shellListen('index://changed', (p) => {
      const pids = Array.isArray(p?.pids) ? p.pids : null;
      fetchIndexFor(shellRef.current, pids);
    }).then((off) => (alive ? offs.push(off) : off()));
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadAll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      for (const off of offs) off();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadAll, onShellState, fetchIndexFor]);

  const patchPin = useCallback((pid, rel, pinnedAt) => {
    setIndex((prev) => {
      const p = prev?.get(pid);
      if (!p?.canvases) return prev;
      const next = new Map(prev);
      next.set(pid, {
        ...p,
        canvases: p.canvases.map((c) => (c.rel === rel ? { ...c, pinnedAt } : c)),
      });
      return next;
    });
  }, []);

  return { native, shell, index, clouds, cloudsReady, status, reload: loadAll, patchPin };
}

// ── maude:// links (V2-3.5) ───────────────────────────────────────────────────────────────────
// Rust routes a link to Home when no project tab can take it (deep_link.rs). The link that LAUNCHED
// the app is parked for this window (take once); links while running arrive as events. One slot,
// like the project window's CloudBar: a second link never replaces one the person is reading.
function useDeepLink(native) {
  const [link, setLink] = useState(null);
  useEffect(() => {
    if (!native) return undefined;
    const take = (url) => {
      const parsed = parseMaudeLink(url);
      if (parsed) setLink((current) => current ?? parsed);
    };
    takePendingDeepLink()
      .then((url) => typeof url === 'string' && take(url))
      .catch(() => {});
    let alive = true;
    let off = null;
    shellListen('maude://deep-link', take).then((fn) => {
      if (alive) off = fn;
      else fn();
    });
    return () => {
      alive = false;
      off?.();
    };
  }, [native]);
  return [link, setLink];
}

// ── New project… (V2-3.9) ────────────────────────────────────────────────────────────────────
// File ▸ New Project… ⇧⌘N sends `menu://action {id:'project.new'}` to the ACTIVE tab (menu.rs). On
// a project tab IdentityBar opens its create dialog; on Home nothing listened, so the menu item did
// nothing. Home's answer is this sheet: a name → `create-local` (`~/Maude/<name>`) → `open_project
// ({root})`, the new project's tab (V2-1.1 §5.4 "A new project from Home is create-local first").
function useMenuActions(native, handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!native) return undefined;
    let alive = true;
    let off = null;
    shellListen('menu://action', (p) => {
      // the menu sends the focused window ONE id: project.new opens the sheet, canvas.new (⌘N) is the
      // `create-empty` intent in the chip's project (S6.4 — no new id, the registry's own)
      const run = typeof p?.id === 'string' ? ref.current[p.id] : null;
      if (run) run();
    }).then((fn) => {
      if (alive) off = fn;
      else fn();
    });
    return () => {
      alive = false;
      off?.();
    };
  }, [native]);
}

// S6.4 — "online" = this Mac says so AND the cloud answered. Offline the AI is not on offer and cloud
// projects not on this Mac grey out; this Mac's own projects and the empty canvas stay.
function useOnline() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

// "Shared with you" rows already opened on this Mac (they stop counting as "new this week"). A per-Mac
// convenience, so Home's own storage is enough; it renders correctly without it.
const SEEN_KEY = 'maude-home-shared-seen';
// 11 pn-home: the Projects list draws this many rows, then "N more" (the board: five of twenty)
const PROJECTS_SHOWN = 6;
function readSeen() {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
    return new Set(Array.isArray(v) ? v.filter((k) => typeof k === 'string').slice(-500) : []);
  } catch {
    return new Set();
  }
}
function writeSeen(set) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-500)));
  } catch {
    /* private window / blocked storage: the count just stays */
  }
}

// ── page ─────────────────────────────────────────────────────────────────────────────────────
export function HomeApp() {
  const theme = useSystemTheme();
  const data = useHomeData();
  const [filterPid, setFilterPid] = useState('');
  // Recent canvases are one row of six with a "See all" (pn-home); Projects: find + sort (pn-projlist)
  const [recentAll, setRecentAll] = useState(false);
  const [projFind, setProjFind] = useState('');
  const [projSort, setProjSort] = useState('recent');
  const [projAll, setProjAll] = useState(false);
  const [notice, setNotice] = useState(null);
  const [link, setLink] = useDeepLink(data.native);
  const [linkBusy, setLinkBusy] = useState(false);
  const searchRef = useRef(null);
  // the ⌘K palette (pn-home-search)
  const [searchOpen, setSearchOpen] = useState(false);
  // null | { name, busy } — the New project… sheet.
  const [creating, setCreating] = useState(null);
  const askNewProject = useCallback(() => setCreating((c) => c ?? { name: '', busy: false }), []);
  const online = useOnline();
  // S6.8 — the sign-in card, its toast, the Advanced flyout (closed on every launch) and the What's New line
  const [toast, setToast] = useState(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // S6.9 — the Advanced sheet that is open (a row id from advanced-rows.js), or null
  const [sheet, setSheet] = useState(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  const openSheet = useCallback((id) => {
    setAdvancedOpen(false);
    setSheet(id);
  }, []);
  const closeToast = useCallback(() => setToast(null), []);
  // S6.11 — the invite controller reads the sign-in through this ref (it is made after the sign-in)
  const inviteRef = useRef(null);
  const signin = useCloudSignIn({
    native: data.native,
    // Home reads the new account's listing, then says how much arrived with it — unless the sign-in was
    // for an invite (or the cloud redeemed one during it): then the project opens instead (S6.11)
    onSignedIn: async (done) => {
      const { profile } = done;
      await data.reload();
      if (await inviteRef.current?.afterSignIn(done)) return;
      const r = await getCloud(profile);
      const n = Array.isArray(r.json?.projects) ? r.json.projects.length : 0;
      setToast(signedInToast(n));
    },
  });
  // S6.4 — where the sentence lands, and the shelves that come from the cloud
  const [pick, setPick] = useState(null); // the person's choice in the chip, by key
  const [asking, setAsking] = useState(false);
  const askingRef = useRef(false);
  const [seen, setSeen] = useState(readSeen);

  const model = useMemo(
    () =>
      buildHomeModel({
        shell: data.shell,
        index: data.index ? { v: 1, projects: [...data.index.values()] } : null,
        clouds: data.clouds,
        filterPid: filterPid || null,
      }),
    [data.shell, data.index, data.clouds, filterPid]
  );
  // the signed-in account's face at the top right (02 ob-home-new: a circle, never the project's square)
  const face = useMemo(() => {
    const c = data.clouds.find((x) => x?.signedIn);
    if (!c) return null;
    const id = c.profile || 'default';
    const label = (data.shell?.profiles ?? []).find((p) => p.id === id)?.label || '';
    const email = c.account?.email || '';
    return {
      ...accountFace({ id, label, email }),
      title: [label, email].filter(Boolean).join(' · ') || 'Your account',
    };
  }, [data.clouds, data.shell]);
  const searchPids = useMemo(
    () => (data.shell ? indexQuery(data.shell).pids : browserPids()),
    [data.shell]
  );

  const signedIn = useMemo(() => data.clouds.some((c) => c?.signedIn), [data.clouds]);
  // an empty ⌘K is a shortcut list: the tabs that are open (with their AI) and the last canvases
  const searchTabs = useMemo(
    () =>
      (data.shell?.projects ?? [])
        .filter((p) => p?.place === 'tab' && typeof p.pid === 'string')
        .map((p) => ({
          pid: p.pid,
          name: p.name || 'Untitled project',
          meta: p.ai?.awaiting > 0 ? 'Needs you' : p.ai?.running > 0 ? 'AI is working' : '',
        })),
    [data.shell]
  );
  const searchRecent = useMemo(
    () =>
      model.recent.slice(0, 3).map((r) => ({
        pid: r.pid,
        rel: r.rel,
        slug: r.slug,
        name: r.name,
        thumb: r.thumb,
        meta: [r.projectName, relativeTime(r.openedAt)].filter(Boolean).join(' · '),
      })),
    [model.recent]
  );
  // S6.8 — the card shows only on a first run (no project, no account, the lists have answered)
  // P8 C8 (05 es-home-local, kg v2-p8-c8-first-run-card-once): the card is for the very first launch of this
  // Mac. Once it has been shown (Home's own per-Mac flag, `/_home/first-run`), a signed-out Mac with no project
  // shows 05's shelf — "No projects on this Mac yet." — and the quiet "Sign in to cloud.maude.sh" pill. The flag
  // is read once; it is written the moment the card is up and the card stays for this visit (`cardLatched`).
  const [firstRunSeen, setFirstRunSeen] = useState(null); // null = not answered yet
  const [cardLatched, setCardLatched] = useState(false);
  useEffect(() => {
    let live = true;
    getFirstRunSeen().then((r) => {
      if (live) setFirstRunSeen(r.ok && r.json?.seen === true);
    });
    return () => {
      live = false;
    };
  }, []);
  const firstRun =
    data.native &&
    data.cloudsReady &&
    firstRunSeen !== null &&
    isFirstRun({ status: data.status, projectCount: model.projectCount, signedIn });
  const firstCard = firstRun && (!firstRunSeen || cardLatched);
  useEffect(() => {
    if (!firstCard || cardLatched) return;
    setCardLatched(true);
    markFirstRunSeen();
  }, [firstCard, cardLatched]);
  const signinLive = signin.state.phase !== 'idle';
  const cardOn = data.native && !signedIn && (firstCard || signinLive);
  const whatsNew = useWhatsNewLine({
    enabled: data.native && data.cloudsReady && data.status === 'ready' && !firstCard && !cardOn,
    native: data.native,
  });
  const cloudOnline = online && !data.clouds.some((c) => c?.offline);
  const choices = useMemo(
    () => targetChoices({ model, signedIn, online: cloudOnline }),
    [model, signedIn, cloudOnline]
  );
  const targetKey = useMemo(() => {
    const chosen = choices.find((c) => c.key === pick && !c.disabled);
    return chosen ? chosen.key : defaultTarget(choices, { shell: data.shell, model });
  }, [choices, pick, data.shell, model]);
  const target = choices.find((c) => c.key === targetKey) ?? choices.at(-1);
  const starters = useMemo(() => pickStarters({ target, signedIn }), [target, signedIn]);
  const shared = useMemo(() => sharedRows(data.clouds), [data.clouds]);
  const sharedNew = useMemo(() => newThisWeek(shared, seen), [shared, seen]);
  const invited = useMemo(() => invitedRows(data.clouds), [data.clouds]);

  // ⌘K focuses Search (contract §5.9 `home.search`)
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fail = useCallback(
    (e, words) => setNotice(words || String(e?.message || e || 'That did not work.')),
    []
  );

  const open = useCallback(
    async (pid, canvas, artboard) => {
      if (!data.native) return;
      try {
        await openProject({ pid }, canvas ? { canvas, ...(artboard ? { artboard } : {}) } : null);
      } catch (e) {
        fail(e);
      }
    },
    [data.native, fail]
  );

  const togglePin = useCallback(
    async (row) => {
      const pinned = row.pinnedAt == null;
      data.patchPin(row.pid, row.rel, pinned ? Date.now() : null);
      const r = await setPin(row.pid, row.rel, pinned);
      if (!r.ok) {
        data.patchPin(row.pid, row.rel, row.pinnedAt);
        setNotice(`${row.name} could not be ${pinned ? 'pinned' : 'unpinned'}. Nothing changed.`);
      }
    },
    [data]
  );

  const openFolder = useCallback(async () => {
    try {
      await openProjectFolder();
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  const relink = useCallback(
    async (pid) => {
      try {
        await relinkProject(pid);
      } catch (e) {
        fail(e);
      }
    },
    [fail]
  );

  // A project not on this Mac yet, once prepared: its own copy → a tab (`managed_project_open`
  // resolves the copy's folder, `open_project` opens it). Cloud rows and connect links share it.
  // A Can view account gets no copy (S9.17b): the prepare's browser door opens the cell as a
  // `c-*` tab of the profile it was prepared for.
  const openPrepared = useCallback(async (prep, name, profile, target, intent) => {
    const door = browserDoorOf(prep.json);
    if (door) {
      const r = await openCellDoor(door.url, profile);
      if (!r.ok) setNotice(r.error);
      return;
    }
    if (!prep.ok || !prep.json?.ok) {
      setNotice(prep.json?.error || `${name} could not be opened. Try again in a moment.`);
      return;
    }
    const root = await managedProjectOpen(prep.json);
    if (typeof root === 'string' && root) await openProject({ root }, target, intent);
  }, []);

  // S6.11 — an invite (`maude://invite/<id>`): the profile that holds its address accepts it and lands on the
  // canvas and thread; another account (or nobody) gets the sheet, whose Open signs that address in, in a new
  // profile of its own (invite-flow.js).
  const invite = useInviteFlow({
    native: data.native,
    clouds: data.clouds,
    cloudsReady: data.cloudsReady,
    signin,
    openPrepared,
    reload: data.reload,
    onNotice: setNotice,
  });
  inviteRef.current = invite;

  const openCloud = useCallback(
    async (row, target) => {
      try {
        const prep = await prepareCloud(row.profile, row.url, row.projectId);
        // A cloud that answers Can view with no browser door (before S9.2): the browser, as before.
        if (row.role === 'observer' && !prep.json?.ok && prep.json?.reason !== 'browser-door') {
          if (row.url) await openCloudUrl(row.url);
          return;
        }
        await openPrepared(prep, row.name, row.profile, target);
      } catch (e) {
        fail(e);
      }
    },
    [fail, openPrepared]
  );

  // A "Shared with you" row: the same open as a cloud project (cloud.open-remote), landing on the
  // shared canvas when the share is one; opening it stops it counting as new.
  const openShared = useCallback(
    (row) => {
      setSeen((prev) => {
        const next = new Set(prev).add(row.key);
        writeSeen(next);
        return next;
      });
      return openCloud(
        {
          profile: row.profile,
          url: null,
          projectId: row.projectId,
          name: row.projectName,
          role: row.role,
        },
        row.canvasPath ? { canvas: row.canvasPath } : null
      );
    },
    [openCloud]
  );

  // A pending invitation on "Shared with you" (gate-b-sec3b). Join: accept it by project (and canvas) with the
  // profile it was listed under, trade the one-time code, open the landing. Leave: decline. Neither holds an
  // invite id; both end with a fresh read of the list, so a refusal ("no longer valid") never leaves a dead row.
  const [inviteBusy, setInviteBusy] = useState(null);
  const joinInvited = useCallback(
    async (row) => {
      if (inviteBusy) return;
      setInviteBusy(row.key);
      try {
        const plan = await joinPendingAndOpen(
          {
            profile: row.profile,
            projectId: row.projectId,
            canvasPath: row.canvasPath,
            projectName: row.projectName,
          },
          {
            acceptPending: pendingInviteAccept,
            prepareLink: prepareCloudLink,
            openPrepared,
          }
        );
        if (plan.kind === 'notice') setNotice(plan.words);
        else if (plan.kind === 'ask') setNotice('This device was disconnected. Sign in again.');
      } catch {
        setNotice(INVITE_WORDS.unreachable);
      } finally {
        setInviteBusy(null);
        data.reload();
      }
    },
    [inviteBusy, openPrepared, data.reload]
  );
  const leaveInvited = useCallback(
    async (row) => {
      if (inviteBusy) return;
      setInviteBusy(row.key);
      try {
        const r = await pendingInviteLeave(row.profile, row.projectId, row.canvasPath);
        if (!r.ok && r.status === 404) setNotice(INVITE_WORDS.gone);
        else if (!r.ok)
          setNotice(`You are still invited to ${row.projectName}. Nothing changed. Try again.`);
      } finally {
        setInviteBusy(null);
        data.reload();
      }
    },
    [inviteBusy, data.reload]
  );

  // The question (S6.4). The sentence — or the empty canvas, or "Bring my existing brand" — leaves as an
  // INTENT that Rust parks for the target window; it is never in a URL. The target is a project on this
  // Mac (opened by pid), a cloud project not here yet (its own copy first, like any cloud row), or a
  // project that does not exist yet: created on this Mac now, named from the sentence (C4), and — signed
  // in and online — asked to move to the cloud in the background by its own window (Q4).
  const startIn = useCallback(
    async (intent) => {
      if (!data.native || askingRef.current || !target) return false;
      askingRef.current = true;
      setAsking(true);
      try {
        if (target.kind === 'local') {
          await openProject({ pid: target.pid }, null, intent);
        } else if (target.kind === 'cloud') {
          const prep = await prepareCloud(target.profile, null, target.projectId);
          await openPrepared(prep, target.name, target.profile, null, intent);
        } else {
          const r = intent.prompt
            ? await createLocalFromPrompt(intent.prompt)
            : await createLocal('');
          if (!r.ok || !r.json?.ok || typeof r.json.root !== 'string') {
            setNotice(r.json?.error || 'The project could not be created. Nothing changed.');
            return false;
          }
          await openProject({ root: r.json.root }, null, {
            ...intent,
            projectHint: r.json.name,
            ...(signedIn && cloudOnline ? { moveToCloud: true } : {}),
          });
        }
        return true;
      } catch (e) {
        fail(e);
        return false;
      } finally {
        askingRef.current = false;
        setAsking(false);
      }
    },
    [data.native, target, signedIn, cloudOnline, openPrepared, fail]
  );
  const sendSentence = useCallback(
    (prompt) => startIn({ kind: 'create-canvas', prompt }),
    [startIn]
  );
  const startEmpty = useCallback(() => startIn({ kind: 'create-empty', prompt: '' }), [startIn]);
  const startBrand = useCallback(
    (s) => startIn({ kind: s.intent || 'import-brand', prompt: '' }),
    [startIn]
  );
  // S6.9 — Import from Figma lands in the same target the question does, as the `import-figma` intent (Q8)
  // 02 ob-adv-sheets: the sheet's Figma link rides along as the import's prompt (a link, never a token)
  const startFigma = useCallback(
    (link) => startIn({ kind: 'import-figma', prompt: typeof link === 'string' ? link : '' }),
    [startIn]
  );
  useMenuActions(data.native, { 'project.new': askNewProject, 'canvas.new': startEmpty });

  // A file link whose project IS here (its tab failed to open from the link) opens like a
  // Pinned card; one for a project this Mac doesn't have gets the calm note below.
  const linkPid =
    (link?.kind === 'file' || link?.kind === 'canvas') && data.shell
      ? localPidForLink(data.shell, link.project)
      : null;
  useEffect(() => {
    if (!linkPid || (link?.kind !== 'file' && link?.kind !== 'canvas')) return;
    setLink(null);
    open(linkPid, link.rel);
  }, [linkPid, link, open, setLink]);
  const linkNote =
    (link?.kind === 'file' || link?.kind === 'canvas') && data.status !== 'loading' && !linkPid;

  // A connect link: the project window's "Open <project>" answer — its own copy on this Mac.
  // There is no folder here to connect, so that half of CloudBar's decision has no Home form.
  const openLink = useCallback(async () => {
    if (link?.kind !== 'connect') return;
    setLinkBusy(true);
    try {
      const profile = linkProfile(data.shell, data.clouds, link.project);
      const prep = await prepareCloudLink(profile, link);
      await openPrepared(prep, link.project, profile);
    } catch (e) {
      fail(e);
    } finally {
      setLinkBusy(false);
      setLink(null);
    }
  }, [link, data.shell, data.clouds, openPrepared, fail, setLink]);
  useEffect(() => {
    if (link?.kind !== 'connect') return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setLink(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [link, setLink]);

  const createProject = useCallback(async () => {
    if (!creating || creating.busy || !data.native) return;
    setCreating({ ...creating, busy: true });
    try {
      const r = await createLocal(creating.name.trim());
      if (!r.ok || !r.json?.ok || typeof r.json.root !== 'string') {
        setNotice(r.json?.error || 'The project could not be created. Nothing changed.');
        setCreating((c) => (c ? { ...c, busy: false } : c));
        return;
      }
      setCreating(null);
      await openProject({ root: r.json.root });
    } catch (e) {
      setCreating(null);
      fail(e);
    }
  }, [creating, data.native, fail]);
  useEffect(() => {
    if (!creating) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setCreating(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [creating]);

  // The Home pill's menu (P8-C8): the one pill + the rows Home can run. Menu › Help › What's new is the
  // door that was shut while the pill was a <span>.
  const menuCtx = useMemo(
    () => homeMenuCtx({ native: data.native, online }),
    [data.native, online]
  );
  const menuState = useMemo(
    () => homeMenuState({ unseen: whatsNew.entries.length }),
    [whatsNew.entries.length]
  );
  const runMenu = useCallback(
    (id) => {
      if (id === 'project.new') askNewProject();
      else if (id === 'project.open') openFolder();
      else if (id === 'canvas.new') startEmpty();
      else if (id === 'help.whats-new') whatsNew.open();
    },
    [askNewProject, openFolder, startEmpty, whatsNew.open]
  );

  const hasProjects = model.groups.some((g) => g.rows.length);
  // Find a project + the sort (pn-home Projects): by name as typed, Recent keeps the model's order
  const { projGroups, projMore } = useMemo(() => {
    const q = projFind.trim().toLowerCase();
    const byName = (a, b) => String(a.name).localeCompare(String(b.name));
    const all = model.groups
      .map((g) => {
        const rows = g.rows.filter((r) => !q || String(r.name).toLowerCase().includes(q));
        return { ...g, rows: projSort === 'name' ? [...rows].sort(byName) : rows };
      })
      .filter((g) => g.rows.length || !q);
    // 11 pn-home: the list shows its first rows and a "N more" foot; finding a project searches all of them
    if (q || projAll) return { projGroups: all, projMore: 0 };
    const cut = capProjectGroups(all, PROJECTS_SHOWN);
    return { projGroups: cut.groups, projMore: cut.more };
  }, [model.groups, projFind, projSort, projAll]);
  const showShared = signedIn && (hasProjects || shared.length > 0 || invited.length > 0);
  return (
    <div className="maude-v2 home-root" data-theme={theme} data-testid="home-root">
      <header className="home-top">
        <ProjectPill
          project="Home"
          tree={HOME_MENU}
          ctx={menuCtx}
          state={menuState}
          run={runMenu}
        />
        <div className="home-top-end">
          {data.native && data.cloudsReady && !signedIn && !firstCard && !signinLive ? (
            <SignInQuiet onClick={() => signin.begin()} disabled={!online} />
          ) : null}
          <HomeSearch
            open={searchOpen}
            onOpen={() => setSearchOpen(true)}
            onClose={() => setSearchOpen(false)}
            inputRef={searchRef}
            pids={searchPids}
            openTabs={searchTabs}
            recentCanvases={searchRecent}
            onOpenRow={(pid, canvas, artboard) => open(pid, canvas, artboard)}
            onAsk={(text) => {
              if (text) sendSentence(text);
            }}
            canOpen={data.native}
          />
          {face ? (
            <span
              className="home-top-acct"
              data-testid="home-top-face"
              role="img"
              aria-label={face.title}
              title={face.title}
            >
              <span
                className={`home-face home-face--md home-face--${face.tone}`}
                aria-hidden="true"
              >
                {face.initial}
              </span>
            </span>
          ) : null}
        </div>
      </header>

      <main className="home-page" aria-label="Home">
        <h1 className="home-sr">Home</h1>
        <HomeAsk
          choices={choices}
          targetKey={targetKey}
          onTarget={setPick}
          starters={starters}
          online={online}
          native={data.native}
          busy={asking}
          onSend={sendSentence}
          onEmpty={startEmpty}
          onBrand={startBrand}
          below={
            <>
              {cardOn ? (
                <SignInCard
                  mode={cardMode(signin.state, online)}
                  userCode={signin.state.userCode}
                  showCode={signin.state.showCode}
                  error={signin.state.error}
                  note={signin.note}
                  native={data.native}
                  onCloud={() => signin.begin()}
                  onLocal={askNewProject}
                  onCancel={signin.cancel}
                  onReopen={signin.reopen}
                  onShowCode={signin.showCode}
                  advancedOpen={advancedOpen}
                  onToggleAdvanced={() => setAdvancedOpen((o) => !o)}
                  advancedAvailable={ADVANCED_IDS}
                  onAdvanced={openSheet}
                />
              ) : null}
              {whatsNew.show ? (
                <WhatsNewLine
                  entry={whatsNew.entry}
                  onOpen={whatsNew.open}
                  onDismiss={whatsNew.dismiss}
                />
              ) : null}
            </>
          }
        />

        {!data.native ? (
          <p className="home-callout" role="note">
            This page is open in a browser. Projects open from the desktop app only.
          </p>
        ) : null}
        {data.status === 'offline' ? (
          <p className="home-callout" role="alert">
            Home can't read its list of canvases right now. Your projects are safe.
            <button type="button" className="btn btn--sm" onClick={data.reload}>
              Retry
            </button>
          </p>
        ) : null}
        {linkNote ? (
          <p className="home-callout" role="status" data-testid="home-link-note">
            That link is for a project that isn't on this Mac.
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLink(null)}>
              Dismiss
            </button>
          </p>
        ) : null}
        {notice ? (
          <p className="home-callout" role="alert">
            {notice}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setNotice(null)}
            >
              Dismiss
            </button>
          </p>
        ) : null}

        {model.pinned.length ? (
          <section className="home-sec" aria-labelledby="home-h-pinned">
            <h2 className="home-h" id="home-h-pinned">
              Pinned
              <span className="home-h-aside">pin any canvas from its row or its menu</span>
            </h2>
            <ul className="home-pins">
              {model.pinned.map((r) => (
                <li key={`${r.pid}:${r.rel}`} className="home-pincard">
                  <button
                    type="button"
                    className="home-pincard-main"
                    data-testid={`home-pinned-row-${r.pid}-${r.slug}`}
                    onClick={() => open(r.pid, r.rel)}
                    disabled={!data.native}
                  >
                    <Thumb src={r.thumb} className="home-thumb-pin" />
                    <span className="home-pincard-t">
                      <strong>{r.name}</strong>
                      <span>
                        <ProjectSquare id={r.pid} name={r.projectName} />
                        {r.projectName}
                        {r.folder ? ` · ${r.folder}` : ''}
                      </span>
                    </span>
                  </button>
                  <PinButton
                    row={r}
                    testid={`home-pinned-unpin-${r.pid}-${r.slug}`}
                    onToggle={togglePin}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {model.recent.length || filterPid ? (
          <section className="home-sec" aria-labelledby="home-h-recent">
            <h2 className="home-h" id="home-h-recent">
              Recent canvases
              {model.recentProjects.length > 1 || filterPid ? (
                <span className="home-h-right">
                  <label className="home-filter">
                    <span className="home-sr">Show recent canvases from</span>
                    <select
                      className="chip home-filter-select"
                      data-testid="home-recent-filter"
                      value={filterPid}
                      onChange={(e) => setFilterPid(e.target.value)}
                    >
                      <option value="">All projects</option>
                      {model.recentProjects.map((p) => (
                        <option key={p.pid} value={p.pid}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <HIcon name="chevron" size={12} />
                  </label>
                </span>
              ) : null}
              {model.recent.length > RECENT_CAP ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm home-seeall"
                  data-testid="home-recent-seeall"
                  aria-expanded={recentAll}
                  onClick={() => setRecentAll((v) => !v)}
                >
                  {recentAll ? 'Show fewer' : 'See all'}
                </button>
              ) : null}
            </h2>
            {model.recent.length ? (
              <ul className="home-cards">
                {(recentAll ? model.recent : model.recent.slice(0, RECENT_CAP)).map((r) => (
                  <li key={`${r.pid}:${r.rel}`} className="home-card">
                    <button
                      type="button"
                      className="home-card-main"
                      data-testid={`home-recent-row-${r.pid}-${r.slug}`}
                      onClick={() => open(r.pid, r.rel)}
                      disabled={!data.native}
                    >
                      <span className="home-card-pic">
                        <Thumb src={r.thumb} className="home-thumb-card" />
                        {r.madeByAi ? (
                          <span className="chip chip--spark home-card-ai">
                            <HSpark size={9} />
                            Made by AI
                          </span>
                        ) : null}
                      </span>
                      <strong>{r.name}</strong>
                      <span className="home-card-meta home-card-proj">
                        <ProjectSquare id={r.pid} name={r.projectName} />
                        <span>{r.projectName}</span>
                      </span>
                      <span className="home-card-meta">
                        {[r.folder, relativeTime(r.openedAt)].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                    <PinButton
                      row={r}
                      testid={`home-pin-${r.pid}-${r.slug}`}
                      onToggle={togglePin}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="home-empty-line">
                {data.status === 'loading' ? 'Loading…' : 'Canvases you open show up here.'}
              </p>
            )}
          </section>
        ) : null}

        {/* Shared with you (when signed in) sits beside Projects — canvas 11 pn-home. A first run with
            nothing on either keeps the page quiet: the question does the work (05 es-home-cloud). */}
        <div className={showShared ? 'home-two' : undefined}>
          {showShared ? (
            <SharedWithYou
              rows={shared}
              invites={invited}
              newCount={sharedNew}
              canOpen={data.native}
              busyKey={inviteBusy}
              onOpen={openShared}
              onJoin={joinInvited}
              onLeave={leaveInvited}
            />
          ) : null}
          {hasProjects ? (
            <section className="home-sec" aria-labelledby="home-h-projects">
              <h2 className="home-h" id="home-h-projects">
                Projects
                {model.projectCount ? (
                  <span className="home-h-aside">
                    {model.projectCount} {model.projectCount === 1 ? 'project' : 'projects'}
                  </span>
                ) : null}
                {model.projectCount > 1 ? (
                  <span className="home-h-right">
                    <label className="home-projfind">
                      <span className="home-sr">Find a project</span>
                      <HIcon name="search" size={14} />
                      <input
                        type="search"
                        className="home-projfind-input"
                        data-testid="home-project-find"
                        placeholder="Find a project"
                        value={projFind}
                        onChange={(e) => setProjFind(e.target.value)}
                      />
                    </label>
                    <label className="home-filter">
                      <span className="home-sr">Sort projects</span>
                      <select
                        className="chip home-filter-select"
                        data-testid="home-project-sort"
                        value={projSort}
                        onChange={(e) => setProjSort(e.target.value)}
                      >
                        <option value="recent">Recent</option>
                        <option value="name">Name</option>
                      </select>
                      <HIcon name="chevron" size={12} />
                    </label>
                  </span>
                ) : null}
              </h2>
              <div className="island home-projlist">
                {projGroups.map((g) => (
                  <ProfileGroup
                    key={g.profile.id}
                    group={g}
                    showHeader={projGroups.length > 1 || !!g.profile.email}
                    canOpen={data.native}
                    onOpen={(pid) => open(pid)}
                    onRelink={relink}
                    onOpenCloud={openCloud}
                  />
                ))}
                <div className="home-projmore">
                  {projMore ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm home-projmore-n"
                      data-testid="home-projects-more"
                      onClick={() => setProjAll(true)}
                    >
                      {projMore} more
                    </button>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm home-projopen"
                    data-testid="home-open-folder"
                    onClick={openFolder}
                    disabled={!data.native}
                  >
                    <HIcon name="folder" size={14} />
                    Open project…
                    <kbd className="kbd">⌘O</kbd>
                  </button>
                </div>
              </div>
            </section>
          ) : data.status !== 'loading' && !cardOn && (firstRunSeen !== null || !data.native) ? (
            <ProjectsEmpty signedIn={signedIn} native={data.native} onOpenFolder={openFolder} />
          ) : null}
        </div>
      </main>

      {link?.kind === 'connect' ? (
        <div
          className="home-link-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`Open ${link.project}?`}
        >
          <div className="home-link-scrim" aria-hidden="true" onClick={() => setLink(null)} />
          <div className="island home-link-dialog" data-testid="home-link-dialog">
            <h2>Open {link.project}?</h2>
            <p>
              {link.project} isn't on this Mac yet. It opens in its own copy here. Nothing else
              changes.
            </p>
            <div className="home-link-foot">
              <button
                type="button"
                className="btn"
                data-testid="home-link-dismiss"
                onClick={() => setLink(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                data-testid="home-link-open"
                disabled={linkBusy}
                onClick={openLink}
              >
                {linkBusy ? 'Opening…' : `Open ${link.project}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {creating ? (
        <CreateLocalSheet
          value={creating}
          onChange={setCreating}
          onSubmit={createProject}
          onCancel={() => setCreating(null)}
        />
      ) : null}

      {sheet ? (
        <AdvancedSheets
          open={sheet}
          onClose={closeSheet}
          profile={linkProfile(data.shell, data.clouds, '')}
          target={target}
          openPrepared={openPrepared}
          startFigma={startFigma}
        />
      ) : null}

      {whatsNew.reading ? (
        <WhatsNewDialog
          entries={whatsNew.entries.length ? whatsNew.entries : whatsNew.recent}
          onClose={whatsNew.close}
        />
      ) : null}
      {invite.sheet ? (
        <InviteSheet
          sheet={invite.sheet}
          waiting={invite.sheet.busy && signin.state.phase === 'waiting'}
          onOpen={invite.open}
          onCancel={invite.cancel}
          onReopen={signin.reopen}
        />
      ) : null}
      {toast ? <SignInToast text={toast} onDone={closeToast} /> : null}
    </div>
  );
}

/** A Home picture: fetched with the Home header (home-api `thumbObjectUrl`), shown as a blob URL. */
function Thumb({ src, className }) {
  const [url, setUrl] = useState(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    setBroken(false);
    if (src)
      thumbObjectUrl(src).then((u) => {
        if (alive) setUrl(u);
      });
    return () => {
      alive = false;
    };
  }, [src]);
  if (!url || broken) return <span className={`home-thumb home-thumb--empty ${className}`} />;
  return (
    <span className={`home-thumb ${className}`}>
      <img src={url} alt="" decoding="async" onError={() => setBroken(true)} />
    </span>
  );
}

function PinButton({ row, testid, onToggle }) {
  const pinned = row.pinnedAt != null;
  return (
    <button
      type="button"
      className="icon-btn home-pin"
      data-testid={testid}
      aria-pressed={pinned}
      aria-label={`${pinned ? 'Unpin' : 'Pin'} ${row.name}`}
      title={pinned ? 'Unpin' : 'Pin'}
      onClick={() => onToggle(row)}
    >
      <HIcon name="pin" size={14} />
    </button>
  );
}

const RECENT_CAP = 6;

const STATE_WORD = {
  tab: 'in a tab',
  mac: (
    <>
      <HIcon name="laptop" size={12} />
      this Mac only
    </>
  ),
  cloud: (
    <>
      <HIcon name="cloud" size={12} />
      not on this Mac yet
    </>
  ),
};

// A project tab's live state (shell_state `ai` + `place`), canvas 11's words: AI working (a spark
// while it runs) · Needs you (it is waiting on a decision — the one that asks for you wins) ·
// Resting (its server is stopped; the tab wakes it). A resting tab never has AI (rest policy).
function RowLive({ row }) {
  const ai = row.ai;
  if (ai?.awaiting > 0)
    return (
      <span
        className="chip home-prow-ai"
        data-testid={`home-project-ai-${row.pid}`}
        data-ai="awaiting"
      >
        Needs you
      </span>
    );
  if (ai?.running > 0)
    return (
      <span
        className="chip chip--spark home-prow-ai"
        data-testid={`home-project-ai-${row.pid}`}
        data-ai="running"
      >
        <HSpark size={9} />
        AI working
      </span>
    );
  if (row.place === 'resting')
    return (
      <span className="home-prow-rest" data-testid={`home-project-resting-${row.pid}`}>
        <span className="home-prow-ring" aria-hidden="true" />
        Resting
      </span>
    );
  return null;
}

function ProfileGroup({ group, showHeader, canOpen, onOpen, onRelink, onOpenCloud }) {
  const { profile, cloud } = group;
  return (
    <div className="home-acct" data-testid={`home-profile-${profile.id}`}>
      {showHeader ? (
        <h3 className="home-acct-h">
          <span
            className={`home-acctf home-acctf--${accountFace(profile).tone}`}
            aria-hidden="true"
          >
            {accountFace(profile).initial}
          </span>
          {profile.label}
          {profile.email ? ` · ${profile.email}` : ''}
        </h3>
      ) : null}
      {cloud?.offline ? (
        <p className="home-acct-note" role="note">
          cloud.maude.sh can't be reached. Showing the last list; projects on this Mac still open.
        </p>
      ) : null}
      <ul className="home-prows">
        {group.rows.map((r) =>
          r.kind === 'cloud' ? (
            <li key={`c:${r.projectId}`} className="row-item home-prow home-prow--cloud">
              <ProjectSquare id={r.projectId} name={r.name} size="md" />
              <span className="home-prow-t" data-testid={`home-cloud-row-${r.projectId}`}>
                <strong>{r.name}</strong>
                <span>
                  {ownerWord(r.ownerName, r.role) ? `${ownerWord(r.ownerName, r.role)} · ` : ''}
                  {cloudRoleWord(r.role)} · {STATE_WORD.cloud}
                </span>
              </span>
              <button
                type="button"
                className="btn btn--sm"
                data-testid={`home-cloud-open-${r.projectId}`}
                onClick={() => onOpenCloud(r)}
                disabled={!canOpen}
                aria-label={`Open ${r.name}`}
              >
                Open
              </button>
            </li>
          ) : (
            <li key={r.pid} className="home-prow-li">
              {r.status === 'gone' ? (
                <div className="row-item home-prow home-prow--gone">
                  <ProjectSquare id={r.pid} name={r.name} size="md" />
                  <span className="home-prow-t" data-testid={`home-project-row-${r.pid}`}>
                    <strong>{r.name}</strong>
                    <span>{r.name} isn't where it was.</span>
                  </span>
                  <button
                    type="button"
                    className="btn btn--sm"
                    data-testid={`home-relink-${r.pid}`}
                    onClick={() => onRelink(r.pid)}
                    disabled={!canOpen}
                  >
                    Find the folder…
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="row-item home-prow"
                  data-testid={`home-project-row-${r.pid}`}
                  data-place={r.place}
                  onClick={() => onOpen(r.pid)}
                  disabled={!canOpen}
                >
                  <Thumb src={r.cover} className="home-prow-thumb" />
                  <span className="home-prow-t">
                    <strong>{r.name}</strong>
                    <span>
                      {[
                        r.canvasCount != null ? canvasCount(r.canvasCount) : null,
                        STATE_WORD[r.status] ?? null,
                      ]
                        .filter(Boolean)
                        .map((part, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed two-part line
                          <span key={i} className="home-prow-part">
                            {i ? ' · ' : ''}
                            {part}
                          </span>
                        ))}
                    </span>
                  </span>
                  <RowLive row={r} />
                  <ProjectSquare id={r.pid} name={r.name} />
                </button>
              )}
            </li>
          )
        )}
      </ul>
    </div>
  );
}

// ── ⌘K Search (11 pn-home-search) ───────────────────────────────────────────────────────────
// The top bar holds an icon + the ⌘K key; the field lives in a centred 620 palette over a veil. Before you
// type it is a shortcut list — Recent searches · Open tabs · Recent canvases — with an Ask AI row and a
// foot; typing searches every project on this Mac, open or not.
export const PALETTE_PLACEHOLDER = 'Search canvases, artboards, actions, or ask AI…';

function HomeSearch({
  open,
  onOpen,
  onClose,
  inputRef,
  pids,
  openTabs,
  recentCanvases,
  onOpenRow,
  onAsk,
  canOpen,
}) {
  const [q, setQ] = useState('');
  const [result, setResult] = useState(null);
  const [recent, setRecent] = useState([]);
  const [sel, setSel] = useState(0);
  const seq = useRef(0);
  const triggerRef = useRef(null);
  const pidKey = pids.join(',');

  // opening starts clean; closing hands focus back to the trigger
  useEffect(() => {
    if (!open) return undefined;
    setQ('');
    setResult(null);
    setSel(0);
    (async () => {
      const r = await getRecentSearches();
      if (r.ok && Array.isArray(r.json?.recentSearches))
        setRecent(r.json.recentSearches.slice(0, 3));
    })();
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    const trigger = triggerRef.current;
    return () => {
      clearTimeout(t);
      trigger?.focus?.();
    };
  }, [open, inputRef]);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResult(null);
      return undefined;
    }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const r = await search(term, pidKey ? pidKey.split(',') : []);
      if (n !== seq.current) return;
      setResult(r.ok ? r.json : { q: term, groups: [], closeOnly: false, failed: true });
      setSel(0);
    }, 120);
    return () => clearTimeout(t);
  }, [q, pidKey]);

  const term = q.trim();
  const found = useMemo(() => {
    const out = [];
    for (const g of result?.groups ?? [])
      for (const row of g.rows ?? []) {
        const [rel, artboard] = String(row.key).split('#');
        out.push({ ...row, pid: g.pid, project: g.name, rel, artboard: artboard || null });
      }
    return out;
  }, [result]);

  // one flat list of everything the arrows walk: the shortcut groups before you type, results after
  const items = useMemo(() => {
    const out = [];
    if (!term) {
      for (const r of recent) out.push({ type: 'recent', q: r.q, hint: r.results });
      for (const t of openTabs) out.push({ type: 'tab', ...t });
      for (const c of recentCanvases) out.push({ type: 'canvas', ...c });
    } else for (const f of found) out.push({ type: 'found', row: f });
    out.push({ type: 'ask' });
    return out;
  }, [term, recent, openTabs, recentCanvases, found]);

  const run = (it) => {
    if (!it) return;
    if (it.type === 'recent') {
      setQ(it.q);
      inputRef.current?.focus();
    } else if (it.type === 'ask') {
      onClose();
      onAsk(term);
    } else if (!canOpen) {
      // a browser tab cannot open projects
    } else if (it.type === 'tab') {
      onClose();
      onOpenRow(it.pid);
    } else if (it.type === 'canvas') {
      onClose();
      onOpenRow(it.pid, it.rel);
    } else if (it.type === 'found') {
      saveRecentSearch(term, found.length);
      onClose();
      onOpenRow(it.row.pid, it.row.rel, it.row.artboard);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const ask = items[items.length - 1];
      run(e.metaKey || e.ctrlKey ? ask : items[sel]);
    } else if (e.key === 'Tab') {
      e.preventDefault(); // the palette is one stop: the field; the arrows walk the rows
    }
  };

  const listId = 'home-search-list';
  const rowProps = (i) => ({
    id: `home-sr-${i}`,
    role: 'option',
    'aria-selected': i === sel,
    tabIndex: -1,
    onMouseEnter: () => setSel(i),
  });
  let at = -1;
  const next = () => ++at;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="island home-search-tr"
        data-testid="home-search-open"
        aria-label="Search canvases in every project"
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K"
        onClick={onOpen}
      >
        <span className="icon-btn" aria-hidden="true">
          <HIcon name="search" size={16} />
        </span>
        <kbd className="kbd">⌘K</kbd>
      </button>
      {open ? (
        // biome-ignore lint/a11y/useKeyWithClickEvents: esc closes from the field; the veil click is the pointer door
        <div
          className="home-pal-veil"
          data-testid="home-search-veil"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className="home-pal" role="dialog" aria-modal="true" aria-label="Search">
            <div className="home-pal-field">
              <HIcon name="search" size={18} />
              <input
                ref={inputRef}
                className="home-search-input"
                data-testid="home-search"
                type="search"
                role="combobox"
                aria-label="Search canvases in every project"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={items[sel] ? `home-sr-${sel}` : undefined}
                aria-autocomplete="list"
                placeholder={PALETTE_PLACEHOLDER}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
              />
              <kbd className="kbd">esc</kbd>
            </div>
            <div className="home-pal-res" id={listId} role="listbox" aria-label="Search results">
              {!term ? (
                <>
                  {recent.length ? (
                    <div>
                      <p className="island-title home-pal-gt">Recent searches</p>
                      {recent.map((r) => {
                        const i = next();
                        return (
                          <button
                            key={r.q}
                            type="button"
                            className="home-pal-row"
                            data-testid={`home-recent-search-${i}`}
                            {...rowProps(i)}
                            onClick={() => run(items[i])}
                          >
                            <span className="home-pal-ic">
                              <HIcon name="search" size={14} />
                            </span>
                            <span className="home-pal-label">{r.q}</span>
                            {r.results != null ? (
                              <span className="home-pal-hint">
                                {r.results} {r.results === 1 ? 'result' : 'results'}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {openTabs.length ? (
                    <div>
                      <p className="island-title home-pal-gt">Open tabs</p>
                      {openTabs.map((t) => {
                        const i = next();
                        return (
                          <button
                            key={t.pid}
                            type="button"
                            className="home-pal-row"
                            data-testid={`home-search-tab-${t.pid}`}
                            {...rowProps(i)}
                            onClick={() => run(items[i])}
                            disabled={!canOpen}
                          >
                            <ProjectSquare id={t.pid} name={t.name} size="md" />
                            <span className="home-pal-label">
                              <span className="home-pal-ltxt">{t.name}</span>
                              {t.meta ? <span className="home-pal-meta">{t.meta}</span> : null}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {recentCanvases.length ? (
                    <div>
                      <p className="island-title home-pal-gt">Recent canvases</p>
                      {recentCanvases.map((c) => {
                        const i = next();
                        return (
                          <button
                            key={`${c.pid}:${c.rel}`}
                            type="button"
                            className="home-pal-row"
                            data-testid={`home-search-recent-${c.pid}-${c.slug}`}
                            {...rowProps(i)}
                            onClick={() => run(items[i])}
                            disabled={!canOpen}
                          >
                            <Thumb src={c.thumb} className="home-thumb-pal" />
                            <span className="home-pal-label">
                              <span className="home-pal-ltxt">{c.name}</span>
                              <span className="home-pal-meta">{c.meta}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {!recent.length && !openTabs.length && !recentCanvases.length ? (
                    <p className="home-pal-none">Search every project on this Mac, open or not.</p>
                  ) : null}
                </>
              ) : result && !found.length ? (
                <p className="home-pal-none">
                  {result.failed
                    ? "Search isn't available right now. Try again in a moment."
                    : `Nothing called “${term}”. Try another word.`}
                </p>
              ) : (
                <>
                  {result?.closeOnly ? (
                    <p className="home-pal-note">
                      <HIcon name="search" size={12} />
                      <span>Showing close matches for “{term}”</span>
                    </p>
                  ) : null}
                  {(result?.groups ?? []).map((g) => (
                    <div key={g.pid}>
                      <p className="island-title home-pal-gt">
                        <ProjectSquare id={g.pid} name={g.name} />
                        {g.name}
                      </p>
                      {g.rows.map((row) => {
                        const i = found.findIndex((x) => x.pid === g.pid && x.key === row.key);
                        const [rel, artboard] = String(row.key).split('#');
                        return (
                          <button
                            key={row.key}
                            type="button"
                            className="home-pal-row"
                            data-testid={`home-search-row-${g.pid}-${rowSlug(rel)}${artboard ? `-${artboard}` : ''}`}
                            {...rowProps(i)}
                            onClick={() => run(items[i])}
                            disabled={!canOpen}
                          >
                            {row.cover ? (
                              <Thumb src={thumbUrl(g.pid, row.cover)} className="home-thumb-pal" />
                            ) : (
                              <span className="home-pal-ic">
                                <HIcon
                                  name={row.group === 'artboards' ? 'home' : 'folder'}
                                  size={14}
                                />
                              </span>
                            )}
                            <span className="home-pal-label">
                              <span className="home-pal-ltxt">{marked(row.name, row.marks)}</span>
                              {row.meta ? <span className="home-pal-meta">{row.meta}</span> : null}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </>
              )}
              <div className="home-pal-ask">
                <button
                  type="button"
                  className="home-pal-row"
                  data-testid="home-search-ask"
                  {...rowProps(items.length - 1)}
                  onClick={() => run(items[items.length - 1])}
                >
                  <span className="home-pal-ic home-pal-ic--spark">
                    <HSpark size={12} />
                  </span>
                  <span className="home-pal-label">
                    <span className="home-pal-ltxt">Ask AI</span>
                    <span className="home-pal-meta">
                      {term
                        ? ` — find “${term}” by what it looks like`
                        : ' — describe what you want on the canvas'}
                    </span>
                  </span>
                  <span className="home-pal-keys">
                    <kbd className="kbd">⌘</kbd>
                    <kbd className="kbd">↵</kbd>
                  </span>
                </button>
              </div>
            </div>
            <div className="home-pal-foot">
              <span className="home-pal-hints">
                <span>
                  <kbd className="kbd">↑</kbd>
                  <kbd className="kbd">↓</kbd> move
                </span>
                <span>
                  <kbd className="kbd">↵</kbd> open
                </span>
              </span>
              <span>
                {term && found.length
                  ? `${found.length} ${found.length === 1 ? 'result' : 'results'} · every project, open or not`
                  : 'every project, open or not'}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function marked(name, marks) {
  if (!Array.isArray(marks) || !marks.length) return name;
  const out = [];
  let at = 0;
  for (const [s, e] of marks) {
    if (s > at) out.push(name.slice(at, s));
    out.push(<mark key={s}>{name.slice(s, e)}</mark>);
    at = e;
  }
  if (at < name.length) out.push(name.slice(at));
  return out;
}
