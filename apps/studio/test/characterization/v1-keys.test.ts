// V2-2.4 — the v1 KEY characterization (V2-1.3 contract §7 row 3). Pins today's keyboard behaviour
// before the action registry replaces the listeners, and must stay byte-identical through every
// V2-2.4 step (the pure swap; the approved deltas move to Phase 4 — Q5).
//
// DOM-driven, both documents. It boots the SOURCE dev-server against a fixed fixture, drives a real
// Chromium with real key presses (playwright), and for every (setup, focus, key) case records what
// happened — not how:
//   · which document received the keydown, and whether its default was prevented;
//   · the `{dgn}` messages that crossed the frame boundary (shell → canvas and canvas → shell);
//   · the writes the page sent (non-GET requests);
//   · the structural change of each document (a line diff of a normalised DOM snapshot, plus the
//     focused element), summarised and hashed.
// Golden: apps/studio/test/characterization/v1/keys.txt. Any diff fails with the first differing
// case. Refresh deliberately with V1_KEYS_UPDATE=1, and only in Phase 4, or for a lead-approved
// transport-only delta (lane renames with identical keydown / writes / DOM), recorded in kg
// (decision:maude/v2-2.4-golden-transport-delta — V2-2.4 step 6's `key` / `run-action` lanes).
// Approved delta (V2-2.8, decision:maude/v2-2.8-shift-cmd-e-one-sheet — V2-1.3 defect 2): ⇧⌘E with
// canvas focus no longer also runs the iframe's `rerunLast()`, so `browser/in-canvas/canvas` and
// `browser/in-canvas-text/canvas` Meta+Shift+E lose the `export-history-request` / `-result`
// messages; the keydown, the writes and the shell's Export sheet are byte-identical.
// Approved delta (V2-3.4, decision:maude/v2-3.4-cmd-n-new-canvas — Gate 0 C3 File menu): in the
// desktop shell ⌘N is New Canvas (`canvas.new`, the brief-board composer) and New Project moved to
// ⇧⌘N, so `tauri/canvas/chrome Meta+n` now prevents the default and opens the composer. No other
// case changed (two full runs on the Phase 3 gate tree).
// Approved delta (V2-4.1, decision:maude/v2-4.1-floating-panels — CONTRACT §2 "keys that moved", D17):
// bare T no longer toggles the Files panel — ⌘\ hides / shows ALL panels (`view.panels`) and T stays
// unbound until V2-4.5 binds Text, so every `shell key="t"` case is `default` (not PREVENTED) and the
// tree stays as it was. Also in this refresh, none of them a key change: (1) the shell DOM is the
// floating layout (`.st-body--float`, `.st-dockslot-inner` islands, corner icons instead of the rail);
// (2) the shell now sends the canvas `occluded-insets` (V2-1.2 §5.6) — on `loaded`, on `canvas-rendered`
// and whenever a panel opens or closes — so `to-canvas` lists gain `parent occluded-insets`; (3) with
// the left panel floating over the canvas the first Fit lands in the visible area, so the `@world
// translate` of the zoom cases moved. No write changed.
// Approved delta (V2-3.11, decision:maude/v2-3.11-browser-tab-keys — CONTRACT §2 "keys that moved",
// Michal 2026-10-15): ⌘1…⌘8 / ⌘9 are the desktop's tab accelerators and Actual size moved ⌘1 → ⇧0,
// so `browser/in-canvas/canvas Meta+1` is `default` (not PREVENTED) with no zoom, and the new
// `Shift+Digit0` canvas case (US: e.key ")") runs Actual size the way Meta+1 used to. Also: the three
// cases that open the "?" sheet hash differently (its "Fit · actual size" row reads ⇧ 0), and the
// extra case re-deals the lanes, so `Meta+Minus`'s boot `@world translate` moved. No write changed.
// Approved delta (V2-4.4a, decision:maude/v2-4.4a-left-panel-tabs — Canvases · Layers · Assets, no key moved,
// no write changed): the left panel reads Canvases (the search field is `aria-label="Filter canvases"`, was
// "Filter files"; the header loses the Refresh button and the live count; the DESIGN SYSTEM section left the
// default list for the pinned `canvases-ds-row` above it, Trash and Advanced follow the list). Per case: (1) the
// `shell key="s"` cases (the design-system view) select the pinned row — `button.lp-ds.is-sel[aria-current]`
// where the `demo` folder row was `[aria-selected]`; (2) every `shell` case whose key lands in the search field
// (/, ⌘F, t, h, s, n, c, 0, ?, space …) types a query, and a query shows the DESIGN SYSTEM group among the
// hits (the pinned row steps aside while searching, as in the kit), so those diffs list the section's rows
// where v1 listed it already expanded — the hashes moved, the keydown / writes lines did not.
// Lead refresh (V2-4.1, V2-1.2 §5.6 I2): the canvas now re-fits once when the shell's first insets
// arrive after its boot fit, so every case's boot `@world translate` is the inset-aware fit (it used
// to depend on whether the insets beat the boot fit — the ⌘D case flipped between runs). Inspector
// values derived from the zoom (height, transform-origin) moved with it. No key or write changed.
// Lead refresh (V2-4.2, decision:maude/v2-4.2-project-pill-and-menu): the project pill is a top island
// (data-occludes=top, 56 px), so every boot `@world translate` moved down ~50 px (the inset-aware fit),
// a reloaded shell lists the pill's `.st-pill-sep`, and one case sends a second `occluded-insets`. No key
// or write changed. (One alone run showed a one-off inspector variant, +19 −25; the refresh and the verify
// run both match the old golden there.)
// Lead refresh (V2-4.3a, decision:maude/v2-4.3a-cluster-via-registry-runner): shell lists gain the Share
// cluster — `share-cluster-comments` toggles aria-pressed / is-on with the Comments panel, and
// `share-cluster-share` is aria-disabled "Open a canvas to share it" with no canvas; "… N more" counts
// shift by one. No key or write changed.
// Lead refresh (V2-4.3b, decision:maude/v2-4.3b-shell-owns-mode-switch): the shell now governs mode —
// `to-canvas` lists gain `set-mode mode=edit` (seeded per canvas, insets first), `to-shell` lists gain
// `mode-changed` and the canvas's `peers`; a viewer's V lands in Viewing (`mode-request` → `set-mode
// mode=viewing`) instead of a local tool switch. The I2 boot re-fit no longer persists the camera
// (decision:maude/v2-4.3b-boot-refit-does-not-persist), so the reload cases write nothing — before it
// they added a PATCH canvas-meta in some runs. Refreshed once and verified identical in two more runs.
// Lead refresh (V2-4.5–4.8 + 4.10, decision:maude/v2-4.5b-ai-chat-cmd-slash, decision:maude/v2-4.5b-key-crossing-in-router,
// decision:maude/v2-4.8a-menubar-removed): rule-13 keys moved (Pen B → Marker M, Highlighter I / Eraser E →
// Marker tips, O → Edit › More, ⇧S → S, ⌘E → ⇧⌘E, shell H/S/N unbound, ⇧⌘A → ⌘/, ⌘/ → /), crossing keys post
// `mode-request`, the canvas posts `toolbar-rect`, the toolbars replace the palette (`toolbar-slot-*`), Settings
// is the v2 sheet and ⌘K the v2 search; no write changed.
// Lead refresh (V2-4.4a+b, decision:maude/v2-4.4b-right-islands): the left panel's own header replaces the
// dock tab strip (panel-tab-*), Canvases/Assets tabs, the pinned DS row + Trash + Advanced, and the
// Inspector now appears on selection — so selection cases send one more `occluded-insets` (its island
// covers part of the canvas). No key or write changed.
// Approved delta (V2-4 gate polish-a/b + roles, decision:maude/v2-4-gate-polish-b, decision:maude/v2-4-gate-role-gated-actions,
// decision:maude/v2-4-gate-help-keys-once): ⇧⌘G no longer opens the Changes/history panel in any lane (Version
// history is ⌥⌘H; ⇧⌘G is Remove frame in Edit, S2), so `*/Meta+Shift+G` is `default` with no panel; in the viewer
// ⌘Z is a denied edit — the shell shows the denial notice and sends the canvas neither `run-action edit.undo` nor
// `undo-barrier-ok`; ⌘K rows are `role=option` with `aria-selected` and `tabindex=-1` (combobox/listbox); the
// shortcuts sheet takes `tabindex=-1` (focus helper) and lists a key once (fewer rows); Hide panels says its state
// by its label, not `aria-pressed`; Settings › General gains the Keyboard group; the "?" sheet then (f1607c3e)
// shows ⌥⌘1–9 as one range and wraps each "or" with its key. No write changed.
//
// Lead refresh (V2-5 wave A gate; golden regenerated twice, 238 of 240 cases byte-identical between the two runs —
// `browser/in-canvas/canvas Meta+z` and `Meta+g` are one-off timing variants, an extra `undo-key` / notice line):
// wave A made the keys the contract promised do their work. (1) T arms the Text tool (decision
// v2-S2.12b Edit T arms el-text): `t` cases send `tool-cursor tool=el-text` and no longer insert text on the
// spot, so no `insert-element` / reload, and the cases that follow it in a lane start from a canvas that was
// not rewritten. (2) R arms Shape (V2-4.5b tool keys, S2 shapes): `browser/in-canvas/canvas r` is PREVENTED with
// `tool-cursor tool=el-shape`. (3) ⌘G and ] run the object ops (S2.6): `edit-op op=object.frame` /
// `object.bring-forward`, one `POST /_api/edit-op`. (4) ⇧⌘E opens the S8.2 sheet, which asks
// `POST /_api/export-estimate` (S8.1/S8.2). (5) ⇧⌘M runs `presence.context`. (6) timeline ⌘Z / ⇧⌘Z are
// `edit.undo` / `edit.redo` with an `undo-barrier` (the retired `timeline.undo`). (7) Esc in the canvas no longer
// sends `force-clear` / `tool-cursor tool=move` (decision v2-S3.12-esc-one-rung).
// Not attributed one by one: the cases that only gained a `viewport-zoom` / `PATCH canvas-meta` (s n c a e, ⌘0 …,
// the presenting Esc cases, tauri ⌘N's composer) and the 42 whose only change is the shell/canvas DOM hash (the
// floating panels' content moved). They are stable across the two regenerations, so they are the measured wave A
// behaviour; a case-by-case read of them is open (the lead's call).
// Lead refresh 2 (V2-5 wave A gate, after S1–S5 fixes + gate kernel fix + polish 1/2): keydown/writes changed in 10
// cases, all wave-A behaviour. (1) Esc from shell chrome (`canvas/chrome`, `canvas/select`, `timeline/chrome`) is
// PREVENTED by the shell and forwarded to the canvas once — no widget consumed it (gate-a-kernel 1ab9c38be); the
// text-focus Escape forward is gone. (2) ⇧⌘G in the canvas is Ungroup / Remove frame (S2): PREVENTED, one
// `POST /_api/edit-op`. (3) ⇧P hides annotations and persists it (`POST /_api/ui-prefs`, S4.18 an-visibility). (4) ⇧⌘A (Preview, both lanes) and
// ⌘G gained the `PATCH canvas-meta` of the camera class above. Every other change is DOM-only (the Edit focus ring,
// order badges and aria-live line, the export sheet's new rows) or new protocol messages (`vote-state`,
// `annotation-selection`, S4.8/S4.19).
// Lead decision (v2-lead-v1-keys-normalise-volatile): the undo toast (message and DOM), the `artboards` message and
// `undo-key` / `undo-mode` are timing races against the snapshot window, so a case records which of them appeared as a
// sorted, de-duplicated `{kind,…}` presence (the boot-time `viewport-zoom` / `peers` / `mode-changed` / `hold-view` of a reloaded canvas joined them: how often each repeats on a reload is the same race) at the end of its message list — no order, no count — and the toast's
// DOM lines are left out of the fingerprint. The Esc cases that stopped sending `force-clear` are decision
// v2-S3.12-esc-one-rung (one rung per Esc).
// Lead refresh (V2-5 wave B gate, gate-b-keys; regenerated at the wave-B tip on a quiet machine and verified green
// by a second full run at 4 lanes). Three kinds of change against the wave-A golden, each sorted by case:
//  (i) intended, from a wave-B slice —
//   · new dgn messages in the lists: `gen-takes` (S8.16b, to-canvas), `timeline-peers` (S7.17) and `render-ok`
//     (S6.12) (to-shell) on every canvas boot; `ds-update-dots` (S10.8) joined the volatile set;
//   · the Canvases panel folds while the Inspector is up and returns on Esc / Backspace (S6.16b), so the cases that
//     deselect list its rows; kind chips (S7.24), pinned design-system rows with their menu / sub-line / warn (S10.13),
//     empty states (S11.3) and the new Layers tab / Assets › Generate (S7.24b, S8.16b) are in the shell lists;
//   · the corner icons read "Open Canvases" / "Open Inspector" and the Settings side radios are one tab stop (S11.18);
//   · ⇧⌘H opens the S8.10 Handoff sheet (targets, "Use the design system") where the Export sheet's handoff text was;
//   · ⇧⌘T summons the S7.7 timeline island (compact, Expand, Kept open) and sends one more `occluded-insets`;
//   · Settings › account reads "Manage on cloud.maude.sh" (S9.20), Help lists the guides door (S6.15), the Comments
//     panel's empty state offers "Share for feedback" (S11.3).
//  (ii) timing / position noise, left out of the record rather than pinned (a second and third full run disagreed on
//     them while every key effect agreed): S9.23's first-shell-keydown `presence.context` ping (listed in 8 cases of one run and
//     25 of the next) and the boot's `canvas-mounted` are NOISE; `ds-update-dots` / `locked-set` are VOLATILE; the
//     boot re-fit's camera PATCH after ⌘R is not a ⌘R write; the "text" focus waits for the Canvases search field
//     (it draws late on a loaded machine); each lane's server takes its own port (4600 + 50 n + generation), the
//     4399–4408 walk ran out twice with other suites' servers on it. Camera `@world translate`, name-tag sizes, a
//     restored selection's ring / Inspector and a four-node toast-shaped element (`div div li ol`, not identified) that is
//     only there while the machine is loaded moved with the load, not with a key.
//  (iii) one real regression, fixed (decision v2-gate-b-keys-handoff-focus): ⇧⌘H opened the Handoff sheet with focus
//     left behind it (its primary button is disabled until the targets arrive, and a disabled button takes no focus),
//     so Esc and ↵ went to the shell. The golden now shows `@focus div[data-testid="export-sheet"]`.
// Settling (V2-3 gate): a snapshot is taken once two reads 250 ms apart agree AND no GET the case
// fired is still open (`trackNetwork`): a fetch that has not answered is a DOM change that has not
// happened yet (Settings' scout card, the inspector's edit-scope row), and under load it answers
// after the quiet window a plain two-equal-reads test accepts. The golden is DEALT over
// GOLDEN_LANES servers: which case runs first on a fresh server (its canvas bundle still cold) or
// after a quiet one (the server restores the previous case's selection, so the canvas pans to reveal
// it) shows in the bodies, e.g. the `@world translate` of the zoom cases, so a whole-suite
// comparison or refresh only runs at that lane count.
//
//   cd apps/studio && bun test test/characterization/v1-keys.test.ts
//     V1_KEYS_UPDATE=1   rewrite the golden
//     V1_KEYS_ONLY=<p>   only cases whose id starts with <p> (comma list; no golden check)
//     V1_KEYS_LANES=<n>  parallel servers (default 4; any other count needs V1_KEYS_ONLY)
//     V1_KEYS_RETRIES=<n> a case that differs from the golden is re-run on a fresh server up to <n> times (default 2)
//                         and passes if any attempt equals its golden block (timing noise differs every time, a real
//                         key change never matches); 0 = strict single pass. Not used with UPDATE / ONLY.
//   Diagnostics (a body with any of these never matches the golden):
//     V1_KEYS_DUMP=1        list every hashed shell/canvas line, not only the salient ones
//     V1_KEYS_BODY_OUT=<f>  also write the whole body to <f>
//     V1_KEYS_LATE=1        re-snapshot the shell 1.5 s before the key and 2 s after it, and list
//                           any late change. It shifts the key's timing, so other cases can move
//                           too: use it to look for late DOM, not to compare against the golden.
//     V1_KEYS_JITTER=<ms>   a slow server on demand: once the page has booted, every GET it makes
//                           answers up to <ms> late. The settled bodies must still match the golden.
//
// The server serves whatever apps/studio/dist/client.bundle.js holds: to test the SOURCE client,
// build it first (`MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release`) and restore dist/ after.
// The canvas runtime and inspect.ts are always the source.

import { expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const STUDIO = join(import.meta.dir, '..', '..');
const GOLDEN = join(import.meta.dir, 'v1', 'keys.txt');
const UPDATE = process.env.V1_KEYS_UPDATE === '1';
const ONLY = process.env.V1_KEYS_ONLY ? process.env.V1_KEYS_ONLY.split(',') : null;
const GOLDEN_LANES = 4;
const LANES = Math.max(1, Number(process.env.V1_KEYS_LANES ?? GOLDEN_LANES));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── fixture ───────────────────────────────────────────────────────────────────────────────
const HOME_TSX = `import { DCArtboard, DCSection, DesignCanvas } from '@maude/canvas-lib';

export default function Home() {
  return (
    <DesignCanvas>
      <DCSection id="main" title="Home">
        <DCArtboard id="home-hero" label="Hero" width={800} height={500}>
          <main style={{ padding: 40, fontFamily: 'system-ui' }}>
            <h1 data-cd-id="home-hero-title">Hero</h1>
            <p data-cd-id="home-hero-body">Characterization fixture.</p>
            <input data-cd-id="home-hero-input" aria-label="Name" placeholder="Name" />
            <button data-cd-id="home-hero-cta" type="button">Get started</button>
          </main>
        </DCArtboard>
        <DCArtboard id="home-pricing" label="Pricing" width={800} height={500}>
          <main style={{ padding: 40, fontFamily: 'system-ui' }}>
            <h1 data-cd-id="home-pricing-title">Pricing</h1>
          </main>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

const FIXTURE: Record<string, string> = {
  '.design/config.json': `${JSON.stringify(
    {
      name: 'v1-keys',
      designRoot: '.design',
      rootClass: 'demo',
      canvasGroups: [
        { label: 'Design system', path: 'system' },
        { label: 'UI kit', path: 'ui' },
      ],
      designSystems: [
        {
          name: 'demo',
          path: 'system/demo',
          tokensCssRel: 'system/demo/colors_and_type.css',
          rootClass: 'demo',
          themeDefault: 'light',
          themes: ['light', 'dark'],
          newCanvasDir: 'ui',
        },
      ],
    },
    null,
    2
  )}\n`,
  '.design/system/demo/colors_and_type.css':
    '.demo[data-theme="light"] { --bg-0: oklch(0.99 0 0); --fg-0: oklch(0.2 0 0); --accent: oklch(0.6 0.15 250); }\n' +
    '.demo[data-theme="dark"] { --bg-0: oklch(0.18 0 0); --fg-0: oklch(0.96 0 0); --accent: oklch(0.7 0.15 250); }\n',
  '.design/system/demo/README.md':
    '# demo\n\nA tiny design system for the v1 key characterization.\n',
  '.design/ui/Home.tsx': HOME_TSX,
};

function writeFixture(project: string) {
  for (const [rel, content] of Object.entries(FIXTURE)) {
    const p = join(project, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
}

/** Put the project back to the fixture: drop every file the run wrote, rewrite the sources. */
function resetFixture(lane: Lane): boolean {
  // Touch only what a case changed: rewriting an unchanged source still fires the server's file
  // watcher, whose late canvas reload would land inside the NEXT case's window.
  let touched = false;
  const design = join(lane.project, '.design');
  for (const name of ['_history', '_canvas-state', '_comments', '_trash', '_state']) {
    const p = join(design, name);
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }
  const ui = join(design, 'ui');
  for (const name of readdirSync(ui))
    if (name !== 'Home.tsx') {
      rmSync(join(ui, name), { recursive: true, force: true });
      touched = true;
    }
  for (const [rel, content] of Object.entries(FIXTURE)) {
    const p = join(lane.project, rel);
    if (existsSync(p) && readFileSync(p, 'utf8') === content) continue;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
    touched = true;
  }
  rmSync(join(lane.home, '.config', 'maude', 'prefs.json'), { force: true });
  return touched;
}

// ── servers (one per lane; cases are dealt to lanes round-robin, so the golden is stable) ──
interface Lane {
  n: number;
  work: string;
  project: string;
  home: string;
  server: ChildProcess;
  url: string;
  origin: string;
  log: string[];
}

async function bootLane(n: number, root: string, gen = 0): Promise<Lane> {
  const work = join(root, `lane-${n}-${gen}`);
  const project = join(work, 'project');
  const home = join(work, 'home');
  mkdirSync(join(home, '.config'), { recursive: true });
  writeFixture(project);
  const log: string[] = [];
  // Never reach the machine's real `claude`: the AI chat (ACP) and the readiness probe start it, and
  // in a throwaway HOME it finds no keychain, so macOS asks the person at the keyboard about "Keychain
  // Not Found" on every boot. A stub first on PATH answers a signed-out status at once (the same trick
  // as the ACL gate fixture, gate-b-u7) and MAUDE_CLAUDE_BIN is emptied so nothing pins the real one.
  const stubBin = join(home, 'bin');
  mkdirSync(stubBin, { recursive: true });
  writeFileSync(join(stubBin, 'claude'), `#!/bin/sh\necho '{"loggedIn":false}'\n`, { mode: 0o755 });
  const server = spawn('bun', [join(STUDIO, 'server.ts'), '--root', project], {
    env: {
      // the harness's own switches (V1_KEYS_*, MAUDE_V1_KEYS) are not the server's business: an update
      // run and a verify run must boot byte-identical servers
      ...Object.fromEntries(
        Object.entries(process.env).filter(([k]) => !/^(V1_KEYS_|MAUDE_V1_KEYS$)/.test(k))
      ),
      PATH: `${stubBin}:${process.env.PATH ?? ''}`,
      MAUDE_CLAUDE_BIN: '',
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      // S5.1b — the local kernel's machine stamp stays in the throwaway HOME, never the person's.
      MAUDE_MACHINE_FILE: join(home, '.config', 'maude', 'machine.json'),
      NO_OPEN: '1',
      MAUDE_NO_AUTOBUILD: '1',
      MAUDE_SYNC_IN_CI: '1',
      // An explicit port per (lane, generation) instead of the 4399–4408 walk: with other suites'
      // servers and a leaked one or two on that range the walk ran out ("Ports 4399-4408 are all in
      // use") and killed the run twice. Nothing in a body depends on the port (`norm`).
      PORT: String(4600 + n * 50 + gen),
      TZ: 'UTC',
      // The goldens were taken with no local Ollama answering; a host Ollama changes the AI
      // readiness rows in Settings (2026-10-13: 359 → 354 nodes). Port 9 (discard) on loopback
      // refuses fast, so the run never depends on what this Mac has running.
      OLLAMA_HOST: '127.0.0.1:9',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (d) => log.push(String(d)));
  server.stderr?.on('data', (d) => log.push(String(d)));
  let url = '';
  for (let waited = 0; waited < 60_000 && !url; waited += 300) {
    await sleep(300);
    if (server.exitCode !== null) break;
    const sj = join(project, '.design', '_server.json');
    if (!existsSync(sj)) continue;
    try {
      url = JSON.parse(readFileSync(sj, 'utf8')).url;
    } catch {
      /* mid-write */
    }
  }
  if (!url)
    throw new Error(`lane ${n}: the source dev-server never came up\n${log.join('').slice(-1500)}`);
  return { n, work, project, home, server, url, origin: new URL(url).origin, log };
}

// ── shells ────────────────────────────────────────────────────────────────────────────────
type ShellName = 'browser' | 'tauri' | 'viewer' | 'tauri-viewer';

const TAURI_STUB = `window.__TAURI__ = {
  core: { invoke: (cmd) => Promise.reject(new Error('v1-keys: ' + cmd)) },
  event: { listen: () => Promise.resolve(() => {}) },
  window: {}, path: {}, app: {},
};`;

// Recorder in EVERY frame (shell and canvas iframe): the dgn messages that arrive, and every
// keydown (read back after all listeners ran, for defaultPrevented).
const RECORDER = `(() => {
  if (window.__v1k) return;
  const rec = { msgs: [], keys: [] };
  window.__v1k = rec;
  const FIELDS = ['id', 'tool', 'op', 'mode', 'dir', 'frame', 'muted', 'loop', 'kind', 'on', 'open', 'visible'];
  const desc = (d) => {
    const parts = [String(d.dgn)];
    for (const f of FIELDS) {
      const v = d[f];
      if (v === undefined || v === null || typeof v === 'object') continue;
      parts.push(f + '=' + String(v).slice(0, 40));
    }
    return parts.join(' ');
  };
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || typeof d.dgn !== 'string') return;
    const from = e.source === window ? 'self' : (window.parent !== window && e.source === window.parent) ? 'parent' : 'child';
    rec.msgs.push(from + ' ' + desc(d));
  }, true);
  window.addEventListener('keydown', (e) => { rec.keys.push(e); }, true);
})();`;

// The structural snapshot of one document, flat (one line per element; depth dropped so a moved
// wrapper does not drown the diff). Iframes / SVG / canvas insides are not descended into.
function fingerprintInPage(arg: { work: string }): string[] {
  const KEEP = [
    'data-testid',
    'role',
    'aria-label',
    'aria-pressed',
    'aria-expanded',
    'aria-selected',
    'aria-checked',
    'aria-current',
    'aria-disabled',
    'aria-hidden',
    'aria-modal',
    'data-tour',
    'data-path',
    'data-state',
    'data-active',
    'data-active-tool',
    'data-unseen',
    'data-busy',
    'title',
    'type',
    'placeholder',
    'disabled',
    'hidden',
    'checked',
    'href',
    'name',
    'tabindex',
  ];
  const norm = (s: string) =>
    String(s)
      .split(arg.work)
      .join('<work>')
      .replace(/https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+/g, '<origin>')
      .replace(/:\d{4,5}\b/g, ':<port>')
      .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '<time>')
      .replace(
        /\b\d+\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hrs?|hours?|d|days?)\s+ago\b/gi,
        '<ago>'
      )
      .replace(/\b(just now|a few seconds ago|a minute ago|an hour ago)\b/gi, '<ago>')
      .replace(/\bv?\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?\b/g, '<ver>')
      .replace(/\b20\d\d-\d\d-\d\d(T[\d:.]+Z?)?\b/g, '<date>')
      // a name tag's "W × H" is a measurement at the fit zoom: round to 8 px (see the Inspector's fields)
      .replace(
        /\b(\d{1,4}) × (\d{1,4})\b/g,
        (_m, w, h) => `${Math.round(w / 8) * 8} × ${Math.round(h / 8) * 8}`
      )
      .replace(/\s+/g, ' ')
      .trim();
  const describe = (el: Element | null): string => {
    if (!el) return '(none)';
    const h = el as HTMLElement;
    const bits = [el.tagName.toLowerCase()];
    for (const a of ['data-testid', 'aria-label', 'type', 'placeholder', 'data-cd-id']) {
      const v = el.getAttribute(a);
      if (v) bits.push(`[${a}=${JSON.stringify(norm(v).slice(0, 60))}]`);
    }
    if (!bits[1] && h.className && typeof h.className === 'string')
      bits.push(`.${h.className.trim().split(/\s+/).sort().join('.')}`);
    return bits.join('');
  };
  const out: string[] = [];
  const walk = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript') return;
    const parts = [tag];
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).sort();
    if (cls.length) parts.push(`.${cls.join('.')}`);
    for (const a of KEEP) {
      if (!el.hasAttribute(a)) continue;
      const v = el.getAttribute(a) ?? '';
      parts.push(v === '' ? `[${a}]` : `[${a}=${JSON.stringify(norm(v).slice(0, 80))}]`);
    }
    if (
      (tag === 'input' || tag === 'textarea' || tag === 'select') &&
      (el as HTMLInputElement).value
    ) {
      // A measured size (the Inspector's W / H) is rounded to 8 px like the name tag's: the same
      // artboard reads 216, 217 or 219 tall depending on the fit zoom the run settled on.
      const raw = (el as HTMLInputElement).value;
      const shown =
        el.getAttribute('role') === 'spinbutton' && /^-?\d+$/.test(raw)
          ? String(Math.round(Number(raw) / 8) * 8)
          : norm(raw).slice(0, 60);
      parts.push(`{value=${JSON.stringify(shown)}}`);
    }
    let text = '';
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.nodeValue;
    text = norm(text);
    if (text) parts.push(JSON.stringify(text.slice(0, 120)));
    out.push(parts.join(' '));
    if (tag === 'svg' || tag === 'iframe' || tag === 'canvas' || tag === 'video') return;
    for (const c of el.children) walk(c);
  };
  if (document.body) walk(document.body);
  const world = document.querySelector('.dc-world') as HTMLElement | null;
  if (world) out.push(`@world ${world.style.transform || ''}`);
  out.push(`@focus ${describe(document.activeElement)}`);
  const html = document.documentElement;
  out.push(
    `@html ${[...html.attributes]
      .map((a) => `${a.name}=${norm(a.value).slice(0, 60)}`)
      .sort()
      .join(' ')}`
  );
  return out;
}

