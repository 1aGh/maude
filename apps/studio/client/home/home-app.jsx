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
  getCloud,
  getIndex,
  getRecentSearches,
  inShell,
  managedProjectOpen,
  openCloudUrl,
  openProject,
  openProjectFolder,
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
import { HIcon, HMark, HSpark, ProjectSquare } from './home-icons.jsx';
import {
  buildHomeModel,
  canvasCount,
  cloudRoleWord,
  indexQuery,
  linkProfile,
  localPidForLink,
  relativeTime,
  rowSlug,
  thumbUrl,
} from './home-model.js';

// ── theme: the Home window follows the Mac's appearance (light is the v2 default) ──────────────
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
      return;
    }
    const answers = await Promise.all(ids.map((id) => getCloud(id)));
    setClouds(
      answers.map((a) => (a.json && typeof a.json === 'object' ? a.json : null)).filter(Boolean)
    );
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

  return { native, shell, index, clouds, status, reload: loadAll, patchPin };
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
function useNewProjectRequest(native, onRequest) {
  useEffect(() => {
    if (!native) return undefined;
    let alive = true;
    let off = null;
    shellListen('menu://action', (p) => {
      if (p?.id === 'project.new') onRequest();
    }).then((fn) => {
      if (alive) off = fn;
      else fn();
    });
    return () => {
      alive = false;
      off?.();
    };
  }, [native, onRequest]);
}

