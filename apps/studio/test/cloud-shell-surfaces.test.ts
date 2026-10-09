// Surfaces a cloud tab must not offer — Cloud Phase 27, found by using it.
//
// The phase's rule is C1's: role shapes what is OFFERED, never what is VISIBLE.
// That rule is about ROLES. A different question turned up the moment the real
// studio actually ran in a browser: what about a control whose feature cannot
// exist in THIS SHELL at all?
//
// Three answers, and the difference between them is the whole point:
//
//   the agent chat        ABSENT, WITH A NOTICE. It runs on your own Claude
//                         subscription on your own machine (DDR-123). The
//                         feature exists and you can have it — the menu row
//                         stays, disabled, saying where. (C2)
//
//   "Sign in to Maude     ABSENT, SILENTLY. It offers to do the thing you have
//    Cloud"               already done: you reached this tab THROUGH a Maude
//                         account. There is nothing to explain.
//
//   AI generation /       ABSENT, SILENTLY. These configure ffmpeg, mlx-vlm, a
//   Subtitles / Video     HuggingFace cache and your own provider keys — none
//                         of which a browser tab has, and whose routes a cell
//                         refuses by design (DDR-209 D1). Left in, they render
//                         as a wall of `HTTP 404`, which is what the owner saw.
//
// Source-level assertions, because the menubar's dropdowns do not open under a
// synthetic click and a test that cannot fail is worse than no test. What these
// pin is exactly what would regress: someone re-introducing `TABS.map` or
// dropping the gate on `<CloudBar />`.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  clientFiles,
  clientMatches,
  clientSource,
  fileContaining,
  fnBody,
} from './_client-source.ts';

const STUDIO = join(import.meta.dir, '..');
// The shell's code, whichever client file it lives in (app.jsx before the
// V2-0.2 split, its modules after) — see `_client-source.ts`.
const APP = clientSource();
const SETTINGS = readFileSync(join(STUDIO, 'client', 'panels', 'SettingsPanel.jsx'), 'utf8');