// ── the cases ─────────────────────────────────────────────────────────────────────────────
type Setup =
  | 'shell' // no canvas open
  | 'canvas' // Home open, focus stays in the shell
  | 'in-canvas' // Home open, focus inside the canvas iframe (browse tool, nothing selected)
  | 'in-canvas-text' // focus in an <input> inside the canvas
  | 'in-canvas-selected' // V, then click the hero title (element selected, focus in canvas)
  | 'timeline' // Home open, a video comp announced, Timeline open (⇧⌘T), focus in the shell
  | 'presenting'; // Home open, Presentation Mode on

type Focus =
  | 'chrome' // nothing focused (body)
  | 'text' // the tree's search field
  | 'select' // a <select> in the shell
  | 'range' // an <input type=range> in the shell
  | 'canvas'; // inside the canvas iframe (whatever the setup left focused there)

interface Case {
  id: string;
  shell: ShellName;
  setup: Setup;
  focus: Focus;
  keys: string;
}

const SHELL_KEYS = [
  'Meta+k',
  'Meta+Shift+K',
  'Meta+z',
  'Meta+Shift+Z',
  'Meta+y',
  'Meta+Shift+Y',
  'Meta+Shift+R',
  'Meta+r',
  'Meta+Shift+M',
  'Meta+Shift+G',
  'Meta+Shift+I',
  'Meta+Shift+A',
  'Meta+Shift+E',
  'Meta+Shift+H',
  'Meta+Comma',
  'Meta+Shift+T',
  'Slash',
  'Meta+Slash',
  'Meta+f',
  'Meta+Shift+F',
  't',
  'Shift+T',
  'h',
  's',
  'n',
  'Shift+Slash',
  'Meta+Shift+Slash',
  'F1',
  'Shift+F1',
  'Escape',
  'Backspace',
  'Delete',
  'Shift+Backspace',
  'Meta+Backspace',
  'Space',
  'ArrowRight',
  'Meta+b',
  'Meta+Equal',
  'c',
  'Digit0',
  'Meta+n',
  'Meta+c',
];