// ── page ─────────────────────────────────────────────────────────────────────────────────────
export function HomeApp() {
  const theme = useSystemTheme();
  const data = useHomeData();
  const [filterPid, setFilterPid] = useState('');
  const [notice, setNotice] = useState(null);
  const [link, setLink] = useDeepLink(data.native);
  const [linkBusy, setLinkBusy] = useState(false);
  const searchRef = useRef(null);
  // null | { name, busy } — the New project… sheet.
  const [creating, setCreating] = useState(null);
  const askNewProject = useCallback(() => setCreating((c) => c ?? { name: '', busy: false }), []);
  useNewProjectRequest(data.native, askNewProject);

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
  const searchPids = useMemo(
    () => (data.shell ? indexQuery(data.shell).pids : browserPids()),
    [data.shell]
  );

  // ⌘K focuses Search (contract §5.9 `home.search`)
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
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
  const openPrepared = useCallback(async (prep, name) => {
    if (!prep.ok || !prep.json?.ok) {
      setNotice(prep.json?.error || `${name} could not be opened. Try again in a moment.`);
      return;
    }
    const root = await managedProjectOpen(prep.json);
    if (typeof root === 'string' && root) await openProject({ root });
  }, []);

  const openCloud = useCallback(
    async (row) => {
      try {
        if (row.role === 'observer') {
          if (row.url) await openCloudUrl(row.url);
          return;
        }
        await openPrepared(await prepareCloud(row.profile, row.url, row.projectId), row.name);
      } catch (e) {
        fail(e);
      }
    },
    [fail, openPrepared]
  );

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
      const prep = await prepareCloudLink(linkProfile(data.shell, data.clouds, link.project), link);
      await openPrepared(prep, link.project);
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

  const hasProjects = model.groups.some((g) => g.rows.length);
  return (
    <div className="maude-v2 home-root" data-theme={theme} data-testid="home-root">
      <header className="home-top">
        <span className="island home-pill">
          <HMark size={22} />
          <span className="home-pill-name">Home</span>
        </span>
        <HomeSearch
          inputRef={searchRef}
          pids={searchPids}
          onOpen={(pid, canvas, artboard) => open(pid, canvas, artboard)}
          canOpen={data.native}
        />
      </header>

      <main className="home-page" aria-label="Home">
        <h1 className="home-sr">Home</h1>
        {/* S6 puts the question here ("What shall we make?", Ask AI, starters). */}
        <div className="home-ask" data-slot="home-ask" />

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
              <span className="home-h-aside">pin any canvas from its card</span>
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
          </h2>
          {model.recent.length ? (
            <ul className="home-cards">
              {model.recent.map((r) => (
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
                  <PinButton row={r} testid={`home-pin-${r.pid}-${r.slug}`} onToggle={togglePin} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="home-empty-line">
              {data.status === 'loading' ? 'Loading…' : 'Canvases you open show up here.'}
            </p>
          )}
        </section>

        <section className="home-sec" aria-labelledby="home-h-projects">
          <h2 className="home-h" id="home-h-projects">
            Projects
            {model.projectCount ? (
              <span className="home-h-aside">
                {model.projectCount} {model.projectCount === 1 ? 'project' : 'projects'}
              </span>
            ) : null}
          </h2>
          <div className="island home-projlist">
            {model.groups.map((g) => (
              <ProfileGroup
                key={g.profile.id}
                group={g}
                showHeader={model.groups.length > 1 || !!g.profile.email}
                canOpen={data.native}
                onOpen={(pid) => open(pid)}
                onRelink={relink}
                onOpenCloud={openCloud}
              />
            ))}
            {!hasProjects && data.status !== 'loading' ? (
              <p className="home-empty-line">No projects on this Mac yet.</p>
            ) : null}
            <div className="home-projmore">
              <button
                type="button"
                className="btn btn--ghost btn--sm home-projopen"
                data-testid="home-new-project"
                onClick={askNewProject}
                disabled={!data.native}
              >
                <HIcon name="plus" size={14} />
                New project…
                <kbd className="kbd">⇧⌘N</kbd>
              </button>
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
        <div className="home-link-modal" role="dialog" aria-modal="true" aria-label="New project">
          <div className="home-link-scrim" aria-hidden="true" onClick={() => setCreating(null)} />
          <form
            className="island home-link-dialog"
            data-testid="home-create-dialog"
            onSubmit={(e) => {
              e.preventDefault();
              createProject();
            }}
          >
            <h2>New project</h2>
            <p>It goes in the Maude folder in your home folder and opens in a new tab.</p>
            <input
              className="home-create-name"
              data-testid="home-create-name"
              aria-label="Project name"
              placeholder="Untitled project"
              // biome-ignore lint/a11y/noAutofocus: the sheet opens for this one field
              autoFocus
              maxLength={80}
              value={creating.name}
              onChange={(e) => setCreating({ ...creating, name: e.target.value })}
            />
            <div className="home-link-foot">
              <button
                type="button"
                className="btn"
                data-testid="home-create-cancel"
                onClick={() => setCreating(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                data-testid="home-create-submit"
                disabled={creating.busy}
              >
                {creating.busy ? 'Creating…' : 'Create project'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
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
          <span className="home-acctf" aria-hidden="true">
            {(profile.label || '·')[0].toUpperCase()}
          </span>
          {profile.label}
          {profile.email ? ` · ${profile.email}` : ''}
        </h3>
      ) : null}
      {cloud?.offline ? (
        <p className="home-acct-note" role="note">
          Maude Cloud can't be reached. Showing the last list; projects on this Mac still open.
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
                  {r.ownerName ? `${r.ownerName}'s · ` : ''}
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
                  {r.cover ? (
                    <Thumb src={r.cover} className="home-prow-thumb" />
                  ) : (
                    <ProjectSquare id={r.pid} name={r.name} size="md" />
                  )}
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
                </button>
              )}
            </li>
          )
        )}
      </ul>
    </div>
  );
}

// ── ⌘K Search ───────────────────────────────────────────────────────────────────────────────
function HomeSearch({ inputRef, pids, onOpen, canOpen }) {
  const [q, setQ] = useState('');
  const [openList, setOpenList] = useState(false);
  const [result, setResult] = useState(null);
  const [recent, setRecent] = useState([]);
  const [sel, setSel] = useState(0);
  const seq = useRef(0);
  const wrapRef = useRef(null);
  const pidKey = pids.join(',');

  // focus leaving the field and its panel closes the panel
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const out = (e) => {
      if (!el.contains(e.relatedTarget)) setOpenList(false);
    };
    el.addEventListener('focusout', out);
    return () => el.removeEventListener('focusout', out);
  }, []);

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

  const loadRecent = async () => {
    const r = await getRecentSearches();
    if (r.ok && Array.isArray(r.json?.recentSearches)) setRecent(r.json.recentSearches.slice(0, 6));
  };

  const rows = useMemo(() => {
    const out = [];
    for (const g of result?.groups ?? [])
      for (const row of g.rows ?? []) {
        const [rel, artboard] = String(row.key).split('#');
        out.push({ ...row, pid: g.pid, project: g.name, rel, artboard: artboard || null });
      }
    return out;
  }, [result]);

  const pick = (row) => {
    if (!row || !canOpen) return;
    saveRecentSearch(q.trim(), rows.length);
    setOpenList(false);
    onOpen(row.pid, row.rel, row.artboard);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (q) setQ('');
      else {
        setOpenList(false);
        e.currentTarget.blur();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(rows.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(rows[sel]);
    }
  };

  const term = q.trim();
  const listId = 'home-search-list';
  return (
    <div className="home-search-wrap" ref={wrapRef}>
      <div className="island home-search">
        <HIcon name="search" size={16} />
        <input
          ref={inputRef}
          className="home-search-input"
          data-testid="home-search"
          type="search"
          role="combobox"
          aria-label="Search canvases in every project"
          aria-expanded={openList}
          aria-controls={listId}
          aria-activedescendant={openList && rows[sel] ? `home-sr-${sel}` : undefined}
          aria-autocomplete="list"
          placeholder="Search canvases and artboards…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpenList(true);
          }}
          onFocus={() => {
            setOpenList(true);
            loadRecent();
          }}
          onKeyDown={onKeyDown}
        />
        <kbd className="kbd">⌘K</kbd>
      </div>
      {openList ? (
        <div className="home-pal">
          {!term ? (
            recent.length ? (
              <div>
                <p className="island-title home-pal-gt" id="home-pal-recent">
                  Recent searches
                </p>
                {recent.map((r) => (
                  <button
                    key={r.q}
                    type="button"
                    className="home-pal-row"
                    onClick={() => {
                      setQ(r.q);
                      inputRef.current?.focus();
                    }}
                  >
                    <span className="home-pal-ic">
                      <HIcon name="search" size={14} />
                    </span>
                    <span className="home-pal-label">{r.q}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="home-pal-none">Search every project on this Mac, open or not.</p>
            )
          ) : result && !rows.length ? (
            <p className="home-pal-none">
              {result.failed
                ? "Search isn't available right now. Try again in a moment."
                : `Nothing called “${term}”. Try another word.`}
            </p>
          ) : (
            <div id={listId} role="listbox" aria-label="Search results">
              {result?.closeOnly ? (
                <p className="home-pal-note">Showing close matches for “{term}”</p>
              ) : null}
              {(result?.groups ?? []).map((g) => (
                <div key={g.pid}>
                  <p className="island-title home-pal-gt">
                    <ProjectSquare id={g.pid} name={g.name} />
                    {g.name}
                  </p>
                  {g.rows.map((row) => {
                    const i = rows.findIndex((x) => x.pid === g.pid && x.key === row.key);
                    const [rel, artboard] = String(row.key).split('#');
                    return (
                      <button
                        key={row.key}
                        id={`home-sr-${i}`}
                        type="button"
                        role="option"
                        aria-selected={i === sel}
                        className="home-pal-row"
                        data-testid={`home-search-row-${g.pid}-${rowSlug(rel)}${artboard ? `-${artboard}` : ''}`}
                        onMouseEnter={() => setSel(i)}
                        onClick={() => pick(rows[i])}
                        disabled={!canOpen}
                      >
                        {row.cover ? (
                          <Thumb src={thumbUrl(g.pid, row.cover)} className="home-thumb-pal" />
                        ) : (
                          <span className="home-pal-ic">
                            <HIcon name={row.group === 'artboards' ? 'home' : 'folder'} size={14} />
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
            </div>
          )}
          <div className="home-pal-foot">
            <span>
              {term && rows.length
                ? `${rows.length} ${rows.length === 1 ? 'result' : 'results'}`
                : ''}
            </span>
            <span>every project, open or not</span>
          </div>
        </div>
      ) : null}
    </div>
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
