// client/v2/settings/advanced-section.jsx — V2-4.7a: Settings › Advanced (06 ad-settings).
//
// About this Mac, in plain words with the exact value in mono beside them: the version and the staged
// update, the server build, where keys are kept, Claude Code's setup and copy-paste commands, the
// transcription / keyframe engines and their models. The model and engine cards are today's
// (panels/SettingsPanel.jsx) — kept mounted while their card is closed, so a model download's poll
// survives a fold or a section switch.
//
// S11.13 (06 ad-settings): Runtime and Plugins from GET /_api/settings/about; Use my own plugin copy and
// AI reviews argue it out (advanced-prefs.js, read at the next AI session); Decision memory from
// GET /_api/kg/summary ("N decisions · kgai" or "Not set up"); Logs in bug reports; and Reset (reset-
// section.jsx). C34: no row for usage data or "Faster canvas engine" — a feature Maude lacks has no switch.
//
// 2.1.1 T6 (canvas 17 · 11): one column of cards — Generation spend · This Mac · Claude Code · Decision
// memory · Engines · Privacy · Experimental, then Reset — each closed card saying what is set, so most
// visits end without opening anything. This project left Advanced: its switches are under General ›
// This project › Sync details.
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
import { Row, SwitchRow } from './parts.jsx';
import ResetSection from './reset-section.jsx';
import { SettingsCard } from './settings-card.jsx';
import {
  claudeCodeSummary,
  enginesSummary,
  experimentalSummary,
  privacySummary,
  spendSummary,
  thisMacSummary,
} from './settings-cards.js';
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
import { useOpenCard } from './use-open-card.js';

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
      hint={staged ? undefined : 'Checks in the background and stages a new build.'}
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
        {staged && (
          <button
            type="button"
            className="btn btn--sm"
            disabled={restarting}
            onClick={() => {
              setRestarting(true);
              restartToUpdate().catch(() => setRestarting(false));
            }}
            data-testid="settings-update-restart"
          >
            {restarting ? 'Restarting…' : 'Restart now'}
          </button>
        )}
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
function useAutoSetup() {
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
  const set = (next) => {
    setOn(next);
    setClaudeAutoSetup(next).catch(() => setOn(!next));
  };
  return { native, on: native && on, set };
}

function AutoSetupRow({ auto }) {
  return (
    <SwitchRow
      testid="settings-claude-autosetup"
      label="Install and sign in automatically"
      note={
        auto.native
          ? 'Offer to install Claude Code and sign in for you. Off shows only the copy-paste command — takes effect next launch or project switch.'
          : 'Needs the Maude desktop app.'
      }
      checked={auto.on}
      disabled={!auto.native}
      onChange={auto.set}
    />
  );
}

/** Paid generation spend limits (generation/spend.ts): per Mac, bounded by the server. */
const SPEND_FIELDS = [
  {
    key: 'perRun',
    label: 'Stop after, per session',
    hint: 'The most this project tab may spend on generating pictures, sound and video before it stops.',
    min: 0.1,
    max: 100,
    def: 2,
  },
  {
    key: 'perDay',
    label: 'Stop after, per day',
    hint: 'The most this project may spend in one day, across sessions.',
    min: 0.1,
    max: 500,
    def: 10,
  },
  {
    key: 'confirmOver',
    label: 'Ask me before a job over',
    hint: 'A single job estimated above this waits for your OK in Maude. 0 asks every time.',
    min: 0,
    max: 50,
    def: 1,
  },
];

