// client/v2/left-panel/assets-panel.jsx — the Assets tab, the left panel's third (CONTRACT §7; 12 · ia-assets-panel,
// ia-assets-keys; 05 · es-panels-make). V2-4.4a hosted the library; S8.12 groups it by usage.
//
// Pictures come first, then Video and Sound. Hover or focus gives a tile's name and where it is used. A picture drags onto
// a frame (`tile-drag.js`) and ↵ places it on the selected artboard (`assets.place` → `placeAsset`, one edit-op, one undo
// step); right-click opens the same two actions as a menu (Place · Show details ⌘I). + and "From this Mac…" add from Finder,
// and files dropped on an empty Assets land here too. The rows are the index's (`use-assets.js`).
// S8.13: a group heading ("Photos 120 ›") widens into the Browse view (assets/browse-view.jsx: big pictures, sort, size, ⇧/⌘
// multi-select, ↵ fills the artboard's frames in order); "Not used" lists what nothing needs and "Move N to the trash…" takes it,
// sidecars with it (assets/tidy.jsx); a tile's menu has Move to trash. Every move asks the studio, which refuses a picture a
// canvas uses or an older version still shows (`POST /_api/assets/trash`).
// S8.14: what arrived in this window is the first group, "Just added" (assets/just-added.js); a tile still going up to the cloud
// wears a thin bar (the shell lane's `assetUploadOf`); "From this Mac…" with an artboard selected imports AND places (the Image
// (I) route, no drag — the studio picks: empty frames in order, else a tidy grid, else loose).
// S8.16: the spark in the head row is Assets › Generate (`assets.generate`, assets/generate-ask.jsx): the selected artboard
// sets the shape, a quote says how long and who pays before anything is sent, and the best take lands in the frame.
// S8.21: ⌘I / "Show details" opens the asset's details IN PLACE OF the list (assets/details.jsx: a photo, Made by AI, footage, sound;
// "Used in" opens the artboard; Advanced holds the stored name, the Original on this Mac and the command). "Generated" is a group of
// its own after Just added: the pictures that have a `.gen.json`, one block per generation run (assets/generated.js).
// NOT here yet: search in pictures (S8.20).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uploadAsset } from '../../../asset-upload.ts';
import { mimeFromExt } from '../../dialogs/asset-picker.jsx';
import { isNativeApp, pickMediaFiles, pickedMediaSource } from '../../github.js';
import { Kbd, StIcon } from '../../shell/icons.jsx';
import { assetUploadOf, useAssetAnswers } from '../assets/asset-state-lane.js';
import { bindAssetsPanel, takeGenerateRequest } from '../assets/assets-bus.js';
import { filterAssets } from '../assets/browse-model.js';
import { BrowseView, browseOrder, MAX_PLACE } from '../assets/browse-view.jsx';
import { NOTHING_PICKED, pick as pickTile, pickAll } from '../assets/multi-select.js';
import { AssetDetails } from '../assets/details.jsx';
import { GenerateAsk } from '../assets/generate-ask.jsx';
import { runMeta, runTitle, splitGenerated, useGenerated } from '../assets/generated.js';
import { splitJustAdded } from '../assets/just-added.js';
import { placeAsset, SELECT_ARTBOARD_LINE } from '../assets/place-asset.js';
import { AssetTile } from '../assets/tile.jsx';
import { AssetTileMenu, tileMenuItems } from '../assets/tile-menu.jsx';
import { ConfirmTrash, NotCountedNote, TidyFoot, tidyModel } from '../assets/tidy.jsx';
import { moveAssetsToTrash, undoAssetTrash } from '../assets/trash-assets.js';
import { useAssets } from '../assets/use-assets.js';
import { AskButton, copy, Empty } from '../empty/index.js';
import { getPaletteEnv } from '../search/search-env.js';
import { menuRunner } from '../shell/menu-runner.js';

export { filterAssets };

