// client/v2/settings/general-section.jsx — V2-4.7a: Settings › General (02 ob-settings, left card).
//
// Account · Look · Canvas and view · Panels. Everything here is a preference of the person, in every
// shell. The controls are today's (panels/SettingsPanel.jsx): the theme and Inspector-words radios,
// the four canvas switches, the left/right panel positions and the Layers mode — same props, same
// handlers, same stores. Nothing is stored differently.

import { useEffect, useState } from 'react';

import { CLOUD_CHANGED_EVENT, openExternal } from '../../panels/CloudBar.jsx';
import { AppearanceTab, LayoutTab, PrefToggleRow } from '../../panels/SettingsPanel.jsx';
import { useSingleKeys } from '../shell/use-single-keys.js';
import { Group, Row } from './parts.jsx';

/** The cloud account of THIS Mac (desktop only): `{ connected, email, url }`, kept current. */
function useCloudAccount(enabled) {
  const [acct, setAcct] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let gone = false;
    const read = () =>
      fetch('/_api/cloud/status')
        .then((r) => r.json().catch(() => ({})))
        .then((j) => {
          if (!gone)
            setAcct({ connected: !!j?.connected, email: j?.email ?? null, url: j?.url ?? null });
        })
        .catch(() => {
          if (!gone) setAcct({ connected: false, email: null, url: null });
        });
    read();
    window.addEventListener(CLOUD_CHANGED_EVENT, read);
    return () => {
      gone = true;
      window.removeEventListener(CLOUD_CHANGED_EVENT, read);
    };
  }, [enabled]);
  return acct;
}

export default function GeneralSection({
  cloud,
  readOnly = false,
  theme,
  onSetTheme,
  cpMode,
  onSetCpMode,
  minimapVisible,
  onToggleMinimap,
  zoomCtlVisible,
  onToggleZoomCtl,
  annotationsVisible,
  onToggleAnnotations,
  autoOpenInspector,
  onToggleAutoOpenInspector,
  hasCanvas = false,
  panelSide,
  onSetPanelSide,
  layersMode,
  onSetLayersMode,
}) {
  // The Mac's own cloud account is the owner's business: a read-only link asks for none of it (V2-4.9).
  const ownAccount = cloud === null && !readOnly;
  const acct = useCloudAccount(ownAccount);
  // The dashboard this person manages their account on: the cloud tab was configured with one; the
  // desktop asks the server for the address it signs in against. Never a hard-coded vendor URL.
  const dashboardUrl =
    cloud === null ? (ownAccount ? acct?.url : null) : (cloud?.dashboardUrl ?? null);
  const canvasReason = !hasCanvas ? 'Open a canvas to use this.' : undefined;
  const [singleKeys, setSingleKeys] = useSingleKeys();

  return (
    <>
      {dashboardUrl && (
        <Group title="Account" testid="settings-account">
          {ownAccount && (
            <Row
              label="Maude Cloud"
              hint={acct?.connected ? undefined : 'Sign in under Connections to sync projects.'}
            >
              {acct?.connected ? `Signed in as ${acct.email ?? 'your account'}` : 'Not signed in'}
            </Row>
          )}
          <Row label="Your account on the web" hint="People, billing, your Macs and downloads.">
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => openExternal(dashboardUrl)}
              data-testid="settings-open-dashboard"
            >
              Open the cloud dashboard
            </button>
          </Row>
        </Group>
      )}

      <Group title="Look">
        <AppearanceTab
          theme={theme}
          onSetTheme={onSetTheme}
          cpMode={cpMode}
          onSetCpMode={onSetCpMode}
        />
      </Group>

      <Group title="Canvas and view" testid="settings-canvas-view">
        <PrefToggleRow
          label="Minimap"
          note="Show the canvas minimap overlay."
          checked={minimapVisible}
          disabled={!hasCanvas}
          reason={canvasReason}
          onChange={() => onToggleMinimap?.()}
        />
        <PrefToggleRow
          label="Zoom controls"
          note="Show the floating zoom controls on the canvas."
          checked={zoomCtlVisible}
          disabled={!hasCanvas}
          reason={canvasReason}
          onChange={() => onToggleZoomCtl?.()}
        />
        <PrefToggleRow
          label="Annotations"
          note="Show annotation pins and overlays on the canvas."
          checked={annotationsVisible}
          onChange={() => onToggleAnnotations?.()}
        />
        <PrefToggleRow
          label="Auto-open Inspector on select"
          note="Open the Inspector automatically when you select an element."
          checked={autoOpenInspector}
          onChange={() => onToggleAutoOpenInspector?.()}
        />
      </Group>

      <Group title="Keyboard" testid="settings-keyboard">
        <div data-testid="settings-single-keys">
          <PrefToggleRow
            label="Single-key shortcuts"
            note="Keys without ⌘ or ⌥ pick tools and open things: V, H, N, /, ?. Off, only shortcuts with ⌘ or ⌥ work."
            checked={singleKeys}
            onChange={(on) => setSingleKeys(on)}
          />
        </div>
      </Group>

      <Group title="Layout" testid="settings-layout">
        <LayoutTab
          panelSide={panelSide}
          onSetPanelSide={onSetPanelSide}
          layersMode={layersMode}
          onSetLayersMode={onSetLayersMode}
        />
      </Group>
    </>
  );
}
