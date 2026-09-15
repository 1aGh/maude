// Config hot-reload — `/design:setup-ds` rewrites `.design/config.json`
// mid-session; the server must re-read it so a newly added canvas group
// (`system`) reaches /_index-data and scaffolded DS files show in the tree.
// reloadConfig mutates ctx.cfg IN PLACE so every `const { cfg } = ctx`
// capture sees the fresh values.
// RCA: .ai/logs/rca/issue-ds-scaffold-files-not-in-filetree-stale-config.md

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Context, createBus, reloadConfig } from '../context.ts';

/** The pre-scaffold e2e fixture shape — UI-only group, no design systems. */
const BOOT_CONFIG = {
  name: 'e2e-fixture',
  designRoot: '.design',
  canvasGroups: [{ label: 'UI kit', path: 'ui' }],
  designSystems: [],
};

/** What /design:setup-ds writes: system group + DS entry + tokens path. */
const SCAFFOLDED_CONFIG = {
  ...BOOT_CONFIG,
  tokensCssRel: 'system/kanban-glass/colors_and_type.css',
  canvasGroups: [
    { label: 'Design system', path: 'system' },
    { label: 'UI kit', path: 'ui' },
  ],
  designSystems: [{ name: 'kanban-glass', path: 'system/kanban-glass' }],
  defaultDesignSystem: 'kanban-glass',
};

function sandbox(): { root: string; designRoot: string } {
  const root = mkdtempSync(join(tmpdir(), 'cfg-reload-test-'));
  const designRoot = join(root, '.design');
  mkdirSync(designRoot, { recursive: true });
  writeFileSync(join(designRoot, 'config.json'), JSON.stringify(BOOT_CONFIG, null, 2));
  return { root, designRoot };
}

/** Mirrors what createContext builds at boot from BOOT_CONFIG. */
function mkCtx(root: string, designRoot: string): Context {
  return {
    cfg: {
      name: 'e2e-fixture',
      projectLabel: null,
      designRoot: '.design',
      canvasGroups: [{ label: 'UI kit', path: 'ui' }],
      designSystems: [],
      rootClass: 'app',
      themeDefault: 'dark',
      tokensCssRel: 'system/colors_and_type.css',
      teamAccentDefault: null,
      handoffTargets: [],
      newCanvasDir: 'ui',
      newComponentDir: 'ui/components',
      _source: '.design/config.json',
    },
    projectLabel: 'e2e-fixture Design',
    paths: {
      repoRoot: root,
      designRel: '.design',
      designRoot,
      serverInfoFile: join(designRoot, '_server.json'),
      activeFile: join(designRoot, '_active.json'),
      commentsDir: join(designRoot, '_comments'),
      canvasStateDir: join(designRoot, '_canvas-state'),
      historyDir: join(designRoot, '_history'),
      tokensUrlRel: '.design/system/colors_and_type.css',
      systemDirRel: 'system',
    },
    bus: createBus(),
  };
}

