// client/v2/settings/general-section.jsx — V2-4.7a: Settings › General (02 ob-settings, left card).
//
// Account (S9.20, account.jsx) · Look (Theme: Light · Dark · Auto, gate-b-polish2) · Canvas and view · Keyboard · Search (S8.20, search in pictures) · Layout. Everything here is a preference of the person, in every
// shell. Look is 02 ob-settings' one Theme row; the Inspector words left General (06: the inspector's
// Advanced fold is the raw editor, Designer is the only default — the v2 inspector ignores the old switch).
// The rest are today's controls (panels/SettingsPanel.jsx): the four canvas switches, the left/right panel positions and the Layers mode — same props, same
// handlers, same stores. Nothing is stored differently.

import { LayoutTab, PrefToggleRow } from '../../panels/SettingsPanel.jsx';
import { DescribeSettingsRow } from '../assets/describe-consent.jsx';
import { getPaletteEnv } from '../search/search-env.js';
import { useSingleKeys } from '../shell/use-single-keys.js';
import { AccountBlock } from './account.jsx';
import { Group, Row } from './parts.jsx';
import {
  pickTheme,
  systemTheme,
  themeChoice,
  useThemeAutoOn,
  writeThemeAuto,
} from './theme-auto.js';

const THEMES = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'auto', label: 'Auto' },
];

/** Light · Dark · Auto — one segmented radio group (02 ob-settings). Auto matches the computer’s appearance. */
export function ThemeSegment({ theme, onSetTheme }) {
  const auto = useThemeAutoOn();
  const value = themeChoice(theme, auto);
  const pick = (id) => {
    const next = pickTheme(id, systemTheme());
    writeThemeAuto(next.auto);
    if (next.theme) onSetTheme?.(next.theme);
  };
  return (
    <div
      className="v2s-seg"
      role="radiogroup"
      aria-label="Theme"
      data-testid="settings-theme"
      data-value={value}
    >
      {THEMES.map((o) => (
        <label key={o.id} className="v2s-seg-b" data-on={o.id === value ? '' : undefined}>
          <input
            type="radio"
            className="v2s-seg-in"
            name="maude-theme"
            value={o.id}
            checked={o.id === value}
            onChange={() => pick(o.id)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export default function GeneralSection({
  cloud,
  readOnly = false,
  theme,
  onSetTheme,
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
  const auto = useThemeAutoOn();

  return (
    <>
      {/* S9.20 — the Account block (02 ob-settings): plan, Manage, the five account pages */}
      <AccountBlock cloud={cloud} readOnly={readOnly} />

      <Group title="Look">
        <Row label="Theme" hint={auto ? 'Matches your computer’s appearance.' : undefined}>
          <ThemeSegment theme={theme} onSetTheme={onSetTheme} />
        </Row>
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