function useSpendLimits() {
  const [vals, setVals] = useState(() =>
    Object.fromEntries(SPEND_FIELDS.map((f) => [f.key, f.def]))
  );
  // what is saved — the closed card says this, never a half-typed value
  const [saved, setSaved] = useState(vals);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    let alive = true;
    fetch('/_api/ui-prefs')
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        const g = p && typeof p.generateSpend === 'object' ? p.generateSpend : null;
        if (!alive || !g) return;
        const next = {};
        for (const f of SPEND_FIELDS)
          if (typeof g[f.key] === 'number' && g[f.key] >= f.min && g[f.key] <= f.max)
            next[f.key] = g[f.key];
        setVals((v) => ({ ...v, ...next }));
        setSaved((v) => ({ ...v, ...next }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const save = (f, raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < f.min || n > f.max) {
      setProblem(`${f.label}: use a number from $${f.min} to $${f.max}.`);
      return;
    }
    setProblem('');
    setVals((v) => ({ ...v, [f.key]: n }));
    fetch('/_api/ui-prefs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ generateSpend: { [f.key]: n } }),
    })
      .then((r) => {
        if (!r.ok) throw new Error('refused');
        setSaved((v) => ({ ...v, [f.key]: n }));
      })
      .catch(() => setProblem('That limit was not saved. Nothing changed.'));
  };
  return { vals, setVals, saved, save, problem };
}

function SpendRows({ spend }) {
  const { vals, setVals, save, problem } = spend;
  return (
    <div data-testid="settings-generate-spend">
      {SPEND_FIELDS.map((f) => (
        <label className="v2s-row" key={f.key} data-testid={`settings-generate-spend-${f.key}`}>
          <span className="v2s-row-t">
            <span className="v2s-row-k">{f.label}</span>
            <span className="v2s-hint">{f.hint}</span>
          </span>
          <span className="v2s-inline">
            <span aria-hidden="true">$</span>
            <input
              type="number"
              className="v2s-select"
              min={f.min}
              max={f.max}
              step="0.5"
              style={{ width: '5.5em' }}
              aria-label={f.label}
              value={vals[f.key]}
              onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
              onBlur={(e) => save(f, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </span>
        </label>
      ))}
      {problem && (
        <p className="v2s-hint" role="alert" data-testid="settings-generate-spend-problem">
          {problem}
        </p>
      )}
    </div>
  );
}

/** One GET of a read-only route, `null` until it answers (and when it never does). `key` reads it again. */
function useRead(url, key = 0) {
  const [data, setData] = useState(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the re-read ask
  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setData(j))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url, key]);
  return data;
}