describe('reloadConfig', () => {
  test('a group added on disk reaches a boot-time captured cfg reference (the bug)', () => {
    const { root, designRoot } = sandbox();
    const ctx = mkCtx(root, designRoot);
    // What every module factory holds: the object reference, captured at boot.
    const captured = ctx.cfg;
    try {
      writeFileSync(join(designRoot, 'config.json'), JSON.stringify(SCAFFOLDED_CONFIG, null, 2));
      expect(reloadConfig(ctx)).toBe(true);
      // The capture sees the scaffolded groups — no restart needed.
      expect(captured.canvasGroups.map((g) => g.path)).toEqual(['system', 'ui']);
      expect(captured.designSystems?.[0]?.name).toBe('kanban-glass');
      // normalizeDesignSystems runs on reload too (derived per-DS tokens path).
      expect(captured.designSystems?.[0]?.tokensCssRel).toBe(
        'system/kanban-glass/colors_and_type.css'
      );
      expect(captured.defaultDesignSystem).toBe('kanban-glass');
      // Derived paths recompute in place.
      expect(ctx.paths.tokensUrlRel).toBe('.design/system/kanban-glass/colors_and_type.css');
      expect(ctx.paths.systemDirRel).toBe('system');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('an unchanged config reports false (no spurious nudges)', () => {
    const { root, designRoot } = sandbox();
    const ctx = mkCtx(root, designRoot);
    try {
      reloadConfig(ctx); // sync ctx.cfg to the on-disk file once
      expect(reloadConfig(ctx)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('invalid JSON mid-edit keeps the running config', () => {
    const { root, designRoot } = sandbox();
    const ctx = mkCtx(root, designRoot);
    try {
      writeFileSync(join(designRoot, 'config.json'), '{ "name": "half-writ');
      expect(reloadConfig(ctx)).toBe(false);
      expect(ctx.cfg.name).toBe('e2e-fixture');
      expect(ctx.cfg.canvasGroups.map((g) => g.path)).toEqual(['ui']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a deleted config keeps the running config (no downgrade to defaults)', () => {
    const { root, designRoot } = sandbox();
    const ctx = mkCtx(root, designRoot);
    try {
      unlinkSync(join(designRoot, 'config.json'));
      expect(reloadConfig(ctx)).toBe(false);
      expect(ctx.cfg.name).toBe('e2e-fixture');
      expect(ctx.cfg._source).toBe('.design/config.json');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('designRoot is not hot-reloadable — kept, rest of the change applies', () => {
    const { root, designRoot } = sandbox();
    const ctx = mkCtx(root, designRoot);
    try {
      writeFileSync(
        join(designRoot, 'config.json'),
        JSON.stringify({ ...BOOT_CONFIG, name: 'renamed', designRoot: 'designs' }, null, 2)
      );
      expect(reloadConfig(ctx)).toBe(true);
      expect(ctx.cfg.name).toBe('renamed');
      expect(ctx.cfg.designRoot).toBe('.design');
      expect(ctx.paths.designRel).toBe('.design');
      expect(ctx.projectLabel).toBe('renamed Design');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('linkedHub is boot-pinned — a live add is ignored, the rest applies', () => {
    const { root, designRoot } = sandbox();
    const ctx = mkCtx(root, designRoot);
    try {
      writeFileSync(
        join(designRoot, 'config.json'),
        JSON.stringify(
          {
            ...BOOT_CONFIG,
            name: 'renamed',
            linkedHub: { url: 'wss://evil.example', linkedAt: 1, syncTsx: true },
          },
          null,
          2
        )
      );
      expect(reloadConfig(ctx)).toBe(true);
      expect(ctx.cfg.name).toBe('renamed');
      expect(ctx.cfg.linkedHub).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('design-root escapes are clamped: bad group dropped, bad tokensCssRel reset', () => {
    const { root, designRoot } = sandbox();
    const ctx = mkCtx(root, designRoot);
    try {
      writeFileSync(
        join(designRoot, 'config.json'),
        JSON.stringify(
          {
            ...SCAFFOLDED_CONFIG,
            tokensCssRel: '../../../etc/passwd',
            canvasGroups: [
              { label: 'Escape', path: '../..' },
              { label: 'Abs', path: '/etc' },
              { label: 'UI kit', path: 'ui' },
            ],
            designSystems: [
              { name: 'evil', path: '../outside' },
              { name: 'kanban-glass', path: 'system/kanban-glass' },
            ],
          },
          null,
          2
        )
      );
      expect(reloadConfig(ctx)).toBe(true);
      expect(ctx.cfg.canvasGroups.map((g) => g.path)).toEqual(['ui']);
      expect(ctx.cfg.tokensCssRel).toBe('system/colors_and_type.css');
      expect(ctx.cfg.designSystems?.map((d) => d.name)).toEqual(['kanban-glass']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a config.json created after a defaults boot applies', () => {
    const { root, designRoot } = sandbox();
    const ctx = mkCtx(root, designRoot);
    // Simulate a boot without config.json (createContext fell back to defaults).
    unlinkSync(join(designRoot, 'config.json'));
    ctx.cfg._source = 'defaults';
    try {
      writeFileSync(join(designRoot, 'config.json'), JSON.stringify(SCAFFOLDED_CONFIG, null, 2));
      expect(reloadConfig(ctx)).toBe(true);
      expect(ctx.cfg._source).toBe('.design/config.json');
      expect(ctx.cfg.canvasGroups.map((g) => g.path)).toEqual(['system', 'ui']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// Plan T31/L16 — a managed desktop copy is declared from group PATHS alone:
// no labels, no design systems. The project's own answer (kept by the sync
// runtime in `_state/project-config.json`) fills those in, and only those.
describe('a linked copy fills in what the project says about itself', () => {
  const MANAGED = {
    name: 'StudyFi',
    designRoot: '.design',
    canvasGroups: [
      { label: 'ui', path: 'ui' },
      { label: 'system', path: 'system' },
    ],
    linkedHub: { url: 'http://127.0.0.1:1', linkedAt: 0 },
  };
  const PROJECT = {
    canvasGroups: [
      { label: 'Canvases', path: 'ui' },
      { label: 'Design system', path: 'system' },
    ],
    designSystems: [
      { name: 'studyfi-v3', path: 'system/studyfi-v3' },
      { name: 'evil', path: '../outside' },
      { name: 'elsewhere', path: 'brand/elsewhere' },
    ],
  };
  const setup = (config: object, project: object | null) => {
    const { root, designRoot } = sandbox();
    writeFileSync(join(designRoot, 'config.json'), JSON.stringify(config, null, 2));
    if (project) {
      mkdirSync(join(designRoot, '_state'), { recursive: true });
      writeFileSync(join(designRoot, '_state/project-config.json'), JSON.stringify(project));
    }
    const ctx = mkCtx(root, designRoot);
    reloadConfig(ctx);
    return { root, ctx };
  };

  test('labels and design systems arrive; an escape or an undeclared group does not', () => {
    const { root, ctx } = setup(MANAGED, PROJECT);
    try {
      expect(ctx.cfg.canvasGroups).toEqual([
        { label: 'Canvases', path: 'ui' },
        { label: 'Design system', path: 'system' },
      ]);
      expect(ctx.cfg.designSystems?.map((d) => d.name)).toEqual(['studyfi-v3']);
      expect(ctx.cfg.designSystems?.[0]?.tokensCssRel).toBe(
        'system/studyfi-v3/colors_and_type.css'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('what this copy chose itself wins', () => {
    const own = {
      ...MANAGED,
      canvasGroups: [
        { label: 'My screens', path: 'ui' },
        { label: 'system', path: 'system' },
      ],
      designSystems: [{ name: 'studyfi-v3', path: 'system/studyfi-v3', tokensCssRel: 'mine.css' }],
    };
    const { root, ctx } = setup(own, PROJECT);
    try {
      expect(ctx.cfg.canvasGroups[0]).toEqual({ label: 'My screens', path: 'ui' });
      expect(ctx.cfg.designSystems).toHaveLength(1);
      expect(ctx.cfg.designSystems?.[0]?.tokensCssRel).toBe('mine.css');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('an unlinked project ignores a stray cache', () => {
    const { linkedHub: _gone, ...unlinked } = MANAGED;
    const { root, ctx } = setup(unlinked, PROJECT);
    try {
      expect(ctx.cfg.canvasGroups[1]).toEqual({ label: 'system', path: 'system' });
      expect(ctx.cfg.designSystems ?? []).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
