// client/v2/settings/advanced-section.jsx — V2-4.7a: Settings › Advanced (06 ad-settings).
//
// About this Mac and this project, in plain words with the exact value in mono beside them: the
// version and the staged update, the server build, where keys are kept, Claude Code's setup and
// copy-paste commands, the transcription / keyframe engines and their models, and this project's
// sync switches. The model and engine cards are today's (panels/SettingsPanel.jsx) — kept mounted
// once opened so a model download's poll survives a section switch.
//
// S11.13 (06 ad-settings): Runtime and Plugins from GET /_api/settings/about; Use my own plugin copy and
// AI reviews argue it out (advanced-prefs.js, read at the next AI session); Decision memory from
// GET /_api/kg/summary ("N decisions · kgai" or "Not set up"); Logs in bug reports; and Reset (reset-
// section.jsx). C34: no row for usage data or "Faster canvas engine" — a feature Maude lacks has no switch.
//
// Desktop only (`cloud === null`) — see connections-section.jsx.

import { useEffect, useState } from 'react';

import {
  checkForUpdates,
  getClaudeAutoSetup,
  isNativeApp,
  restartToUpdate,
  setClaudeAutoSetup,
} from '../../github.js';
import {
  CopyCommand,
  GemmaModelCard,
  KeyframeEngineCard,
  TranscriptionEngineCard,
  WhisperModelCard,
} from '../../panels/SettingsPanel.jsx';
import { MDCC_VERSION } from '../../shell/constants.js';
import { Group, Row, SwitchRow } from './parts.jsx';
import ProjectSyncSettings from './project-sync-settings.jsx';
import ResetSection from './reset-section.jsx';
import {
  decisionMemoryLine,
  EXPERIMENTAL_TEAMS_PREF,
  OWN_PLUGIN_COPY_PREF,
  pluginsLine,
  REPORT_LOGS_CHOICES,
  REPORT_LOGS_PREF,
  runtimeLine,
} from './settings-model.js';
import { advancedPrefs, useAdvancedPrefs } from './use-advanced-prefs.js';

/** The commands the sheet hands over to paste into a terminal or the AI chat. */
export const COMMANDS = Object.freeze({
  install: 'npm i -g @1agh/maude',
  // The shell can't invoke Claude — it hands over the command to paste (palette `ai.draw-mark` does the same).
  draw: '/design:draw ',
  brand: '/design:setup-ds --from-brand ',
});

/**
 * Update: the staged build and the two answers the banner gives (Restart now · Later), plus — in the
 * desktop app only — Check for updates, the native menu's own check (V2-4.7c). A browser tab on the
 * desktop server has no updater, so the button is absent there, not disabled.
 */
function UpdateRow({ update, onLater }) {
  const [restarting, setRestarting] = useState(false);
  const [checking, setChecking] = useState(false);
  const native = isNativeApp();
  const staged = !!update;
  return (
    <Row
      label="Update"
      hint={staged ? undefined : 'Maude checks in the background and stages a new build.'}
      testid="settings-update"
    >
      <span className="v2s-inline">
        <span>
          {staged
            ? update.version
              ? `${update.version} is ready`
              : 'An update is ready'
            : 'Up to date'}
        </span>
        <button
          type="button"
          className="btn btn--sm"
          disabled={!staged || restarting}
          onClick={() => {
            setRestarting(true);
            restartToUpdate().catch(() => setRestarting(false));
          }}
          data-testid="settings-update-restart"
        >
          {restarting ? 'Restarting…' : 'Restart now'}
        </button>
        {native && !staged && (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={checking}
            onClick={() => {
              // The answer comes as a native dialog (or the update banner); the button only
              // says it asked. The shell ignores a second ask within a few seconds.
              setChecking(true);
              checkForUpdates()
                .catch(() => {})
                .finally(() => setTimeout(() => setChecking(false), 3000));
            }}
            data-testid="settings-check-updates"
          >
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
        )}
        {staged && (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => onLater?.()}
            data-testid="settings-update-later"
          >
            Later
          </button>
        )}
      </span>
    </Row>
  );
}

/** DDR-166 Decision 5 — offer to install Claude Code and sign in. DEFAULT ON; native-only (a Tauri pref). */
function AutoSetupRow() {
  const native = isNativeApp();
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!native) return undefined;
    let alive = true;
    getClaudeAutoSetup()
      .then((v) => alive && setOn(v !== false))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [native]);
  return (
    <SwitchRow
      testid="settings-claude-autosetup"
      label="Install and sign in automatically"
      note={
        native
          ? 'Offer to install Claude Code and sign in for you. Off shows only the copy-paste command — takes effect next launch or project switch.'
          : 'Needs the Maude desktop app.'
      }
      checked={native && on}
      disabled={!native}
      onChange={(next) => {
        setOn(next);
        setClaudeAutoSetup(next).catch(() => setOn(!next));
      }}
    />
  );
}