const CANVAS_KEYS = [
  'v',
  'Shift+V',
  'h',
  'c',
  'b',
  'i',
  'r',
  'o',
  'a',
  'n',
  't',
  'Shift+S',
  's',
  'e',
  'Escape',
  'Shift+Escape',
  'Meta+Escape',
  'Meta+z',
  'Meta+Shift+Z',
  'Meta+y',
  'Meta+Shift+Y',
  'Meta+k',
  'Meta+Shift+K',
  'Meta+r',
  'Meta+Shift+R',
  'Meta+Shift+I',
  'Meta+Shift+M',
  'Meta+Shift+E',
  'Meta+Shift+H',
  'Meta+Shift+T',
  'Meta+Shift+G',
  'Meta+Shift+A',
  'Meta+Comma',
  'Shift+Slash',
  'F1',
  'Slash',
  'Meta+f',
  'Meta+e',
  'Meta+0',
  'Meta+1',
  'Shift+Digit0',
  'Meta+Equal',
  'Meta+Minus',
  'Shift+P',
  'Meta+a',
  'Meta+d',
  'Meta+g',
  'Backspace',
  'ArrowLeft',
  'BracketRight',
  'Enter',
  'Tab',
];

const CANVAS_TEXT_KEYS = [
  'v',
  'h',
  'n',
  't',
  'Shift+S',
  'Escape',
  'Meta+z',
  'Meta+k',
  'Meta+r',
  'Meta+Shift+E',
  'Meta+Shift+I',
  'Meta+a',
  'Backspace',
  'ArrowLeft',
];

const SELECTED_KEYS = [
  'Escape',
  'ArrowLeft',
  'Shift+ArrowRight',
  'Meta+d',
  'Meta+Alt+c',
  'Backspace',
  'Enter',
  'Shift+Enter',
  'Tab',
  'Meta+a',
  'Meta+Shift+A',
  'Meta+z',
  'h',
];

