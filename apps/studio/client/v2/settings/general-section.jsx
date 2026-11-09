// client/v2/settings/general-section.jsx — V2-4.7a: Settings › General (02 ob-settings, left card).
//
// 2.1.1 T6 (canvas 17 · 08): one column of cards — This project first and open (this-project-card.jsx), then
// Look · Canvas and view · Terminal · Keyboard · Layout, each closed and saying what is set. A cloud tab has
// no This project card; its account keeps an Account card of its own (account.jsx).
//
// Look is 02 ob-settings' one Theme row (Light · Dark · Auto, gate-b-polish2); the Inspector words left
// General (06: the inspector's Advanced fold is the raw editor). Terminal (#206): may Claude Code in the
// terminal open projects in this Maude (a Tauri pref; the desktop app only). Search in pictures (S8.20)
// sits in Canvas and view. The rest are today's controls (panels/SettingsPanel.jsx): the four canvas
// switches, the left/right panel positions and the Layers mode — same props, same handlers, same stores.
// Nothing is stored differently.

import { useEffect, useState } from 'react';

import { getTerminalOpens, isNativeApp, setTerminalOpens } from '../../github.js';
import { LayoutTab, PrefToggleRow } from '../../panels/SettingsPanel.jsx';
import { DescribeSettingsRow } from '../assets/describe-consent.jsx';
import { getPaletteEnv } from '../search/search-env.js';
import { useSingleKeys } from '../shell/use-single-keys.js';
import { AccountBlock } from './account.jsx';
import { Row, SwitchRow } from './parts.jsx';
import { SettingsCard } from './settings-card.jsx';
import {
  canvasSummary,
  keyboardSummary,
  layoutSummary,
  lookSummary,
  terminalSummary,
} from './settings-cards.js';
import {
  pickTheme,
  systemTheme,
  themeChoice,
  useThemeAutoOn,
  writeThemeAuto,
} from './theme-auto.js';
import ThisProjectCard from './this-project-card.jsx';
import { useOpenCard } from './use-open-card.js';

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

/** #206 (DDR-250): a terminal design run may open projects in Maude. DEFAULT ON; the desktop app only. */
function useTerminalOpens(enabled) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    getTerminalOpens()
      .then((v) => alive && setOn(v !== false))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled]);
  const set = (next) => {
    setOn(next);
    setTerminalOpens(next).catch(() => setOn(!next));
  };
  return [on, set];
}

export default function GeneralSection({
  cloud,
  readOnly = false,
  focus = null,
  syncStatus,
  onLinkedHub,
  onLocalProject,
  onCloseSheet,
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
  // This project reads this Mac: the desktop and an owner's session only (settings-model `local`)
  const ownMac = cloud === null && !readOnly;
  const terminal = ownMac && isNativeApp();
  const [terminalOn, setTerminalOn] = useTerminalOpens(terminal);
  // a cloud tab keeps its account as a card of its own (the hub told its tab where the dashboard is)
  const accountCard = !!cloud && typeof cloud === 'object' && !!cloud.dashboardUrl;
  // ⌘K's This project row in a shell without that card is the Account card's
  const asked = focus?.card === 'this-project' && !ownMac ? { ...focus, card: 'account' } : focus;
  const { open, toggle } = useOpenCard('general', asked);
  // the default card is This project — a shell without it opens on nothing
  const openId = !ownMac && open === 'this-project' ? null : open;
  const card = (id) => ({ open: openId === id, onToggle: toggle, reveal: asked?.card === id });

  return (
    <div className="v2s-cards" data-testid="settings-general-cards">
      {ownMac ? (
        <ThisProjectCard
          {...card('this-project')}
          focus={asked}
          syncStatus={syncStatus}
          onLinkedHub={onLinkedHub}
          onLocalProject={onLocalProject}
          onCloseSheet={onCloseSheet}
        />
      ) : null}

      <SettingsCard
        id="look"
        icon="view"
        title="Look"
        desc="How Maude looks on this Mac."
        summary={lookSummary(theme, auto)}
        {...card('look')}
      >
        <Row label="Theme" hint={auto ? 'Matches your computer’s appearance.' : undefined}>
          <ThemeSegment theme={theme} onSetTheme={onSetTheme} />
        </Row>
      </SettingsCard>

      <SettingsCard
        id="canvas"
        testid="settings-canvas-view"
        icon="frame"
        title="Canvas and view"
        desc="What sits on the canvas with your work."
        summary={canvasSummary({
          minimap: minimapVisible,
          zoom: zoomCtlVisible,
          annotations: annotationsVisible,
          autoInspector: autoOpenInspector,
        })}
        {...card('canvas')}
      >
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
        {/* S8.20 — Search in pictures: off at once, on through the one sheet; absent where the studio does not
            describe (not before /_config answers: `cloud === undefined` mounts and fetches nothing local) */}
        {cloud !== undefined ? (
          <DescribeSettingsRow project={getPaletteEnv().projectName} Row={PrefToggleRow} />
        ) : null}
      </SettingsCard>

      {terminal ? (
        <SettingsCard
          id="terminal"
          testid="settings-terminal"
          icon="code"
          title="Terminal"
          desc="The maude command in your terminal."
          summary={terminalSummary(terminalOn)}
          {...card('terminal')}
        >
          <SwitchRow
            testid="settings-terminal-opens"
            label="Let the terminal open projects in Maude"
            note="Claude Code in the terminal shows its work here. A folder Maude has not opened before asks you first. Off, the terminal uses its own hidden server."
            checked={terminalOn}
            onChange={setTerminalOn}
          />
        </SettingsCard>
      ) : null}

      <SettingsCard
        id="keyboard"
        testid="settings-keyboard"
        icon="type"
        title="Keyboard"
        desc="Shortcuts on the canvas."
        summary={keyboardSummary(singleKeys)}
        {...card('keyboard')}
      >
        <div data-testid="settings-single-keys">
          <PrefToggleRow
            label="Single-key shortcuts"
            note="Keys without ⌘ or ⌥ pick tools and open things: V, H, N, /, ?. Off, only shortcuts with ⌘ or ⌥ work."
            checked={singleKeys}
            onChange={(on) => setSingleKeys(on)}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        id="layout"
        testid="settings-layout"
        icon="panel-left"
        title="Layout"
        desc="Where the panels sit."
        summary={layoutSummary(panelSide, layersMode)}
        {...card('layout')}
      >
        <LayoutTab
          panelSide={panelSide}
          onSetPanelSide={onSetPanelSide}
          layersMode={layersMode}
          onSetLayersMode={onSetLayersMode}
        />
      </SettingsCard>

      {accountCard ? (
        <SettingsCard
          id="account"
          icon="cloud"
          title="Account"
          desc="Your account on the web."
          summary={cloud.user?.email ?? null}
          {...card('account')}
        >
          <AccountBlock cloud={cloud} readOnly={readOnly} />
        </SettingsCard>
      ) : null}
    </div>
  );
}