describe('the cloud shell offers nothing it cannot honour', () => {
  test('the local-machine settings tabs are flagged — and the list is exact', () => {
    // An exact list, not a `toContain`: the failure this guards is a tab that
    // configures machine-local state shipping to the cloud shell UNFLAGGED,
    // where its routes are refused by design (DDR-209 D1) and it renders as a
    // wall of 404s. A new tab has to be classified deliberately, which means
    // this assertion is SUPPOSED to fail when one is added.
    //
    // `figma` (DDR-216) is local-machine for the same reason `ai-generation`
    // is: the credential lives in `~/.config/maude/keys.json` on this machine,
    // and the import writes into this machine's design root.
    const flagged = [
      ...SETTINGS.matchAll(/\{ id: '([a-z-]+)', label: '[^']+', local: true \}/g),
    ].map((m) => m[1]);
    expect(flagged.sort()).toEqual(['ai-generation', 'figma', 'subtitles', 'video']);
  });

  test('the tab rail renders the FILTERED list, not the raw table', () => {
    // `TABS.map` is what shipped the wall of 404s.
    expect(SETTINGS).toContain('{tabs.map((t) => (');
    expect(SETTINGS).not.toContain('{TABS.map(');
    // …and every keyboard path must walk the same list, or End/Home select a
    // tab that is not on screen.
    expect(SETTINGS).not.toMatch(/setTab\(TABS\[/);
    expect(SETTINGS).toContain('const tabs = useMemo(');
  });

  test('a remembered tab this shell does not have cannot select nothing', () => {
    // Open Video on the desktop, then open Settings in the cloud.
    const init =
      /const \[tab, setTab\] = useState\(\(\) => \{[\s\S]*?\}\);/.exec(SETTINGS)?.[0] ?? '';
    expect(init).toContain('!(cloud && t.local)');
  });

  test('the cloud sign-in is not offered inside the cloud', () => {
    // `=== null`, not falsiness. `cloud` is undefined until `/_config` answers,
    // and treating unknown as "not cloud" mounted this bar for one frame in
    // every cloud tab — long enough to fire the one request the cell refuses.
    // Matched on the GUARD rather than the whole element, so adding a prop to
    // CloudBar (DDR-214 drilled the live sync payload in) does not read as a
    // regression in a rule that is entirely about `=== null`.
    expect(
      clientMatches(/\{cloud === null \?\s*\(?\s*<CloudBar[^>]*\/>\s*\)?\s*: null\s*\}/)
    ).not.toEqual([]);
    expect(APP).not.toMatch(/\{cloud \?\s*null\s*:\s*\(?\s*<CloudBar/);
  });

  test('the local export queue does not hydrate before the shell is known', () => {
    // Asserted as the RULE, not as one exact call expression. This pinned the
    // literal `useExportCenter({ enabled: cfg.cloud === null })`, so when the
    // remote export lane legitimately widened the guard to
    // `cfg.cloud === null || cfg.exportLane === 'remote'` (and prettier split it
    // over three lines), the test went red against correct code and stayed red
    // on main — a guard rule that cries at every edit teaches people to edit the
    // test, which is how the rule dies.
    //
    // What actually matters, and what the sibling CloudBar test above spells
    // out: the gate is `=== null`, never truthiness. `cfg.cloud` is `undefined`
    // until `/_config` answers, and treating unknown as "not cloud" is the bug —
    // it hydrates the local queue for one frame inside a cloud tab. (The
    // `exportLane` disjunct is safe for the same reason it is invisible here:
    // it arrives in the SAME `/_config` payload, so it is undefined for exactly
    // as long as `cloud` is.)
    // Every CALL in the client — `export function useExportCenter({ enabled = true } = {})`
    // in export-center.jsx is the hook's own signature, not a call site.
    const calls = clientFiles().flatMap((f) =>
      [...f.src.matchAll(/useExportCenter\(\{[\s\S]*?\}\)/g)]
        .filter((m) => !f.src.slice(0, m.index).endsWith('function '))
        .map((m) => m[0])
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).toContain('cfg.cloud === null');
      expect(call).not.toMatch(/enabled:\s*!cfg\.cloud/);
      expect(call).not.toMatch(/enabled:\s*cfg\.cloud\s*[?&|]/);
    }
  });

  test('every component that gates on the shell is actually GIVEN the flag', () => {
    // The bug this exists for: three `cfg?.cloud` reads inside a component that
    // never receives `cfg` — a ReferenceError at render, and a blank app.
    for (const call of ['<Menubar', '<Sidebar', '<SettingsPanel']) {
      // Sliced inside the one file that renders it, so the window never runs
      // past the end of that file into the next.
      const { src } = fileContaining(call);
      const at = src.indexOf(call);
      expect(at).toBeGreaterThan(0);
      const props = src.slice(at, at + 900);
      // Passed RAW — a `?? null` here would erase the "not known yet" state
      // before any component could see it.
      expect(props).toContain('cloud={cfg.cloud}');
    }
  });

  test('no component reaches for `cfg` where only the flag was passed', () => {
    // `cfg` is a real variable at the top level, so a stray reference in a
    // child component is a ReferenceError the bundler happily emits.
    for (const name of ['Menubar', 'Sidebar']) {
      // Bounded window: the component's own body, not the whole file —
      // wherever that component is defined.
      const body = fnBody(name);
      expect(body.startsWith(`function ${name}({`)).toBe(true);
      expect(body).not.toMatch(/\bcfg\?\./);
      expect(body).not.toMatch(/\bcfg\./);
    }
  });
});

describe('"not known yet" survives every layer between /_config and the DOM', () => {
  // The three-line bug: the call sites were fixed to pass `cfg.cloud` raw, and
  // the components still declared `cloud = null` as a default parameter. A
  // default fires on `undefined` — so "we have not asked yet" turned back into
  // "this is not the cloud" one layer further in, the sign-in bar mounted for a
  // frame, and the boot 404 came back looking exactly like the one just fixed.
  // Checked in EVERY client module (app.jsx and SettingsPanel.jsx were the two
  // named here; a component split out of app.jsx must stay covered wherever it
  // lands), except the one panel whose `cloud = null` default is pinned on
  // purpose by sync-panel-surface.test.ts ("it is ABSENT in the cloud").
  const DEFAULTS_ON_PURPOSE = new Set(['panels/SyncPanel.jsx']);

  test('no component defaults the shell flag', () => {
    for (const { path, src } of clientFiles()) {
      if (DEFAULTS_ON_PURPOSE.has(path)) continue;
      expect(src, path).not.toMatch(/^\s*cloud = (null|false|\{\}),$/m);
    }
  });
});

describe('the way back out exists only where there is somewhere to go', () => {
  // A self-hosted `maude hub workspace` is workspace mode too — the whole
  // point of "one studio, three shells" — so it gets the `cloud` block, the
  // stated agent absence, the account chip and the sign-out. What it does NOT
  // have is a dashboard: one hub serves one project, and `HUB_DASHBOARD_URL`
  // is written only by the managed fleet (cli/lib/cell-plan.mjs).
  //
  // Both sides had defaulted that URL to the vendor's SaaS, so the ONE way out
  // a browser tab offers walked every self-hoster off their own deployment
  // onto cloud.maude.sh — a dead end for an account most of them do not have.
  // Fixing the server alone would not have fixed the button; the client
  // carried its own copy of the same fallback.
  test('the client never names the vendor as a fallback destination', () => {
    // The literal is the bug. `dashboardUrl` is either configured or absent.
    // Checked in every client module except the two desktop sign-in panels,
    // whose default sign-in target IS the managed cloud (not a "way back out").
    const SIGN_IN_TARGET = new Set(['panels/CloudBar.jsx', 'panels/TeamProjects.jsx']);
    for (const { path, src } of clientFiles()) {
      if (SIGN_IN_TARGET.has(path)) continue;
      expect(src, path).not.toContain("'https://cloud.maude.sh'");
    }
  });

  test('the ← Dashboard anchor is gated on the URL, not on the shell', () => {
    const { src } = fileContaining('data-testid="cloud-back"');
    const at = src.indexOf('data-testid="cloud-back"');
    expect(at).toBeGreaterThan(0);
    const block = src.slice(at, at + 1200);
    expect(block).toContain('{cloud.dashboardUrl ? (');
    expect(block).toContain('href={cloud.dashboardUrl}');
    // The project name is NOT gated with it: a tab must still say which
    // project it is showing, dashboard or no dashboard.
    expect(block).toContain('data-testid="cloud-project-name"');
  });

  test('the server sends the field only when it is configured', () => {
    const HTTP = readFileSync(join(STUDIO, 'http.ts'), 'utf8');
    // Conditional spread — the same shape `canvasToken` uses two fields down,
    // so an absent value is absent rather than a string nobody can act on.
    expect(HTTP).toContain(
      '...(process.env.HUB_DASHBOARD_URL\n                  ? { dashboardUrl: process.env.HUB_DASHBOARD_URL }\n                  : {}),'
    );
    expect(HTTP).not.toContain("HUB_DASHBOARD_URL ?? 'https://cloud.maude.sh'");
  });
});