const TIMELINE_KEYS = [
  'Space',
  'ArrowRight',
  'ArrowLeft',
  'Shift+ArrowRight',
  'Home',
  'End',
  'Period',
  'Comma',
  'Meta+z',
  'Meta+Shift+Z',
  'Meta+y',
  'Meta+b',
  'Escape',
  'Backspace',
  'c',
  'Digit0',
  'Meta+Equal',
  'Meta+Minus',
  't',
  'Meta+Shift+T',
];

function buildCases(): Case[] {
  const cases: Case[] = [];
  const add = (shell: ShellName, setup: Setup, focus: Focus, keys: string[]) => {
    for (const k of keys)
      cases.push({ id: `${shell}/${setup}/${focus} ${k}`, shell, setup, focus, keys: k });
  };
  add('browser', 'canvas', 'chrome', SHELL_KEYS);
  add('browser', 'canvas', 'text', SHELL_KEYS);
  add('browser', 'shell', 'chrome', [
    'Meta+z',
    'Meta+Shift+Z',
    'Meta+y',
    'Backspace',
    's',
    'Meta+r',
    'Meta+Shift+I',
  ]);
  add('browser', 'canvas', 'select', [
    't',
    'Shift+Slash',
    'Meta+z',
    'Backspace',
    'Escape',
    'Meta+k',
  ]);
  add('browser', 'canvas', 'range', [
    't',
    'Shift+Slash',
    'Meta+z',
    'Backspace',
    'Escape',
    'Meta+k',
  ]);
  add('browser', 'in-canvas', 'canvas', CANVAS_KEYS);
  add('browser', 'in-canvas-text', 'canvas', CANVAS_TEXT_KEYS);
  add('browser', 'in-canvas-selected', 'canvas', SELECTED_KEYS);
  add('browser', 'timeline', 'chrome', TIMELINE_KEYS);
  add('browser', 'timeline', 'text', [
    'Space',
    'ArrowRight',
    'Meta+z',
    'Meta+b',
    'Escape',
    'Backspace',
  ]);
  add('browser', 'timeline', 'select', ['Space', 'ArrowRight', 'Meta+z', 'Backspace']);
  add('browser', 'timeline', 'range', ['Space', 'ArrowRight', 'Meta+z', 'Backspace', 't']);
  add('browser', 'presenting', 'chrome', ['Escape', 'Shift+Escape', 't']);
  add('browser', 'presenting', 'text', ['Escape']);
  add('browser', 'presenting', 'canvas', ['Escape']);
  add('tauri', 'canvas', 'chrome', ['Meta+Shift+A', 'Meta+n', 'Meta+Comma']);
  add('tauri', 'canvas', 'text', ['Meta+Shift+A']);
  add('tauri', 'in-canvas', 'canvas', ['Meta+Shift+A', 'Meta+n']);
  add('viewer', 'canvas', 'chrome', ['Meta+Comma', 'Meta+z', 'n', 'Meta+Shift+E', 'Backspace']);
  add('viewer', 'in-canvas', 'canvas', ['c', 'b', 'n', 'v', 'Meta+z']);
  add('tauri-viewer', 'canvas', 'chrome', ['Meta+Shift+A', 'Meta+Comma']);
  return cases;
}

// ── driving one case ──────────────────────────────────────────────────────────────────────
type Browser = import('playwright').Browser;
type Page = import('playwright').Page;
type Frame = import('playwright').Frame;
type BrowserContext = import('playwright').BrowserContext;
type Request = import('playwright').Request;

// The studio's websocket keeps the network busy forever, so "networkidle" is useless here; a
// fixed pause plus `stable()` (two equal snapshots in a row) is what settles a step.
const settle = async (_page: Page, ms = 500) => {
  await sleep(ms);
};

function canvasFrame(page: Page, lane: Lane): Frame | null {
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    try {
      const u = new URL(f.url());
      if (u.origin !== lane.origin && /canvas/.test(f.url())) return f;
    } catch {
      /* about:blank */
    }
  }
  return null;
}

async function openCanvas(page: Page) {
  // Sections and folders start closed; open them in bounded passes (same as the desktop e2e).
  const CLOSED =
    '[data-testid^="tree-section-"][aria-expanded="false"], [data-testid^="tree-folder-"][aria-expanded="false"]';
  for (let pass = 0; pass < 12; pass++) {
    const n = await page.evaluate((sel) => {
      const closed = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      for (const el of closed) el.click();
      return closed.length;
    }, CLOSED);
    if (!n) break;
    await sleep(200);
  }
  const row = page.locator('[data-testid="canvas-row-ui-home"]').first();
  await row.waitFor({ timeout: 15_000 });
  await row.click();
  await page.waitForFunction(
    () => !!document.querySelector('iframe[data-testid="canvas-frame"].active'),
    null,
    { timeout: 20_000 }
  );
}

async function waitCanvasReady(page: Page, lane: Lane): Promise<Frame> {
  for (let i = 0; i < 100; i++) {
    const f = canvasFrame(page, lane);
    if (f) {
      try {
        const ok = await f.evaluate(
          () => !!document.querySelector('[data-cd-id="home-hero-title"]')
        );
        if (ok) return f;
      } catch {
        /* navigating */
      }
    }
    await sleep(200);
  }
  throw new Error('the canvas never rendered the fixture');
}

const COMPS = [
  {
    id: 'comp-hero',
    fps: 30,
    durationInFrames: 90,
    width: 800,
    height: 500,
    artboardId: 'home-hero',
    artboardLabel: 'Hero',
  },
];

async function runSetup(page: Page, lane: Lane, c: Case): Promise<void> {
  if (c.setup === 'shell') return;
  await openCanvas(page);
  const frame = await waitCanvasReady(page, lane);
  await settle(page, 800);
  if (c.setup === 'in-canvas') {
    await frame.locator('[data-cd-id="home-hero-title"]').click({ timeout: 8000 });
  } else if (c.setup === 'in-canvas-text') {
    await frame.locator('[data-cd-id="home-hero-input"]').click({ timeout: 8000 });
  } else if (c.setup === 'in-canvas-selected') {
    await frame.locator('[data-cd-id="home-hero-body"]').click({ timeout: 8000 });
    await page.keyboard.press('v');
    await settle(page, 300);
    await frame.locator('[data-cd-id="home-hero-title"]').click({ timeout: 8000 });
  } else if (c.setup === 'timeline') {
    await frame.evaluate((comps) => {
      window.parent.postMessage({ dgn: 'timeline-comps', comps }, '*');
    }, COMPS);
    await settle(page, 300);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('Meta+Shift+T');
    await page.waitForSelector('[data-testid="timeline-panel"]', { timeout: 8000 });
  } else if (c.setup === 'presenting') {
    // V2-4.8a: the project pill's menu (the in-app menubar is gone) — View › Presentation Mode.
    await page.locator('[data-testid="project-pill"]').click();
    await page.locator('[data-testid="project-menu-row-sub-view"]').click();
    await page.locator('[data-testid="project-menu-row-present.canvas"]').click();
    await page.waitForSelector('.st-present-exit', { timeout: 8000 });
  }
  await settle(page, 600);
}

async function placeFocus(page: Page, lane: Lane, c: Case): Promise<void> {
  if (c.focus === 'canvas') {
    if (c.setup === 'presenting') {
      const frame = canvasFrame(page, lane);
      await frame?.locator('[data-cd-id="home-hero-body"]').click({ timeout: 8000 });
    }
    return; // the setup put focus in the canvas
  }
  if (c.focus === 'chrome') {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  } else if (c.focus === 'text') {
    // The Canvases panel draws a beat after the shell does on a loaded machine (and folds while a
    // selection restored from the previous case has the Inspector up), so the field may not be in
    // the DOM yet: wait for it before declaring it missing.
    await page
      .waitForSelector('[data-testid="canvas-search"]', { state: 'attached', timeout: 10_000 })
      .catch(() => {});
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="canvas-search"]') as HTMLElement | null;
      if (!el) throw new Error('no tree search field');
      el.focus();
    });
  } else if (c.focus === 'select' || c.focus === 'range') {
    // A neutral control outside React's tree: the v1 listeners read only its tag / type.
    await page.evaluate((kind) => {
      const el =
        kind === 'select' ? document.createElement('select') : document.createElement('input');
      if (kind === 'select') {
        for (const v of ['a', 'b']) {
          const o = document.createElement('option');
          o.value = v;
          o.textContent = v;
          el.appendChild(o);
        }
      } else (el as HTMLInputElement).type = 'range';
      el.setAttribute('data-v1k-probe', kind);
      el.style.cssText = 'position:fixed;left:2px;bottom:2px;width:40px;height:16px;z-index:0';
      document.body.appendChild(el);
      el.focus();
    }, c.focus);
  }
  await sleep(150);
}

