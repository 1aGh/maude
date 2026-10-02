// The owner's desktop sends its project config to the workspace (2026-10-02,
// alligators: a cell synced from a desktop had no config.json, ran on defaults,
// and canvases lost their brand fonts). Only a sanitized subset travels.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProjectConfigPusher, projectConfigSubset } from '../sync/project-config-push.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pcfg-push-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const CONFIG = {
  name: 'alligators',
  projectLabel: 'Brno Alligators',
  tokensCssRel: 'system/alligators/colors_and_type.css',
  canvasGroups: [{ label: 'UI kit', path: 'ui' }],
  designSystems: [{ name: 'alligators', path: 'system/alligators', description: 'x' }],
  defaultDesignSystem: 'alligators',
  linkedHub: { url: 'https://alligators.cloud.maude.sh', workspaceId: 'w' },
  handoffTargets: ['secret-ish'],
};

function hub(status = 200) {
  const sent: { url: string; auth: string | null; body: unknown }[] = [];
  const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
    sent.push({
      url: String(url),
      auth: new Headers(init?.headers as HeadersInit).get('authorization'),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify({ ok: true, changed: true }), { status });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

describe('projectConfigSubset', () => {
  test('names and contained paths only — never the linked hub', () => {
    const s = projectConfigSubset(CONFIG);
    expect(s).toEqual({
      name: 'alligators',
      projectLabel: 'Brno Alligators',
      tokensCssRel: 'system/alligators/colors_and_type.css',
      canvasGroups: [{ label: 'UI kit', path: 'ui' }],
      designSystems: [{ name: 'alligators', path: 'system/alligators' }],
      defaultDesignSystem: 'alligators',
    });
  });
});

describe('createProjectConfigPusher', () => {
  test('sends once with the token, then only when the config changes', async () => {
    writeFileSync(join(root, 'config.json'), JSON.stringify(CONFIG));
    const h = hub();
    const p = createProjectConfigPusher({
      designRoot: root,
      hubUrl: 'https://alligators.cloud.maude.sh',
      token: () => 'tok',
      fetchImpl: h.fetchImpl,
      log: { log() {}, warn() {} },
    });
    expect(await p.push()).toBe('sent');
    expect(await p.push()).toBe('unchanged');
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.url).toBe('https://alligators.cloud.maude.sh/api/project-config');
    expect(h.sent[0]?.auth).toBe('Bearer tok');
    expect(JSON.stringify(h.sent[0]?.body)).not.toContain('linkedHub');

    writeFileSync(join(root, 'config.json'), JSON.stringify({ ...CONFIG, projectLabel: 'Gators' }));
    expect(await p.push()).toBe('sent');
    expect(h.sent).toHaveLength(2);
  });

  test('a refusal or an older hub is not retried on every event', async () => {
    writeFileSync(join(root, 'config.json'), JSON.stringify(CONFIG));
    for (const status of [403, 404]) {
      const h = hub(status);
      const p = createProjectConfigPusher({
        designRoot: root,
        hubUrl: 'https://h.example',
        token: () => 'tok',
        fetchImpl: h.fetchImpl,
        log: { log() {}, warn() {} },
      });
      expect(await p.push()).toBe('refused');
      expect(await p.push()).toBe('unchanged');
      expect(h.sent).toHaveLength(1);
    }
  });

  test('a hub under a path prefix keeps it — the token never leaves the hub (review F4)', async () => {
    writeFileSync(join(root, 'config.json'), JSON.stringify(CONFIG));
    const h = hub();
    const p = createProjectConfigPusher({
      designRoot: root,
      hubUrl: 'https://test.studyfi.com/hub/',
      token: () => 'tok',
      fetchImpl: h.fetchImpl,
      log: { log() {}, warn() {} },
    });
    await p.push();
    expect(h.sent[0]?.url).toBe('https://test.studyfi.com/hub/api/project-config');
  });

  test('no config, nothing sent', async () => {
    const h = hub();
    const p = createProjectConfigPusher({
      designRoot: root,
      hubUrl: 'https://h.example',
      token: () => 'tok',
      fetchImpl: h.fetchImpl,
    });
    expect(await p.push()).toBe('nothing');
    expect(h.sent).toHaveLength(0);
  });
});
