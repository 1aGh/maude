// client/v2/settings/general-section.jsx — V2-4.7a: Settings › General (02 ob-settings, left card).
//
// Account (S9.20, account.jsx) · Look · Canvas and view · Keyboard · Search (S8.20, search in pictures) · Layout. Everything here is a preference of the person, in every
// shell. The controls are today's (panels/SettingsPanel.jsx): the theme and Inspector-words radios,
// the four canvas switches, the left/right panel positions and the Layers mode — same props, same
// handlers, same stores. Nothing is stored differently.

import { AppearanceTab, LayoutTab, PrefToggleRow } from '../../panels/SettingsPanel.jsx';
import { DescribeSettingsRow } from '../assets/describe-consent.jsx';
import { getPaletteEnv } from '../search/search-env.js';
import { useSingleKeys } from '../shell/use-single-keys.js';
import { AccountBlock } from './account.jsx';
import { Group } from './parts.jsx';

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
  const canvasReason = !hasCanvas ? 'Open a canvas to use this.' : undefined;
  const [singleKeys, setSingleKeys] = useSingleKeys();

  return (
    <>
      {/* S9.20 — the Account block (02 ob-settings): plan, Manage, the five account pages */}
      <AccountBlock cloud={cloud} readOnly={readOnly} />

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

      {/* S8.20 — Search in pictures: off at once, on through the one sheet; absent where the studio does not describe */}
      {/* (not before /_config answers: `cloud === undefined` mounts and fetches nothing local) */}
      {cloud !== undefined ? (
        <DescribeSettingsRow project={getPaletteEnv().projectName} Row={PrefToggleRow} />
      ) : null}

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