interface DocSnap {
  lines: string[];
}

async function snapDoc(target: Page | Frame, lane: Lane): Promise<DocSnap | null> {
  try {
    const lines = await target.evaluate(fingerprintInPage, { work: lane.work });
    return { lines: lines.filter((l) => !VOLATILE_DOM.test(l)) };
  } catch {
    return null;
  }
}

/** The reads one case has in flight (shell + canvas frames). A fetch that has not answered yet is a
 *  DOM change that has not happened yet: Settings' scout card, the inspector's edit-scope and source
 *  rows all arrive that way, and a server under load answers late. Two equal snapshots 250 ms apart
 *  do not see it coming, they only see "nothing changed so far". */
interface Net {
  pending(): string[];
  /** an edit-op / duplicate-element write went out in this case */
  wrote(): boolean;
}
function trackNetwork(context: BrowserContext): Net {
  const open = new Map<Request, string>();
  let wrote = false;
  context.on('request', (r) => {
    // Only READS: a write is recorded as a write (and a keepalive POST never "finishes" in the
    // protocol's eyes), a stream is open by design. What a document waits on is data coming in.
    // Two writes ARE waited for (V2-5 gate; edit-op, duplicate-element): an edit-op's answer changes the DOM (the notice, the inspector)
    // and the canvas's undo stack — a snapshot taken before it lands made ⌘G and the ⌘Z after it flip
    // between two bodies from run to run.
    const path = r
      .url()
      .replace(/^https?:\/\/[^/]+/, '')
      .split('?')[0];
    const editOp =
      r.method() === 'POST' && (path === '/_api/edit-op' || path === '/_api/duplicate-element');
    if ((r.method() !== 'GET' && !editOp) || r.resourceType() === 'eventsource') return;
    if (editOp) wrote = true;
    open.set(r, `${r.method()} ${path}`);
  });
  const done = (r: Request) => void open.delete(r);
  context.on('requestfinished', done);
  context.on('requestfailed', done);
  return { pending: () => [...open.values()], wrote: () => wrote };
}
/** The longest a document waits for the reads it fired (the server and the machine are shared with the
 *  other lanes and with everything else running). A read still open after this is a hang, and the
 *  snapshot is taken as it stands. */
const NET_WAIT_MS = 20_000;

/** Snapshot until two in a row agree (≤ ~3 s) and no read is in flight: async effects (a fetch, a
 *  timer) have landed. Reads that are still open extend the wait up to NET_WAIT_MS. */
async function stable(target: Page | Frame, lane: Lane, net: Net): Promise<DocSnap | null> {
  // After a write the shell keeps answering for a beat (the notice, the undo mode, the inspector's
  // fields): give it that beat before the first snapshot, or two equal early reads end the wait.
  if (net.wrote()) await sleep(1500);
  let prev = await snapDoc(target, lane);
  const t0 = Date.now();
  for (let i = 0; i < 12 || (net.pending().length && Date.now() - t0 < NET_WAIT_MS); i++) {
    await sleep(250);
    const next = await snapDoc(target, lane);
    if (next && prev && next.lines.join('\n') === prev.lines.join('\n') && !net.pending().length)
      return next;
    prev = next;
  }
  return prev;
}

function lineDiff(a: string[], b: string[]): { added: string[]; removed: string[] } {
  const count = new Map<string, number>();
  for (const l of a) count.set(l, (count.get(l) ?? 0) + 1);
  const added: string[] = [];
  for (const l of b) {
    const n = count.get(l) ?? 0;
    if (n > 0) count.set(l, n - 1);
    else added.push(l);
  }
  const removed: string[] = [];
  for (const [l, n] of count) for (let i = 0; i < n; i++) removed.push(l);
  return { added: added.sort(), removed: removed.sort() };
}

