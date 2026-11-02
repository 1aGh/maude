// S6.15 — the v1 first-run doors are retired, and nothing they did is lost. Four tripwires:
//   1. no v2 path mounts the OnboardingWizard (app.jsx, the shell core, the Tauri bridge), and the Rust
//      side no longer reads MAUDE_FORCE_ONBOARDING or answers `app_is_first_run`;
//   2. every retired testid is marked `retired` in testids.json (and TESTIDS.md) with the place its job went;
//   3. every manifest entry of the wizard / the create-project dialog / the cloud device dialogs maps to a
//      real home in nothing-deleted.json (an existing row with `where`, or a registry action / hook);
//   4. a new project starts empty and the guides are one registry action away (scaffold-empty.test.ts holds
//      the files; this holds the registry side).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIONS_BY_ID } from '../actions/index.ts';

const STUDIO = join(import.meta.dir, '..');
const REPO = join(STUDIO, '..', '..');
const read = (rel: string, from = STUDIO) => readFileSync(join(from, rel), 'utf8');

describe('no v2 path mounts the wizard', () => {
  test('app.jsx, the shell core and the Tauri bridge carry no first-run branch', () => {
    const app = read('client/app.jsx');
    expect(app).not.toMatch(/OnboardingWizard/);
    expect(app).not.toMatch(/\bfirstRun\b/);
    expect(read('client/hooks/use-shell-core.jsx')).not.toMatch(/\bfirstRun\b|appIsFirstRun/);
    expect(read('client/github.js')).not.toMatch(/export const appIsFirstRun/);
  });

  test('the Rust shell does not read MAUDE_FORCE_ONBOARDING nor answer app_is_first_run', () => {
    const rust = 'apps/desktop/src-tauri';
    for (const f of ['src/lib.rs', 'src/app_state.rs']) {
      const src = read(`${rust}/${f}`, REPO);
      expect(src, f).not.toMatch(/env::var\(\s*"MAUDE_FORCE_ONBOARDING"/);
      expect(src, f).not.toMatch(/fn (app_is_first_run|is_first_run|welcome_project)\b/);
    }
    expect(read(`${rust}/src/lib.rs`, REPO)).not.toContain('app_state::app_is_first_run');
    expect(read(`${rust}/build.rs`, REPO)).not.toContain('app_is_first_run');
    expect(read(`${rust}/capabilities/default.json`, REPO)).not.toContain('allow-app-is-first-run');
  });
});

const WIZARD_HOOKS = [
  'onboarding-wizard',
  'onboarding-watch-intro',
  'ob-door-github',
  'ob-door-team',
  'ob-door-local',
  'ob-door-hub',
  'ob-back',
  'ob-github-create',
  'ob-local-setup',
  'ob-local-choose',
  'ob-device-modal',
  'ob-device-code',
  'welcome-artboard-content',
];

describe('retired testids say where their job went', () => {
  const hooks = JSON.parse(read('client/testids.json')) as Array<{
    hook: string;
    v2: string;
    notes?: string;
  }>;
  const md = read('client/TESTIDS.md');

  test.each(WIZARD_HOOKS)('%s is retired, with a home in its note', (hook) => {
    const h = hooks.find((x) => x.hook === hook);
    expect(h?.v2).toBe('retired');
    expect(h?.notes ?? '').toMatch(/Its job is now .+\./);
    const row = md.split('\n').find((l) => l.startsWith(`| \`${hook}\` |`));
    expect(row, hook).toBeDefined();
    expect(row).toContain('retired — S6.15');
  });
});

describe('nothing the doors did is lost (nothing-deleted)', () => {
  const nd = JSON.parse(read('client/v2/nothing-deleted.json')) as {
    rows: Array<{
      id: string;
      v2?: { where?: string; action?: string | null; testid?: string | null };
    }>;
    map: Record<string, string>;
  };
  const manifest = JSON.parse(read('client/v2/v1-manifest.json')) as {
    entries: Array<{ id: string; file: string }>;
  };
  const rows = new Map(nd.rows.map((r) => [r.id, r]));
  const hooks = new Set(
    (JSON.parse(read('client/testids.json')) as Array<{ hook: string }>).map((h) => h.hook)
  );
  const doors = manifest.entries.filter((e) =>
    /panels\/(OnboardingWizard|CreateProject)\.jsx$/.test(e.file)
  );

  test('the wizard and the create-project dialog have entries to map', () => {
    expect(doors.length).toBeGreaterThan(40);
  });

  test('every one of their entries maps to a home that exists', () => {
    const bad = doors.filter((e) => {
      const t = nd.map[e.id];
      if (!t) return true;
      if (t.startsWith('action:')) return !ACTIONS_BY_ID.has(t.slice(7));
      if (t.startsWith('testid:')) return !hooks.has(t.slice(7));
      const row = rows.get(t);
      return !(row?.v2?.where && (row.v2.action || row.v2.testid));
    });
    expect(bad.map((e) => e.id)).toEqual([]);
  });
});

describe('a new project starts empty and the guides are one action away', () => {
  test('help.add-guides is registered, gated at Can edit, and worded as the contract says', () => {
    const def = ACTIONS_BY_ID.get('help.add-guides');
    expect(def?.label).toBe('Add the guide canvases to this project');
    expect(def?.visible?.minRole).toBe('edit');
  });
});