const GROUPS = [
  { kind: 'image', title: 'Photos' },
  { kind: 'video', title: 'Video' },
  { kind: 'audio', title: 'Sound' },
];

/**
 * Photos / Video / Sound, empty groups left out. `justAdded` (S8.14): what arrived in this window comes first, in its own
 * "Just added" group, and is not repeated under its kind. `generated` (S8.21): the server's generation runs; their pictures sit
 * in "Generated" (one block per run) after Just added, claimed first so a fresh take is there at once, and not repeated either.
 */
export function groupAssets(assets, { justAdded = false, now, generated = [] } = {}) {
  const { runs, rest: others } = splitGenerated(assets, generated);
  const { added, rest } = justAdded ? splitJustAdded(others, now) : { added: [], rest: others };
  const kinds = GROUPS.map((g) => ({
    ...g,
    items: rest.filter((a) => (a.kind || 'image') === g.kind),
  })).filter((g) => g.items.length);
  const gen = runs.length
    ? [{ kind: 'generated', title: 'Generated', items: runs.flatMap((r) => r.items), runs }]
    : [];
  return [
    ...(added.length ? [{ kind: 'added', title: 'Just added', items: added }] : []),
    ...gen,
    ...kinds,
  ];
}

async function addFilesNative(onProgress) {
  const picked = await pickMediaFiles();
  const sources = (picked || []).map((p) => pickedMediaSource(p, mimeFromExt(p.name)));
  try {
    return await Promise.all(sources.map((f) => uploadAsset(f, { onProgress })));
  } finally {
    for (const src of sources) src.release();
  }
}

