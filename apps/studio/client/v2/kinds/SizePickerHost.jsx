// client/v2/kinds/SizePickerHost.jsx — S7.20: the F size picker wired to today's shell.
//
// Always mounted (one line in app.jsx): it draws <SizePicker> while `req` is set (`tool-panel-open {panel:'sizes'}`,
// use-tool-panels.js) and, picker or not, hears the canvas's `size-place` — the pick went through — to put the size at
// the front of Recent (`recentSizes` in prefs.json, per Mac). The canvas is the writer: the picker's click only asks
// it (`run-action artboard.insert-preset`), and a refused write never reaches Recent.

import { useEffect, useRef } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { pushRecent } from '../../../kinds/presets.ts';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { persistUiPrefs } from '../../shell/util.js';
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

export default function SizePickerHost({ req, onClose }) {
  const {
    shellCore: { activePath, cfg, iframesRef, viewerMode, postToActiveCanvas },
  } = useShellStore();
  const live = useRef({});
  live.current = { activePath, cfg, iframesRef };

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