export default function AdvancedSection({ update, onUpdateLater, live, focus = null }) {
  const port = typeof location !== 'undefined' ? location.port : '';
  const prefs = useAdvancedPrefs();
  const about = useRead('/_api/settings/about');
  const kg = useRead('/_api/kg/summary');
  const auto = useAutoSetup();
  const spend = useSpendLimits();
  const { open, toggle } = useOpenCard('advanced', focus);
  // the engine cards save on their own: the closed card re-reads what they saved each time it closes
  const engines = useRead('/_api/generate/prefs', open === 'engines' ? 1 : 0);
  const plugins = pluginsLine(about);
  const card = (id) => ({ open: open === id, onToggle: toggle, reveal: focus?.card === id });

  return (
    <div className="v2s-cards" data-testid="settings-advanced-cards">
      <SettingsCard
        id="spend"
        icon="spark"
        title="Generation spend"
        desc="Limits for AI pictures, video and voice."
        summary={spendSummary(spend.saved)}
        {...card('spend')}
      >
        <SpendRows spend={spend} />
      </SettingsCard>

      <SettingsCard
        id="this-mac"
        testid="settings-this-mac"
        icon="laptop"
        title="This Mac"
        desc="Version, updates, the local server."
        summary={thisMacSummary({ version: MDCC_VERSION, port, update })}
        {...card('this-mac')}
      >
        <div className="v2s-card-cols">
          <div>
            <Row label="Version" mono testid="settings-app-version">
              {MDCC_VERSION}
            </Row>
            <UpdateRow update={update} onLater={onUpdateLater} />
            {/* C34: display only — a port you can edit is a port that fights the proxy. */}
            <Row label="Local server port" mono testid="settings-server-port">
              {port || '—'}
            </Row>
          </div>
          <div>
            <Row label="Runtime" mono testid="settings-runtime">
              {runtimeLine(about)}
            </Row>
            <Row
              label="Keys are kept in"
              hint="Or ~/.config/maude/keys.json (private to you) when the Keychain is off. An update you skip installs when you next quit."
              mono
              testid="settings-keys-store"
            >
              macOS Keychain
            </Row>
            <Row label="Server build" mono testid="settings-server-build">
              maude-dev-srv
            </Row>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        id="claude-code"
        icon="code"
        title="Claude Code"
        desc="The plugins Maude’s AI runs with."
        summary={claudeCodeSummary({
          plugins,
          ownCopy: prefs[OWN_PLUGIN_COPY_PREF],
          autoSetup: auto.native ? auto.on : true,
        })}
        {...card('claude-code')}
      >
        <Row label="Plugins" mono testid="settings-plugins">
          {plugins ?? 'From your own install'}
        </Row>
        <SwitchRow
          testid="settings-own-plugin-copy"
          label="Use my own plugin copy"
          note="Load the plugins you installed yourself instead of the ones Maude brings. Takes effect when the AI chat next starts."
          checked={prefs[OWN_PLUGIN_COPY_PREF]}
          onChange={(on) => advancedPrefs.set(OWN_PLUGIN_COPY_PREF, on)}
        />
        <AutoSetupRow auto={auto} />
        <Row label="maude in the terminal">
          <CopyCommand
            ghost
            command={COMMANDS.install}
            label="Copy the install command"
            text="Copy install command"
          />
        </Row>
        <Row label="Draw a mark with the SVG agent" testid="settings-copy-draw">
          <CopyCommand ghost command={COMMANDS.draw} label="Copy the draw command" />
        </Row>
        <Row label="Import a brand from the terminal" testid="settings-copy-brand">
          <CopyCommand ghost command={COMMANDS.brand} label="Copy the brand import command" />
        </Row>
      </SettingsCard>

      {/* C34: the count is the graph's own, or "Not set up". No switch: nothing in Maude turns it off. */}
      <SettingsCard
        id="decision-memory"
        icon="history"
        title="Decision memory"
        desc="Remembers why things are the way they are."
        summary={decisionMemoryLine(kg)}
        {...card('decision-memory')}
      >
        <Row
          label="In this project"
          hint="Design decisions are kept with the project, so AI remembers why."
          mono
          testid="settings-decision-memory"
        >
          {decisionMemoryLine(kg)}
        </Row>
      </SettingsCard>

      <SettingsCard
        id="engines"
        icon="sliders"
        title="Engines"
        desc="Subtitles and video keyframes."
        summary={enginesSummary(engines)}
        {...card('engines')}
      >
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
      </SettingsCard>

      <SettingsCard
        id="privacy"
        icon="lock"
        title="Privacy"
        desc="What leaves this Mac besides your work."
        summary={privacySummary(prefs[REPORT_LOGS_PREF])}
        {...card('privacy')}
      >
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
      </SettingsCard>

      <SettingsCard
        id="experimental"
        icon="sparkle"
        title="Experimental"
        desc="Previews of what comes next."
        summary={experimentalSummary(prefs[EXPERIMENTAL_TEAMS_PREF])}
        {...card('experimental')}
      >
        <SwitchRow
          testid="settings-experimental-teams"
          label="AI reviews argue it out (teams)"
          note="Reviews are argued out by several AI seats that answer each other. Costs more. Takes effect when the AI chat next starts."
          checked={prefs[EXPERIMENTAL_TEAMS_PREF]}
          onChange={(on) => advancedPrefs.set(EXPERIMENTAL_TEAMS_PREF, on)}
        />
      </SettingsCard>

      <SettingsCard
        id="reset"
        icon="reload"
        title="Reset"
        desc="Panels, Advanced sections, every setting."
        summary="Keys and sign-ins are never reset"
        {...card('reset')}
      >
        <ResetSection live={live} bare />
      </SettingsCard>
    </div>
  );
}