/** One GET of a read-only route, `null` until it answers (and when it never does). */
function useRead(url) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setData(j))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);
  return data;
}

export default function AdvancedSection({ update, onUpdateLater, live }) {
  // The engine cards stay mounted once opened: a model download polls from inside them.
  const port = typeof location !== 'undefined' ? location.port : '';
  const prefs = useAdvancedPrefs();
  const about = useRead('/_api/settings/about');
  const kg = useRead('/_api/kg/summary');
  return (
    <>
      <Group title="This Mac">
        <Row label="Version" mono testid="settings-app-version">
          {MDCC_VERSION}
        </Row>
        <UpdateRow update={update} onLater={onUpdateLater} />
        {/* C34: display only — a port you can edit is a port that fights the proxy. */}
        <Row label="Local server port" mono testid="settings-server-port">
          {port || '—'}
        </Row>
        <Row label="Runtime" mono testid="settings-runtime">
          {runtimeLine(about)}
        </Row>
        <Row label="Server build" mono testid="settings-server-build">
          MAUDE-DEV-SRV
        </Row>
        <Row
          label="Keys are kept in"
          hint="Or ~/.config/maude/keys.json (private to you) when the Keychain is off. An update you skip installs when you next quit."
          mono
          testid="settings-keys-store"
        >
          macOS Keychain
        </Row>
      </Group>

      <Group title="Claude Code">
        <Row label="Plugins" mono testid="settings-plugins">
          {pluginsLine(about) ?? 'From your own install'}
        </Row>
        <SwitchRow
          testid="settings-own-plugin-copy"
          label="Use my own plugin copy"
          note="Load the plugins you installed yourself instead of the ones Maude brings. Takes effect when the AI chat next starts."
          checked={prefs[OWN_PLUGIN_COPY_PREF]}
          onChange={(on) => advancedPrefs.set(OWN_PLUGIN_COPY_PREF, on)}
        />
        <AutoSetupRow />
        <Row label="maude in the terminal">
          <CopyCommand command={COMMANDS.install} label="Copy the install command" />
        </Row>
        <Row label="Draw a mark with the SVG agent" testid="settings-copy-draw">
          <CopyCommand command={COMMANDS.draw} label="Copy the draw command" />
        </Row>
        <Row label="Import a brand from the terminal" testid="settings-copy-brand">
          <CopyCommand command={COMMANDS.brand} label="Copy the brand import command" />
        </Row>
      </Group>

      {/* C34: the count is the graph's own, or "Not set up". No switch: nothing in Maude turns it off. */}
      <Group title="Decision memory">
        <Row
          label="In this project"
          hint="Design decisions are kept with the project, so the AI remembers why."
          mono
          testid="settings-decision-memory"
        >
          {decisionMemoryLine(kg)}
        </Row>
      </Group>

      <Group title="Engines — Auto picks for you">
        <div data-testid="settings-transcription">
          <TranscriptionEngineCard />
          <WhisperModelCard />
        </div>
        <div data-testid="settings-keyframes">
          <KeyframeEngineCard />
          <GemmaModelCard />
        </div>
        <p className="v2s-hint">
          Without a model, Auto uses ElevenLabs or Groq for subtitles and ffmpeg scene cuts for
          keyframes.
        </p>
      </Group>

      <Group title="Privacy">
        <label className="v2s-row" data-testid="settings-report-logs">
          <span className="v2s-row-t">
            <span className="v2s-row-k">Logs in bug reports</span>
            <span className="v2s-hint">
              Whether a report carries the last lines of Maude’s log. You see them before anything
              is sent.
            </span>
          </span>
          <select
            className="v2s-select"
            data-testid="settings-report-logs-select"
            value={prefs[REPORT_LOGS_PREF]}
            onChange={(e) => advancedPrefs.set(REPORT_LOGS_PREF, e.target.value)}
          >
            {REPORT_LOGS_CHOICES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </Group>

      <Group title="This project" testid="settings-this-project">
        <ProjectSyncSettings cloud={null} />
      </Group>

      <Group title="Experimental">
        <SwitchRow
          testid="settings-experimental-teams"
          label="AI reviews argue it out (teams)"
          note="Reviews are argued out by several AI seats that answer each other. Costs more. Takes effect when the AI chat next starts."
          checked={prefs[EXPERIMENTAL_TEAMS_PREF]}
          onChange={(on) => advancedPrefs.set(EXPERIMENTAL_TEAMS_PREF, on)}
        />
      </Group>

      <ResetSection live={live} />
    </>
  );
}