function addFilesBrowser(onProgress) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,video/*,audio/*';
    input.style.cssText =
      'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(input);
    const done = (v) => {
      if (input.isConnected) input.remove();
      resolve(v);
    };
    input.addEventListener('change', async () => {
      const files = input.files ? Array.from(input.files) : [];
      done(await Promise.all(files.map((f) => uploadAsset(f, { onProgress }))));
    });
    window.addEventListener('focus', () => setTimeout(() => done([]), 400), { once: true });
    input.click();
  });
}

const IMAGE_PATH = /\.(avif|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i;

const hasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

export function AssetsPanel({
  designRel = '.design',
  readOnly = false,
  // S2.15 — where ↵ puts the picked tile (place-asset.js `placeTargetOf`), and the undo sink for that write
  placeTarget = null,
  // S8.12 — the selected artboard's name, for "Place in MVP zápasu"
  placeLabel = null,
  onRecord = undefined,
  // S8.16 — the Generate ask selects what it placed (`select-by-id`) and says so in a toast with Undo
  postToActiveCanvas = undefined,
  toast = undefined,
  // S8.21 — "Used in" in the details opens the canvas (`<designRel>/<canvas>`) and selects the artboard
  onOpenCanvas = undefined,
  fetchImpl = undefined,
}) {
  const { assets, history, reload } = useAssets({ fetchImpl });
  const generated = useGenerated({ fetchImpl });
  const reloadGenerated = generated.reload;
  // a run's record is a file of its own: re-read when the rows move, so a take that just landed is in its run
  // biome-ignore lint/correctness/useExhaustiveDependencies: `assets` changing IS the trigger
  useEffect(() => {
    if (assets) void reloadGenerated();
  }, [assets, reloadGenerated]);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);
  const [menu, setMenu] = useState(null);
  const [details, setDetails] = useState(null);
  // S8.13 — the wide Browse view (null = the narrow tab), the Not used filter, the confirm sheet and the Undo line
  const [browse, setBrowse] = useState(null);
  const [notUsedOnly, setNotUsedOnly] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [trashed, setTrashed] = useState(null);
  const [box, setBox] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [err, setErr] = useState('');
  const [dropping, setDropping] = useState(false);
  const [asking, setAsking] = useState(() => !readOnly && takeGenerateRequest());
  const alive = useRef(true);
  const rootRef = useRef(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const upload = async (run) => {
    setBusy(true);
    setErr('');
    let results = [];
    try {
      results = await run();
      const failed = results.filter((r) => !('path' in r)).length;
      if (failed) setErr(`${failed} of ${results.length} uploads failed`);
      if (results.length) await reload();
    } catch (e) {
      setErr(e?.message || 'Could not add files.');
    }
    setProgress(null);
    setBusy(false);
    return results;
  };
  const pickFiles = () =>
    isNativeApp() ? addFilesNative(setProgress) : addFilesBrowser(setProgress);
  const add = () => upload(pickFiles);
  // S8.14 — Image (I) shows this tab; "From this Mac…" there does what a drop on the artboard does: the photos chosen are
  // imported AND placed on the selected artboard (empty frames in order, else a tidy grid, else loose), in one write.
  // With no artboard selected it is the plain import it always was.
  const addAndPlace = async () => {
    const results = await upload(pickFiles);
    const paths = results.filter((r) => 'path' in r && IMAGE_PATH.test(r.path)).map((r) => r.path);
    if (readOnly || !placeTarget || paths.length === 0) return;
    const r = await placeAsset(
      { assets: paths.slice(0, MAX_PLACE), target: placeTarget, mode: 'auto' },
      { record: onRecord }
    );
    if (!r.ok && alive.current) setErr(r.message);
  };

  const byPath = useMemo(() => new Map((assets || []).map((a) => [a.path, a])), [assets]);
  // Not used needs the index's verdicts; the old listing has none, so the chip is not drawn there
  const hasUsage = useMemo(() => (assets || []).some((a) => a.usedIn != null), [assets]);
  const tidy = useMemo(() => tidyModel(assets || [], history), [assets, history]);
  const pool = notUsedOnly && hasUsage ? tidy.list : assets || [];
  const shown = useMemo(() => filterAssets(pool, query), [pool, query]);
  // S8.14 — Just added on top; not in the Not used view, which lists what to tidy (its own order)
  const groups = useMemo(
    () =>
      groupAssets(shown, {
        justAdded: !(notUsedOnly && hasUsage),
        generated: notUsedOnly && hasUsage ? [] : generated.groups,
      }),
    [shown, notUsedOnly, hasUsage, generated.groups]
  );
  useAssetAnswers(); // the bars on tiles follow what the studio last said about each open canvas
  const url = (p) => `/${designRel}/${p}`;
  const renderTile = (a) => (
    <AssetTile
      key={a.path}
      asset={a}
      url={url(a.path)}
      picked={picked === a.path}
      canDrag={!readOnly}
      onPick={setPicked}
      onMenu={openMenu}
      uploading={assetUploadOf(a.path)}
    />
  );

  // ↵ / the menu's Place: the picked picture onto the selected artboard (or frame). One edit-op, one undo step.
  const place = useCallback(
    async (path) => {
      if (readOnly) return;
      const asset = byPath.get(path);
      if (!asset || asset.kind !== 'image') return;
      if (!placeTarget) {
        setErr(SELECT_ARTBOARD_LINE);
        return;
      }
      setErr('');
      const tile = Array.from(rootRef.current?.querySelectorAll?.('[data-asset]') ?? []).find(
        (el) => el.dataset.asset === path
      );
      const img = tile?.querySelector?.('img');
      const natural =
        img?.naturalWidth > 0 && img?.naturalHeight > 0
          ? { w: img.naturalWidth, h: img.naturalHeight }
          : undefined;
      const r = await placeAsset(
        { asset: path, target: placeTarget, natural },
        { record: onRecord }
      );
      if (!r.ok && alive.current) setErr(r.message);
    },
    [readOnly, byPath, placeTarget, onRecord]
  );
  const showDetails = useCallback(
    (path) => {
      const asset = byPath.get(path);
      if (asset) setDetails(path);
    },
    [byPath]
  );

  // ── S8.13: the wide Browse view ────────────────────────────────────────────────────────────────────────────────
  const openBrowse = (kind) => {
    setMenu(null);
    setDetails(null);
    setBrowse({ kind, query: '', sort: 'newest', size: 'large', ...NOTHING_PICKED });
  };
  const patchBrowse = (patch) => setBrowse((b) => (b ? { ...b, ...patch } : b));
  const onBrowsePick = (ids, path, e, isMenu) =>
    setBrowse((b) => {
      if (!b) return b;
      if (isMenu && b.selected.has(path)) return b; // a right-click inside the picked ones keeps them
      return {
        ...b,
        ...pickTile(
          ids,
          b,
          path,
          isMenu ? {} : { shift: !!e?.shiftKey, meta: !!(e?.metaKey || e?.ctrlKey) }
        ),
      };
    });
  // the picked pictures in the order the view draws them — reading order, which is the order ↵ fills the frames
  const browsePicked = (b = browse) =>
    b && assets ? browseOrder(assets, b).filter((id) => b.selected.has(id)) : [];

  // the view sits over the canvas beside the panel: its box comes from the panel's own
  useEffect(() => {
    if (!browse) {
      setBox(null);
      return undefined;
    }
    const measure = () => {
      const r = rootRef.current?.getBoundingClientRect?.();
      if (!r || !r.width) return;
      const width = Math.max(r.width, Math.min(820, window.innerWidth - 48));
      const fromRight = r.left > window.innerWidth / 2;
      setBox({
        left: fromRight ? Math.max(8, r.right - width) : r.left,
        top: r.top,
        height: r.height,
        width: Math.min(width, window.innerWidth - 16),
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [!!browse]);

  // ↵ with several pictures picked: the frames of the target fill in reading order (image.place, fill-in-order)
  const placeMany = useCallback(
    async (paths) => {
      if (readOnly) return;
      const list = paths.filter((p) => byPath.get(p)?.kind === 'image');
      if (list.length === 0) return;
      if (list.length === 1) return place(list[0]);
      if (!placeTarget) {
        setErr(SELECT_ARTBOARD_LINE);
        return;
      }
      if (list.length > MAX_PLACE) {
        setErr(`Place up to ${MAX_PLACE} at a time.`);
        return;
      }
      setErr('');
      const r = await placeAsset(
        { assets: list, target: placeTarget, mode: 'fill-in-order' },
        { record: onRecord }
      );
      if (!r.ok && alive.current) setErr(r.message);
    },
    [readOnly, byPath, place, placeTarget, onRecord]
  );

  // ── S8.13: Move to the trash — one request, the studio decides; Undo puts the bundles back ──────────────────────
  const trashPaths = useCallback(
    async (paths) => {
      if (readOnly || paths.length === 0) return;
      setErr('');
      setTrashed(null);
      const r = await moveAssetsToTrash(paths, fetchImpl ? { fetchImpl } : {});
      if (!alive.current) return;
      if (r.moved.length) {
        const gone = new Set(r.moved.map((m) => m.rel));
        setTrashed({ moved: r.moved, message: r.message });
        setPicked((p) => (p && gone.has(p) ? null : p));
        setBrowse((b) =>
          b ? { ...b, selected: new Set([...b.selected].filter((x) => !gone.has(x))) } : b
        );
        setDetails((d) => (d && gone.has(d) ? null : d));
      } else setErr(r.message);
      await reload();
    },
    [readOnly, fetchImpl, reload]
  );
  const undoTrash = async () => {
    const t = trashed;
    if (!t) return;
    setTrashed(null);
    const r = await undoAssetTrash(t.moved, fetchImpl ? { fetchImpl } : {});
    if (!alive.current) return;
    if (!r.ok) setErr(r.message);
    await reload();
  };
  // the tile menu's / the registry's Move to trash: the picked tile, or the picked ones when the tile is among them
  const trashSelection = useCallback(
    (path) => {
      if (browse && (!path || browse.selected.has(path))) {
        const list = browsePicked();
        if (list.length) return void trashPaths(list);
      }
      const one = path || picked;
      if (one) void trashPaths([one]);
    },
    [browse, picked, trashPaths, assets]
  );

  // The registry reaches the tab through the bus: the same functions the tile menu runs.
  const live = useRef({});
  live.current = {
    picked,
    browse,
    browsePicked,
    place,
    placeMany,
    showDetails,
    trashSelection,
    readOnly,
  };
  useEffect(
    () =>
      bindAssetsPanel({
        place: () => {
          const l = live.current;
          if (l.browse) {
            const list = l.browsePicked();
            if (list.length) void l.placeMany(list);
          } else if (l.picked) void l.place(l.picked);
        },
        details: () => {
          const l = live.current;
          if (l.browse) {
            const one = l.browsePicked()[0];
            if (!one) return;
            setBrowse(null);
            l.showDetails(one);
          } else if (l.picked) l.showDetails(l.picked);
        },
        trash: () => {
          const l = live.current;
          if (l.browse ? l.browse.selected.size > 0 : l.picked) l.trashSelection();
        },
        generate: () => {
          if (!live.current.readOnly) setAsking(true);
        },
        tileSelected: () => {
          const l = live.current;
          const has = l.browse ? l.browse.selected.size > 0 : !!l.picked;
          return has && !!rootRef.current?.contains(document.activeElement);
        },
      }),
    []
  );

  const openMenu = (e, asset) => {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const at = {
      left: e.clientX || r.left,
      top: e.clientY || r.top,
      bottom: e.clientY || r.bottom,
    };
    setMenu({ anchor: at, asset });
  };
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuCount =
    menu && browse && browse.selected.has(menu.asset.path) ? browse.selected.size : 1;
  const menuItems = menu
    ? tileMenuItems(menu.asset, { readOnly, placeLabel, count: menuCount })
    : [];
  const onMenuSelect = (id) => {
    const path = menu?.asset.path;
    setMenu(null);
    if (!path) return;
    if (id === 'place') {
      if (browse && browse.selected.has(path) && browse.selected.size > 1)
        void placeMany(browsePicked());
      else void place(path);
    } else if (id === 'details') {
      setBrowse(null);
      showDetails(path);
    } else if (id === 'trash') trashSelection(path);
  };

  const detailed = details ? byPath.get(details) : null;
  // Not used, narrowed by the search: the numbers on the foot are what is listed, so "Move N" moves what is shown
  const tidyShown = useMemo(
    () => ({
      ...tidy,
      list: shown,
      count: shown.length,
      bytes: shown.reduce((n, a) => n + (Number(a.size) || 0), 0),
    }),
    [tidy, shown]
  );
  // the line under the head: an error, or what was moved with its Undo
  const note = err ? (
    <p className="lp-note lp-note--err" role="alert">
      {err}
    </p>
  ) : trashed ? (
    <p className="lp-note lp-note--undo" role="status" data-testid="assets-trashed">
      <span>{trashed.message}</span>
      <button
        type="button"
        className="lp-undo"
        data-testid="assets-trashed-undo"
        onClick={undoTrash}
      >
        Undo
      </button>
    </p>
  ) : null;
  // esc clears the picked ones, then goes back; ⌘A picks every picture drawn
  const onBrowseKey = (e) => {
    if (!browse || e.defaultPrevented) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (browse.selected.size) patchBrowse({ ...NOTHING_PICKED });
      else setBrowse(null);
    } else if (
      (e.metaKey || e.ctrlKey) &&
      e.key.toLowerCase() === 'a' &&
      e.target.tagName !== 'INPUT'
    ) {
      e.preventDefault();
      patchBrowse(pickAll(assets ? browseOrder(assets, browse) : []));
    }
  };
  const env = getPaletteEnv();
  const canAsk = !readOnly && env.canAskAI?.() === true;
  const emptyWords = copy('es-panels-make.assets-none');

  const onDrop = (e) => {
    if (readOnly || !hasFiles(e)) return;
    e.preventDefault();
    setDropping(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length)
      void upload(() => Promise.all(files.map((f) => uploadAsset(f, { onProgress: setProgress }))));
  };

  return (
    <div
      ref={rootRef}
      className="lp-assets"
      data-testid="assets-panel"
      data-dropping={dropping ? 'true' : undefined}
      onDragOver={(e) => {
        if (readOnly || !hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false);
      }}
      onDrop={onDrop}
    >
      {detailed ? null : (
        <div className="lp-head-row">
          <label className="lp-find">
            <StIcon name="search" size={13} />
            <input
              type="search"
              data-testid="assets-search"
              placeholder="Search assets"
              aria-label="Search assets"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query ? null : <Kbd>⌘K</Kbd>}
          </label>
          {readOnly ? null : (
            <button
              type="button"
              className="st-iconbtn lp-add"
              data-testid="assets-generate"
              aria-label="Generate an image"
              data-tip="Generate an image"
              aria-pressed={asking}
              onClick={() => setAsking((v) => !v)}
            >
              <StIcon name="sparkle" size={14} />
            </button>
          )}
          {readOnly ? null : (
            <button
              type="button"
              className="st-iconbtn lp-add"
              data-testid="assets-add"
              aria-label="Add files…"
              data-tip="Add files…"
              disabled={busy}
              onClick={add}
            >
              <StIcon name="plus" size={15} />
            </button>
          )}
        </div>
      )}
      {hasUsage && !detailed ? (
        <div className="lp-chips">
          <button
            type="button"
            className="lp-chip"
            data-testid="assets-chip-notused"
            aria-pressed={notUsedOnly}
            onClick={() => setNotUsedOnly((v) => !v)}
          >
            {notUsedOnly ? <StIcon name="check" size={11} /> : null}
            Not used
          </button>
        </div>
      ) : null}
      {busy ? (
        <p className="lp-note" role="status">
          {progress == null ? 'Adding…' : `Adding… ${Math.round(progress * 100)}%`}
        </p>
      ) : null}
      {note}
      {asking && !readOnly ? (
        <GenerateAsk
          target={placeTarget}
          where={placeLabel}
          onClose={() => setAsking(false)}
          onRecord={onRecord}
          fetchImpl={fetchImpl}
          onSelect={(c) => {
            // the write lands, the canvas re-renders, then the new picture can be selected
            for (const ms of [300, 900])
              setTimeout(
                () =>
                  postToActiveCanvas?.({
                    dgn: 'select-by-id',
                    id: c.element,
                    artboardId: c.artboard,
                  }),
                ms
              );
          }}
          onDone={(line) => {
            void reload();
            toast?.(line, true, { label: 'Undo', onClick: () => menuRunner.run('edit.undo') });
          }}
          onOther={() => menuRunner.run('ai.generate')}
        />
      ) : null}
      {detailed ? (
        <AssetDetails
          asset={detailed}
          url={url(detailed.path)}
          placeLabel={placeLabel}
          canPlace={!readOnly}
          onPlace={(p) => void place(p)}
          onBack={() => setDetails(null)}
          onOpenBoard={(canvas, boardId) => onOpenCanvas?.(`${designRel}/${canvas}`, boardId)}
          fetchImpl={fetchImpl}
        />
      ) : null}
      {notUsedOnly && hasUsage ? <NotCountedNote model={tidy} /> : null}
      <div className="lp-assets-list" hidden={!!browse || !!detailed}>
        {assets == null ? (
          <p className="lp-empty-b">Loading…</p>
        ) : assets.length === 0 ? (
          <Empty
            spot="image"
            spotW={168}
            copyId="es-panels-make.assets-none"
            testid="assets-empty"
            className="es-e--inpanel"
            actions={
              canAsk ? (
                <AskButton onClick={() => env.askAI?.(emptyWords.action)}>
                  {emptyWords.action}
                </AskButton>
              ) : null
            }
          />
        ) : notUsedOnly && hasUsage && shown.length === 0 && !query ? (
          <div className="lp-empty" data-testid="assets-tidy-empty">
            <p className="lp-empty-t">
              {tidy.checking ? 'Checking older versions…' : 'Nothing to tidy.'}
            </p>
            {tidy.checking ? null : (
              <p className="lp-empty-b">
                Every picture is on a canvas, or an older version still needs it.
              </p>
            )}
          </div>
        ) : shown.length === 0 ? (
          <div className="lp-empty" data-testid="assets-nohits">
            <p className="lp-empty-t">Nothing called “{query}”.</p>
            <p className="lp-empty-b">Try another word — search reads names and tags.</p>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.kind} aria-label={g.title}>
              <p className="lp-group">
                {g.kind === 'added' || g.kind === 'generated' ? (
                  <span className="lp-group-s" data-testid={`assets-group-${g.kind}`}>
                    <span>{g.title}</span>
                    <span className="lp-count">{g.items.length}</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="lp-group-b"
                    data-testid={`assets-group-${g.kind}`}
                    aria-label={`${g.title}, ${g.items.length}. Browse`}
                    onClick={() => openBrowse(g.kind)}
                  >
                    <span>{g.title}</span>
                    <span className="lp-count">
                      {g.items.length}
                      <StIcon name="chevron" size={11} />
                    </span>
                  </button>
                )}
              </p>
              {g.runs ? (
                // one block per generation run: what was asked for, then its takes in the order they were made
                g.runs.map((r) => (
                  <div
                    key={r.group}
                    className="lp-run"
                    data-testid="assets-gen-run"
                    data-group={r.group}
                  >
                    <p className="lp-run-t" title={r.prompt}>
                      <span className="lp-run-p">{runTitle(r)}</span>
                      <span className="lp-run-m">{runMeta(r)}</span>
                    </p>
                    <div className="lp-grid">{r.items.map(renderTile)}</div>
                  </div>
                ))
              ) : (
                <div className="lp-grid">{g.items.map(renderTile)}</div>
              )}
            </section>
          ))
        )}
        {readOnly ? null : (
          // S3.15 (04 md-edit-image): the row under the photos — the same picker and upload as "Add files…"
          <button
            type="button"
            className="lp-mac"
            data-testid="assets-from-mac"
            disabled={busy}
            onClick={addAndPlace}
          >
            <StIcon name="folder" size={14} />
            <span>From this Mac…</span>
          </button>
        )}
      </div>
      {notUsedOnly && hasUsage ? (
        <TidyFoot
          model={tidyShown}
          canTrash={!readOnly}
          busy={false}
          onAsk={() =>
            setConfirm({ paths: tidyShown.list.map((a) => a.path), bytes: tidyShown.bytes })
          }
        />
      ) : query && assets ? (
        <p className="lp-foot">Searched {assets.length} assets — names and tags</p>
      ) : null}
      {browse && assets ? (
        <BrowseView
          view={browse}
          assets={assets}
          url={url}
          readOnly={readOnly}
          placeLabel={placeLabel}
          canPlace={!!placeTarget}
          box={box}
          note={note}
          onChange={patchBrowse}
          onPick={onBrowsePick}
          onMenu={openMenu}
          onBack={() => setBrowse(null)}
          onClear={() => patchBrowse({ ...NOTHING_PICKED })}
          onPlace={(paths) => void placeMany(paths)}
          onKeyDown={onBrowseKey}
        />
      ) : null}
      {confirm ? (
        <ConfirmTrash
          count={confirm.paths.length}
          bytes={confirm.bytes}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const paths = confirm.paths;
            setConfirm(null);
            void trashPaths(paths);
          }}
        />
      ) : null}
      <AssetTileMenu state={menu} items={menuItems} onSelect={onMenuSelect} onClose={closeMenu} />
    </div>
  );
}