const SALIENT = /\[(data-testid|role|aria-|data-active-tool|data-state)|^@/;
function summarise(label: string, before: DocSnap | null, after: DocSnap | null): string[] {
  if (!before && !after) return [`  ${label}: (no document)`];
  if (!before || !after) return [`  ${label}: ${before ? 'document gone' : 'document appeared'}`];
  const { added, removed } = lineDiff(before.lines, after.lines);
  if (!added.length && !removed.length) return [`  ${label}: =`];
  const digest = createHash('sha256')
    .update(`${added.join('\n')}\n--\n${removed.join('\n')}`)
    .digest('hex')
    .slice(0, 10);
  const out = [`  ${label}: +${added.length} -${removed.length} #${digest}`];
  if (process.env.V1_KEYS_DUMP === '1') {
    for (const l of removed) out.push(`    DUMP- ${l}`);
    for (const l of added) out.push(`    DUMP+ ${l}`);
  }
  const pick = (ls: string[], sign: string) => {
    const sal = ls.filter((l) => SALIENT.test(l));
    for (const l of sal.slice(0, 8)) out.push(`    ${sign} ${l.slice(0, 160)}`);
    if (sal.length > 8) out.push(`    ${sign} … ${sal.length - 8} more`);
  };
  pick(removed, '-');
  pick(added, '+');
  return out;
}

async function readRec(target: Page | Frame | null): Promise<{ msgs: string[]; keys: string[] }> {
  if (!target) return { msgs: [], keys: [] };
  try {
    return await target.evaluate(() => {
      const r = (window as unknown as { __v1k?: { msgs: string[]; keys: KeyboardEvent[] } }).__v1k;
      if (!r) return { msgs: [], keys: [] };
      const keys = r.keys.map((e) => {
        const mods = `${e.ctrlKey ? '⌃' : ''}${e.altKey ? '⌥' : ''}${e.shiftKey ? '⇧' : ''}${e.metaKey ? '⌘' : ''}`;
        return `${mods}key=${JSON.stringify(e.key)} ${e.defaultPrevented ? 'PREVENTED' : 'default'}`;
      });
      return { msgs: r.msgs.slice(), keys };
    });
  } catch {
    return { msgs: [], keys: [] };
  }
}

async function msgCount(target: Page | Frame | null): Promise<number> {
  if (!target) return 0;
  try {
    return await target.evaluate(
      () => (window as unknown as { __v1k?: { msgs: unknown[] } }).__v1k?.msgs.length ?? 0
    );
  } catch {
    return -1;
  }
}

/** Wait until neither document has received a message for ~800 ms (≤ 8 s): the setup's own
 *  traffic (selection mirrors, layer trees, a late reload) must not land in the case's window. */
async function quiet(page: Page, frame: Frame | null) {
  let last = `${await msgCount(page)}/${await msgCount(frame)}`;
  let calm = 0;
  for (let i = 0; i < 20 && calm < 2; i++) {
    await sleep(400);
    const now = `${await msgCount(page)}/${await msgCount(frame)}`;
    calm = now === last ? calm + 1 : 0;
    last = now;
  }
}

async function clearRec(target: Page | Frame | null) {
  if (!target) return;
  try {
    await target.evaluate(() => {
      const r = (window as unknown as { __v1k?: { msgs: unknown[]; keys: unknown[] } }).__v1k;
      if (r) {
        r.msgs.length = 0;
        r.keys.length = 0;
      }
    });
  } catch {
    /* gone */
  }
}

// Messages that tick on their own (no key involved) and would make the record flaky. The selection
// mirror (select-set ⇄ select-by-id, layers-tree) echoes at its own pace; a selection a key changes
// still shows in the canvas DOM diff (the halo) and the shell's inspector. `toolbar-rect` (V2-4.5a) is the
// toolbar island's geometry, posted at most once a frame after layout, so where it lands in the stream is
// frame timing; a key that changes the toolbar still shows in the canvas DOM diff (`toolbar-slot-*`).
const NOISE =
  /^(child|parent|self) (presence|cursor|camera|viewport-state|hover|perf|heartbeat|canvas-rects|select-set|select-by-id|layers-tree|request-layers|toolbar-rect|canvas-mounted|canvas-notice|run-action id=presence\.context)\b/;

/** The message kinds whose arrival inside the snapshot window is a race (see runCase). */
const VOLATILE =
  /^(?:child|parent) (artboards|undo-key|undo-mode|viewport-zoom|peers|mode-changed|hold-view|set-mode|occluded-insets|timeline-request-comps|ds-update-dots|locked-set)\b/;
/** The toast's DOM is volatile for the same reason; its message (`canvas-notice`) is NOISE: whether it lands in the window is a race. */
const VOLATILE_DOM =
  /maude-notice|canvases-ds-row-warn|^(?:ol \[tabindex="-1"\]|li \[tabindex="0"\]|div)$/;
// ^ `canvases-ds-row-warn` is the pinned design-system row's "Made before the schema" chip (S10.13): it
// appears when the system check answers, a beat after the panel, so a case may or may not catch it. The second half: a toast-shaped element (`ol[tabindex=-1] > li[tabindex=0] > div > div`, no class, no testid, no
// text; not identified) that is on screen at the start of a case when the machine is loaded and gone by its end, so
// `+0 -4` / `-4` came and went between runs. An attribute-less empty `div` carries nothing the fingerprint could use.

async function runCase(browser: Browser, lane: Lane, c: Case): Promise<string> {
  if (resetFixture(lane)) await sleep(2500); // let the watcher fire before the page loads
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
    locale: 'en-US',
  });
  const writes: string[] = [];
  let recording = false;
  try {
    await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    // Pending What's New entries are dev-only and always unseen — v1 is the released feed
    // (same filter as scripts/check-v1-characterization.mjs).
    await context.route(`${lane.origin}/_api/whats-new`, async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { entries?: Array<{ version?: string | null }> };
      const entries = (body.entries ?? []).filter((e) => e?.version != null);
      await route.fulfill({ response: res, json: { ...body, entries } });
    });
    if (c.shell === 'viewer' || c.shell === 'tauri-viewer') {
      await context.route(`${lane.origin}/_config`, async (route) => {
        const res = await route.fetch();
        const body = await res.json();
        await route.fulfill({ response: res, json: { ...body, readOnly: true } });
      });
    }
    await context.addInitScript(RECORDER);
    if (c.shell === 'tauri' || c.shell === 'tauri-viewer') await context.addInitScript(TAURI_STUB);
    context.on('request', (r) => {
      if (!recording) return;
      const m = r.method();
      if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return;
      try {
        const u = new URL(r.url());
        writes.push(`${m} ${u.origin === lane.origin ? '' : '(canvas)'}${u.pathname}`);
      } catch {
        writes.push(`${m} ?`);
      }
    });
    const net = trackNetwork(context);
    let jitter = false;
    if (process.env.V1_KEYS_JITTER) {
      const max = Number(process.env.V1_KEYS_JITTER);
      await context.route(/\/_api\//, async (route) => {
        if (jitter && route.request().method() === 'GET') await sleep(Math.random() * max);
        await route.fallback();
      });
    }
    const page = await context.newPage();
    await page.goto(lane.url, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForFunction(
      () => (document.getElementById('root')?.childElementCount ?? 0) > 0,
      null,
      {
        timeout: 30_000,
      }
    );
    await settle(page, 600);
    await stable(page, lane, net);
    jitter = true;
    await runSetup(page, lane, c);
    await placeFocus(page, lane, c);

    await quiet(page, canvasFrame(page, lane));
    const frame0 = canvasFrame(page, lane);
    const shellBefore = await stable(page, lane, net);
    const LATE: string[] = [];
    if (process.env.V1_KEYS_LATE === '1') {
      await sleep(1500);
      const again = await snapDoc(page, lane);
      if (again && shellBefore && again.lines.join('\n') !== shellBefore.lines.join('\n')) {
        const d = lineDiff(shellBefore.lines, again.lines);
        for (const l of d.removed) LATE.push(`    LATE-before- ${l}`);
        for (const l of d.added) LATE.push(`    LATE-before+ ${l}`);
      }
    }
    const canvasBefore = frame0 ? await stable(frame0, lane, net) : null;
    await clearRec(page);
    await clearRec(frame0);
    recording = true;
    await page.keyboard.press(c.keys);
    await settle(page, 400);
    // Let async effects land: wait until two snapshots in a row agree (bounded).
    const shellAfter = await stable(page, lane, net);
    if (process.env.V1_KEYS_LATE === '1') {
      await sleep(2000);
      const again = await snapDoc(page, lane);
      if (again && shellAfter && again.lines.join('\n') !== shellAfter.lines.join('\n')) {
        const d = lineDiff(shellAfter.lines, again.lines);
        for (const l of d.removed) LATE.push(`    LATE-after- ${l}`);
        for (const l of d.added) LATE.push(`    LATE-after+ ${l}`);
      }
    }
    const frame1 = canvasFrame(page, lane);
    const canvasAfter = frame1 ? await stable(frame1, lane, net) : null;
    recording = false;
    const shellRec = await readRec(page);
    const canvasRec = await readRec(frame1);

    const lines = [`## ${c.id}`];
    const events = [
      ...shellRec.keys.map((k) => `shell ${k}`),
      ...(frame1 === frame0 ? canvasRec.keys.map((k) => `canvas ${k}`) : []),
    ];
    lines.push(`  keydown: ${events.length ? events.join(' · ') : '(none)'}`);
    // Timing-volatile kinds (decision v2-lead-v1-keys-normalise-volatile): whether the undo toast, the
    // artboard list and the undo-stack messages land inside the snapshot window differs run to run, so
    // they are recorded as presence — sorted, de-duplicated, no order, no count — after the stable lines.
    const dropUndoMode = (m: string) => !(net.wrote() && /^(?:child|parent) undo-mode\b/.test(m));
    const split = (all: string[]) => {
      const msgs = all.filter(dropUndoMode);
      const stable: string[] = [];
      const volatile = new Set<string>();
      for (const m of msgs) {
        // the whole message (kind + its arguments, direction dropped) is the presence token, so a
        // `set-mode mode=viewing` stays distinguishable from `set-mode mode=edit`
        if (VOLATILE.test(m)) volatile.add(m.replace(/^(?:child|parent) /, ''));
        else stable.push(m);
      }
      return { stable, volatile: [...volatile].sort() };
    };
    const toShell = split(shellRec.msgs.filter((m) => !m.startsWith('self ') && !NOISE.test(m)));
    const toCanvas = split(canvasRec.msgs.filter((m) => m.startsWith('parent ') && !NOISE.test(m)));
    const withVolatile = (x: { stable: string[]; volatile: string[] }) =>
      [...x.stable, ...(x.volatile.length ? [`{${x.volatile.join(',')}}`] : [])].join(' · ');
    lines.push(
      `  to-shell: ${toShell.stable.length || toShell.volatile.length ? withVolatile(frame1 !== frame0 ? { ...toShell, stable: [...new Set(toShell.stable)] } : toShell) : '(none)'}`
    );
    lines.push(
      `  to-canvas: ${frame1 !== frame0 ? `(canvas reloaded) ${[...new Set(toCanvas.stable)].join(' · ')}`.trim() : toCanvas.stable.length || toCanvas.volatile.length ? withVolatile(toCanvas) : '(none)'}`
    );
    // ⌘R reloads the canvas, and the boot re-fit may PATCH the camera while it settles (decision
    // v2-4.3b-boot-refit-does-not-persist says it should not, but it lands in some runs and not in
    // others on a loaded machine): that write is the reload's, not the key's, so the ⌘R cases leave
    // it out. A key that really moves the camera (zoom, mode) is not a reload and keeps it.
    const recorded =
      c.keys === 'Meta+r' ? writes.filter((w) => w !== 'PATCH (canvas)/_api/canvas-meta') : writes;
    lines.push(
      `  writes: ${recorded.length ? [...new Set(recorded)].sort().join(' · ') : '(none)'}`
    );
    // A case that wrote through an edit-op / duplicate-element (decision v2-lead-v1-keys-normalise-volatile):
    // whether the inspector's X / Y / W / H fields show the new numbers inside the snapshot window is a race,
    // so those fields are recorded as present, without their values; `undo-mode` is dropped for the same reason.
    const maskNums = (d: DocSnap | null): DocSnap | null =>
      d && net.wrote()
        ? {
            ...d,
            lines: d.lines.map((l) =>
              /spinbutton|insp-num|st-cp-numin/.test(l)
                ? l.replace(/\{value="[^"]*"\}/, '{value}')
                : l
            ),
          }
        : d;
    // After a write the shell's Inspector re-renders on its own clock (layout rows, chips, numbers), so a
    // write case pins the keydown, the messages and the write, not the shell DOM diff — the Inspector after a
    // write is pinned by the v2-inspector-* tests (decision v2-lead-v1-keys-write-cases-skip-shell-dom).
    lines.push(
      ...(net.wrote()
        ? [
            '  shell: (after a write — the Inspector re-render is pinned by the v2-inspector-* tests)',
          ]
        : summarise('shell', maskNums(shellBefore), maskNums(shellAfter)))
    );
    lines.push(...LATE);
    lines.push(
      ...(frame1 !== frame0 && frame0 && frame1
        ? ['  canvas: (reloaded)']
        : summarise('canvas', maskNums(canvasBefore), maskNums(canvasAfter)))
    );
    return lines.join('\n');
  } finally {
    await context.close();
  }
}

