// client/v2/ds/switch-host.jsx — S10.14: the shell's side of "Switch canvases to …?" and "Preview in …".
//
// The sheet (switch-sheet.jsx) and the bar (preview-bar.jsx) only draw. This host fetches what they draw (the review
// for a scope and a target), does the one write (`POST /_api/ds/switch`, one action, one ⌘Z) and says the outcome in
// words. It is mounted once in the shell (inside the DS review host); registry actions reach it through
// switch-bus.js. Nothing is trusted from the page: the server judges every canvas, tick and system again.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPaletteEnv } from '../search/search-env.js';
import { DsPreviewBar } from './preview-bar.jsx';
import { beginDsPreview, stopDsPreview, useDsPreview } from './preview-mode.js';
import { DsSwitchSheet } from './switch-sheet.jsx';
import { onDsSwitchRequest, requestDsSwitch } from './switch-bus.js';
import { requestDsUpgrade } from './upgrade-bus.js';
import {
  defaultScope,
  refusalWords,
  restyleBrief,
  SWITCH_WORDS,
  scopeFields,
  scopeOptions,
  switchBody,
  switchedWords,
} from './switch-model.js';

const JSON_HEADERS = { 'content-type': 'application/json' };

async function call(fetchImpl, body) {
  let res;
  try {
    res = await fetchImpl('/_api/ds/switch', {
      method: 'POST',
      cache: 'no-store',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: 'unreachable', body: null };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* an unreadable answer is judged by its status */
  }
  const code = res.ok ? null : (json?.code ?? (res.status === 403 ? 'forbidden' : 'failed'));
  return { ok: res.ok, code, body: json };
}

/** The review for a scope and a target, or a reason in words. */
export async function loadSwitchReview({ to, scope }, fetchImpl = globalThis.fetch) {
  const r = await call(fetchImpl, { to, ...scope, dryRun: true });
  if (!r.ok) return { ok: false, message: refusalWords(r.code) };
  return { ok: true, review: r.body };
}

/** Switch: the ticks go to `POST /_api/ds/switch`; one action, one ⌘Z (the server records it). */
export async function runSwitch({ to, scope }, rows, fetchImpl = globalThis.fetch) {
  const r = await call(fetchImpl, switchBody({ to, scope, rows }));
  if (!r.ok) return { ok: false, message: refusalWords(r.code) };
  const result = r.body?.result;
  return {
    ok: true,
    switched: Number.isFinite(result?.switched) ? result.switched : 0,
    kept: Number.isFinite(result?.kept) ? result.kept : 0,
  };
}

const stripRoot = (p, designRel) => {
  const s = String(p ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const root = String(designRel || '.design').replace(/^\/+|\/+$/g, '');
  return s.startsWith(`${root}/`) ? s.slice(root.length + 1) : s;
};

/** The open canvas as a design-root-relative `.tsx` path outside any system's own folder, or null. */
export function openCanvasRel(activePath, cfg) {
  const rel = stripRoot(activePath, cfg?.designRel);
  return /\.tsx$/i.test(rel) && !rel.startsWith('system/') ? rel : null;
}

const folderOf = (rel) => (rel?.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

/** The system a canvas follows, read off the index's `canvasDesignSystems` (its keys may carry the design root). */
export function followedBy(rel, cfg) {
  for (const [file, name] of Object.entries(cfg?.canvasDesignSystems ?? {}))
    if (stripRoot(file, cfg?.designRel) === rel) return name;
  return null;
}

/** How many canvases follow system `ds` — what "shown in it" counts. */
export function canvasesIn(ds, cfg) {
  return Object.entries(cfg?.canvasDesignSystems ?? {}).filter(
    ([file, name]) =>
      name === ds && /\.tsx$/i.test(file) && !stripRoot(file, cfg?.designRel).startsWith('system/')
  ).length;
}

/**
 * @param {{ cfg: any, activePath: string | null, toast?: (m: string) => void, fetchImpl?: typeof fetch }} props
 */
export function DsSwitchHost({ cfg, activePath, toast, fetchImpl }) {
  const [sheet, setSheet] = useState(null);
  const session = useDsPreview();
  const live = useRef({ cfg, activePath, toast, fetchImpl, sheet: null, session: null });
  live.current = { cfg, activePath, toast, fetchImpl, sheet, session };
  const say = (m) => live.current.toast?.(m);
  const f = () => live.current.fetchImpl ?? globalThis.fetch;

  const systems = () => (live.current.cfg?.designSystems ?? []).filter((d) => d?.name);
  const labelOf = useCallback(
    (name) => {
      const d = (cfg?.designSystems ?? []).find((x) => x.name === name);
      return String(d?.label || name || '');
    },
    [cfg?.designSystems]
  );

  /** Ask the server for a review and open (or refresh) the sheet on it. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `say` and `f` read the live ref
  const open = useCallback(async (ask) => {
    const { to, kind, canvas, folder, quiet } = ask;
    const scope = scopeFields(kind, { canvas, folder });
    const loaded = await loadSwitchReview({ to, scope }, f());
    if (!loaded.ok) return quiet ? undefined : say(loaded.message);
    const movable = loaded.review.canvases.filter((c) => c.ticked).length;
    if (quiet && (loaded.review.refused || movable === 0)) return undefined;
    if (loaded.review.canvases.length === 0) return say(SWITCH_WORDS.nothing);
    setSheet({ ...ask, scope, review: loaded.review });
    return undefined;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `say`, `systems` and `live` read the live ref
  useEffect(
    () =>
      onDsSwitchRequest(async (req) => {
        const { cfg: c, activePath: at } = live.current;
        const names = systems().map((d) => d.name);
        if (names.length < 2) return say(SWITCH_WORDS.noOther);
        if (req.kind === 'preview') {
          const from = req.from && names.includes(req.from) ? req.from : names[0];
          if (!beginDsPreview({ from, systems: names })) say(SWITCH_WORDS.noOther);
          return undefined;
        }
        const canvas = openCanvasRel(at, c);
        const folder = folderOf(canvas);
        const from = req.from && names.includes(req.from) ? req.from : null;
        // no target named: the system after the row's own, in the project's order
        const to =
          req.to && names.includes(req.to)
            ? req.to
            : names[(Math.max(0, names.indexOf(from)) + 1) % names.length];
        const follows = !!canvas && followedBy(canvas, c) === from;
        const kind = req.scope ?? (follows ? defaultScope({ folder }) : 'all');
        return open({
          to,
          kind: kind === 'canvas' && !canvas ? 'all' : kind === 'folder' && !folder ? 'all' : kind,
          canvas,
          folder,
          // from a system's own menu: only that system's canvases start ticked
          fromOnly: from && kind === 'all' ? from : null,
          quiet: req.quiet === true,
        });
      }),
    [open]
  );

  // the preview ends when the sheet's switch lands (below) or the person stops it; nothing else ends it
  const close = useCallback(() => setSheet(null), []);

  const shownIn = session ? canvasesIn(session.from, cfg) : 0;
  const targets = systems().map((d) => ({ name: d.name, label: labelOf(d.name) }));

  return (
    <>
      {session ? (
        <DsPreviewBar
          session={session}
          labelOf={labelOf}
          shown={shownIn}
          blocked={!!sheet}
          onSwitch={(target) => requestDsSwitch({ to: target, from: session.from, scope: 'all' })}
        />
      ) : null}
      {sheet ? (
        <DsSwitchSheet
          key={`${sheet.to}:${sheet.kind}`}
          review={sheet.review}
          to={sheet.to}
          toLabel={labelOf(sheet.to)}
          targets={targets}
          scope={sheet.kind}
          scopes={scopeOptions({ canvas: sheet.canvas, folder: sheet.folder })}
          labelOf={labelOf}
          fromOnly={sheet.fromOnly}
          canAskAI={!!getPaletteEnv().canAskAI?.()}
          onScope={(kind) =>
            open({ ...sheet, kind, fromOnly: kind === 'all' ? sheet.fromOnly : null })
          }
          onTo={(to) => open({ ...sheet, to })}
          onClose={close}
          // S10.15b: a system made before the schema is brought up first (13 · ds-multi-schema); the switch waits
          onBringUp={(ds) => {
            close();
            requestDsUpgrade({ ds });
          }}
          onSwitch={async (rows, { restyle }) => {
            const r = await runSwitch({ to: sheet.to, scope: sheet.scope }, rows, f());
            if (!r.ok) return r;
            say(switchedWords(r.switched, r.kept, labelOf(sheet.to)));
            if (restyle) {
              // the person's own gesture: the run starts from a brief they can read in the composer
              getPaletteEnv().askAI?.(restyleBrief({ toLabel: labelOf(sheet.to), rows }), {
                send: true,
                origin: 'ds-restyle',
              });
            }
            stopDsPreview();
            setSheet(null);
            return { ok: true };
          }}
        />
      ) : null}
    </>
  );
}
