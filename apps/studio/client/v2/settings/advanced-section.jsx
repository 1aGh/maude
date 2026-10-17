// client/v2/settings/advanced-section.jsx — V2-4.7a: Settings › Advanced (06 ad-settings).
//
// About this Mac and this project, in plain words with the exact value in mono beside them: the
// version and the staged update, the server build, where keys are kept, Claude Code's setup and
// copy-paste commands, the transcription / keyframe engines and their models, and this project's
// sync switches. The model and engine cards are today's (panels/SettingsPanel.jsx) — kept mounted
// once opened so a model download's poll survives a section switch.
//
// Desktop only (`cloud === null`) — see connections-section.jsx.

import { useEffect, useState } from 'react';

import {
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

/** The commands the sheet hands over to paste into a terminal or the AI chat. */
export const COMMANDS = Object.freeze({
  install: 'npm i -g @1agh/maude',
  // The shell can't invoke Claude — it hands over the command to paste (palette `ai.draw-mark` does the same).
  draw: '/design:draw ',
  brand: '/design:setup-ds --from-brand ',
});

/** Update: the staged build and the two answers the banner gives (Restart now · Later). */
function UpdateRow({ update, onLater }) {
  const [restarting, setRestarting] = useState(false);
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

export default function AdvancedSection({ update, onUpdateLater }) {
  // The engine cards stay mounted once opened: a model download polls from inside them.
  const port = typeof location !== 'undefined' ? location.port : '';
  return (
    <>
      <Group title="This Mac">
        <Row label="Version" mono testid="settings-app-version">
          {MDCC_VERSION}
        </Row>
        <UpdateRow update={update} onLater={onUpdateLater} />
        {port && (
          <Row label="Local server port" mono>
            {port}
          </Row>
        )}
        <Row label="Server build" mono testid="settings-server-build">
          MAUDE-DEV-SRV
        </Row>
        <Row
          label="Keys are kept in"
          hint="Your OS keychain, or a private file (mode 0600) when the keychain is off."
          mono
          testid="settings-keys-store"
        >
          OS keychain · ~/.config/maude/keys.json
        </Row>
      </Group>

      <Group title="Claude Code">
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

      <Group title="Engines — Auto picks for you">
        <div data-testid="settings-transcription">
          <TranscriptionEngineCard />
          <WhisperModelCard />
        </div>
        <div data-testid="settings-keyframes">
          <KeyframeEngineCard />
          <GemmaModelCard />
        </div>
      </Group>

      <Group title="This project" testid="settings-this-project">
        <ProjectSyncSettings cloud={null} />
      </Group>
    </>
  );
}