// ── the test ──────────────────────────────────────────────────────────────────────────────
// On demand since the wave-A gate (decision v2-lead-v1-keys-on-demand): after wave A the async message
// stream (undo barriers, notices, reloads) differs run to run even with presence-normalising, so this
// Phase-0 safety net runs at phase gates (MAUDE_V1_KEYS=1, or V1_KEYS_UPDATE=1) and not in every suite run.
// Key behaviour in the default suite is pinned by the registry tests (tool-keys, actions-uniqueness,
// actions-v1-parity, keys-docs, gate-keys).
const RUN_V1_KEYS = UPDATE || process.env.MAUDE_V1_KEYS === '1';
test.skipIf(!RUN_V1_KEYS)(
  'v1 keys: every pinned (setup, focus, key) case behaves as the golden says',
  async () => {
    const require = createRequire(join(STUDIO, 'package.json'));
    const { chromium } = require('playwright') as typeof import('playwright');
    if (!existsSync(join(STUDIO, 'dist', 'client.bundle.js')))
      throw new Error('no dist/client.bundle.js — build the client first');
    const all = buildCases();
    const ids = new Set<string>();
    for (const c of all) {
      if (ids.has(c.id)) throw new Error(`duplicate case ${c.id}`);
      ids.add(c.id);
    }
    const cases = ONLY ? all.filter((c) => ONLY.some((p) => c.id.startsWith(p))) : all;
    if (!ONLY && LANES !== GOLDEN_LANES)
      throw new Error(
        `the golden is dealt over ${GOLDEN_LANES} lanes (V1_KEYS_LANES=${LANES}): which case runs on a fresh vs a used server is part of it. Use V1_KEYS_LANES=${GOLDEN_LANES}, or V1_KEYS_ONLY=<prefix> for a partial run.`
      );
    const root = mkdtempSync(join(tmpdir(), 'maude-v1-keys-'));
    const lanes: Lane[] = [];
    const browser = await chromium.launch({ headless: true });
    try {
      for (let n = 0; n < Math.min(LANES, cases.length); n++) lanes.push(await bootLane(n, root));
      const LANE_COUNT = lanes.length;
      const results: string[] = new Array(cases.length);
      await Promise.all(
        lanes.map(async (first) => {
          let lane = first;
          let gen = 0;
          for (let i = first.n; i < cases.length; i += LANE_COUNT) {
            const c = cases[i];
            let text: string;
            try {
              text = await runCase(browser, lane, c);
            } catch (err) {
              text = `## ${c.id}\n  ERROR ${String(err).split('\n')[0]}`;
            }
            results[i] = text;
            // A case that wrote (a source edit, a camera PATCH) leaves the server's watchers and
            // caches mid-flight; the next case on this lane gets a fresh server and fixture, so a
            // late reload can never land inside its window.
            if (!/\n {2}writes: \(none\)/.test(text)) {
              lane.server.kill('SIGTERM');
              lane = await bootLane(first.n, root, ++gen);
              lanes.push(lane);
            }
          }
        })
      );
      const bodyOf = () =>
        `# v1 key characterization — ${cases.length} cases (V2-2.4)\n${results.join('\n')}\n`;
      if (process.env.V1_KEYS_BODY_OUT) writeFileSync(process.env.V1_KEYS_BODY_OUT, bodyOf());
      // A case that differs from the golden is run again on a fresh server (V1_KEYS_RETRIES, default 2)
      // and passes when ANY attempt reproduces its golden block. A key that really behaves differently
      // differs every time; the zoom / selection-restore / transient-DOM timing of a loaded machine
      // (two consecutive full runs on the same tree disagreed on 5–13 of 240 cases, never the same ones)
      // does not. The first-pass bodies stay in V1_KEYS_BODY_OUT; a case that never matches fails as before.
      if (!UPDATE && !ONLY && existsSync(GOLDEN)) {
        const wanted = new Map<string, string>();
        for (const chunk of readFileSync(GOLDEN, 'utf8').split(/\n(?=## )/))
          if (chunk.startsWith('## '))
            wanted.set(chunk.slice(3, chunk.indexOf('\n')), chunk.replace(/\n$/, ''));
        const retries = Number(process.env.V1_KEYS_RETRIES ?? 2);
        for (let i = 0; i < cases.length; i++) {
          const want = wanted.get(cases[i].id);
          if (want === undefined || results[i] === want) continue;
          for (let attempt = 1; attempt <= retries && results[i] !== want; attempt++) {
            const lane = await bootLane(4, root, attempt); // PORT 4800+: clear of the 4 dealt lanes
            lanes.push(lane);
            try {
              results[i] = await runCase(browser, lane, cases[i]);
            } catch (err) {
              results[i] = `## ${cases[i].id}\n  ERROR ${String(err).split('\n')[0]}`;
            }
            lane.server.kill('SIGTERM');
          }
        }
      }
      const body = bodyOf();
      if (UPDATE) {
        mkdirSync(dirname(GOLDEN), { recursive: true });
        writeFileSync(GOLDEN, body);
        console.log(`wrote ${GOLDEN} (${cases.length} cases)`);
        return;
      }
      if (ONLY) {
        console.log(body);
        return;
      }
      const golden = existsSync(GOLDEN) ? readFileSync(GOLDEN, 'utf8') : '';
      if (golden !== body) {
        const gb = new Map<string, string>();
        for (const chunk of golden.split(/\n(?=## )/))
          if (chunk.startsWith('## ')) gb.set(chunk.slice(3, chunk.indexOf('\n')), chunk);
        const off = cases
          .map((c, i) => [c.id, results[i]] as const)
          .filter(([id, text]) => gb.get(id)?.replace(/\n$/, '') !== text)
          .map(([id]) => id);
        console.log(
          `v1-keys: ${off.length} case(s) differ from the golden:\n  ${off.join('\n  ')}`
        );
        const g = golden.split('\n');
        const b = body.split('\n');
        let i = 0;
        while (i < Math.max(g.length, b.length) && g[i] === b[i]) i++;
        let start = i;
        while (start > 0 && !g[start]?.startsWith('## ')) start--;
        console.log(
          `v1-keys: first difference at line ${i + 1}\n--- golden\n${g.slice(start, i + 8).join('\n')}\n+++ now\n${b.slice(start, i + 8).join('\n')}`
        );
        // V2-2.4 open item: this case's shell summary came out once (one capture run) with a
        // hash no later run reproduced (3 full runs and 5 lane replays matched the golden, no late
        // DOM change in any case, no observed line explains it). Name it, never pass it: a mismatch
        // stays red.
        const block = (lines: string[], id: string) => {
          const at = lines.indexOf(`## ${id}`);
          if (at < 0) return '';
          const end = lines.findIndex((l, k) => k > at && l.startsWith('## '));
          return lines.slice(at, end < 0 ? undefined : end).join('\n');
        };
        const META_D = 'browser/in-canvas-selected/canvas Meta+d';
        if (block(g, META_D) !== block(b, META_D))
          console.log(
            `v1-keys: ${META_D}: known one-off variant, rerun with V1_KEYS_DUMP=1 and attach the dump (V1_KEYS_BODY_OUT=<file> writes it)`
          );
      }
      expect(body).toBe(golden);
    } finally {
      await browser.close().catch(() => {});
      for (const lane of lanes) {
        try {
          lane.server.kill('SIGTERM');
        } catch {
          /* gone */
        }
      }
      await sleep(500);
      rmSync(root, { recursive: true, force: true });
    }
  },
  // ~8 min alone on the machine, 25–30+ min when other suites share it (a gate-b-keys run timed out at 30).
  60 * 60_000
);
