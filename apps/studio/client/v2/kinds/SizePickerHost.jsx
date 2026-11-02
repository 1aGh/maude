// client/v2/kinds/SizePickerHost.jsx — S7.20: the F size picker wired to today's shell.
//
// Always mounted (one line in app.jsx): it draws <SizePicker> while `req` is set (`tool-panel-open {panel:'sizes'}`,
// use-tool-panels.js) and, picker or not, hears the canvas's `size-place` — the pick went through — to put the size at
// the front of Recent (`recentSizes` in prefs.json, per Mac). The canvas is the writer: the picker's click only asks
// it (`run-action artboard.insert-preset`), and a refused write never reaches Recent.

import { useEffect, useRef } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { pushRecent } from '../../../kinds/presets.ts';
import { OPEN_SIZES_EVENT, takeSizePicker } from '../create/open-sizes.js';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { persistUiPrefs } from '../../shell/util.js';
import { shellMode } from '../shell/use-canvas-mode-lane.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import KindDimHost from './KindDimHost.jsx';
import SizePicker from './SizePicker.jsx';

/** The new Recent list after a pick, given the stored one. */
export async function rememberSize(presetId, { fetchImpl = fetch, persist = persistUiPrefs } = {}) {
  let stored = [];
  try {
    const r = await fetchImpl('/_api/ui-prefs');
    const prefs = await r.json();
    stored = Array.isArray(prefs?.recentSizes) ? prefs.recentSizes : [];
  } catch {
    /* offline: the pick still goes to the front of an empty list */
  }
  const next = pushRecent(stored, presetId);
  persist({ recentSizes: next });
  return next;
}

/**
 * The picker is the F tool's panel, and F is an Edit tool: when the mode leaves Edit (Preview, Present, a held
 * past version) the toolbar changes, and Michal's TD1d says the toolbar is what a mode switch changes — so the
 * panel goes with its tool. Without this the picker stayed up over Preview (a preset click there still drew an
 * artboard, and Preview's "esc to edit" only closed the picker). Returns the unsubscribe.
 */
export function watchSizePickerMode(store, onClose) {
  const leftEdit = (s) => s.mode !== 'edit' || !!s.present || !!s.viewing;
  return store.subscribe(() => {
    if (leftEdit(store.get())) onClose?.();
  });
}

export default function SizePickerHost({ req, onOpen, onClose }) {
  const {
    shellCore: { activePath, cfg, iframesRef, viewerMode, postToActiveCanvas },
  } = useShellStore();
  const live = useRef({});
  live.current = { activePath, cfg, iframesRef, onClose };

  // R2-P2 (TD2): a canvas the person has just made opens with this picker up (open-sizes.js). The request waits
  // for its canvas to be the open one; the picker is then drawn centred (no toolbar anchor yet).
  useEffect(() => {
    const take = () => {
      const canvas = takeSizePicker(live.current.activePath);
      if (canvas) onOpen?.({ canvas, anchor: null });
    };
    take();
    window.addEventListener(OPEN_SIZES_EVENT, take);
    return () => window.removeEventListener(OPEN_SIZES_EVENT, take);
  }, [onOpen, activePath]);

  // the picker goes when the mode leaves Edit (watchSizePickerMode)
  const open = !!req;
  useEffect(() => {
    if (!open) return undefined;
    return watchSizePickerMode(shellMode, () => live.current.onClose?.());
  }, [open]);

  useEffect(() => {
    const onMessage = (e) => {
      if (e?.data?.dgn !== 'size-place') return;
      const { activePath: p, cfg: c, iframesRef: refs } = live.current;
      const win = p && p !== SYSTEM_TAB ? (refs?.current?.get(p)?.contentWindow ?? null) : null;
      const m = acceptFromCanvas(e, {
        canvasOrigin: c?.canvasOrigin || window.location.origin,
        active: win,
      });
      if (m?.dgn === 'size-place') void rememberSize(m.presetId);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <>
      {/* S7.24b — the kind filter dims the artboards outside the kind on every open canvas (draws nothing here) */}
      <KindDimHost designRel={cfg?.designRel || cfg?.designRoot || ''} />
      {req ? (
        <SizePicker
          canvas={req.canvas}
          anchor={req.anchor ?? null}
          canEdit={!viewerMode}
          onGhost={(msg) => postToActiveCanvas?.(msg)}
          onPlace={(msg) => postToActiveCanvas?.(msg)}
          onClose={onClose}
        />
      ) : null}
    </>
  );
}
