// V2-1.12 §5.2 / §5.6 — the studio's format gate (apps/studio/format.ts):
// which format a project is in, who says so, when this build may edit it, the
// refusal, the allowlist and the `/_config` fields. (The live-studio half —
// a real boot answering 403 `detail: 'format'` — needs the http.ts wiring the
// lead lands from the V2-2.14 hand-back: `format-gate-studio.test.ts`.)

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  asFormat,
  FORMAT_COPY,
  type FormatCtx,
  formatConfigFields,
  formatGate,
  formatGateAllowsWrite,
  formatRefusalResponse,
  HUB_FORMAT_REL,
  noteHubFormat,
  projectFormat,
  readHubFormatCache,
  SUPPORTED_FORMAT,
} from '../format.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'format-gate-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const ctx = (cfg: FormatCtx['cfg']): FormatCtx => ({ cfg, paths: { designRoot: root } });
const HUB = 'https://hub.example';

describe('project format', () => {
  test('absent / invalid = 1', () => {
    for (const v of [undefined, null, 0, -1, 1.5, '2', true]) expect(asFormat(v)).toBe(1);
    expect(asFormat(2)).toBe(2);
  });

  test('local: config.json is the authority', () => {
    expect(projectFormat(ctx({}))).toEqual({ value: 1, source: 'config' });
    expect(projectFormat(ctx({ formatVersion: 2 }))).toEqual({ value: 2, source: 'config' });
  });

  test('linked: max(config, hub live ?? hub cached ?? 1)', () => {
    const c = ctx({ formatVersion: 1, linkedHub: { url: HUB } });
    expect(projectFormat(c)).toEqual({ value: 1, source: 'config' });
    noteHubFormat(root, { hub: HUB, formatVersion: 2, epoch: 5 });
    expect(projectFormat(c)).toEqual({ value: 2, source: 'hub' });
    expect(projectFormat(c, { hubFormat: 1 })).toEqual({ value: 1, source: 'config' }); // live wins over cache
    expect(
      projectFormat(ctx({ formatVersion: 2, linkedHub: { url: HUB } }), { hubFormat: 1 })
    ).toEqual({
      value: 2,
      source: 'config',
    });
  });

  test('the hub cache is raise-only per hub, and ignores another hub', () => {
    expect(noteHubFormat(root, { hub: `${HUB}/`, formatVersion: 2, epoch: 3 })).toBe(true);
    expect(noteHubFormat(root, { hub: HUB, formatVersion: 1, epoch: 4 })).toBe(false); // never lowered
    expect(readHubFormatCache(root, HUB)?.formatVersion).toBe(2);
    expect(
      noteHubFormat(root, { hub: HUB, formatVersion: 1, epoch: 6 }, { allowLower: true })
    ).toBe(true); // the owner's reverse
    expect(readHubFormatCache(root, HUB)).toMatchObject({ formatVersion: 1, epoch: 6 });
    expect(readHubFormatCache(root, 'https://other.example')).toBe(null);
    expect(JSON.parse(readFileSync(path.join(root, HUB_FORMAT_REL), 'utf8'))).toMatchObject({
      hub: HUB,
    });
  });
});

describe('the gate', () => {
  test(`this build edits only format ${SUPPORTED_FORMAT}`, () => {
    expect(formatGate(ctx({ formatVersion: 2 }))).toBe(null);
    expect(formatGate(ctx({}))).toEqual({ projectFormat: 1, supported: 2, source: 'config' });
    // the 1.x compat build is the same module with supported = 1
    expect(formatGate(ctx({ formatVersion: 2 }), { supported: 1 })).toEqual({
      projectFormat: 2,
      supported: 1,
      source: 'config',
    });
    expect(formatGate(ctx({}), { supported: 1 })).toBe(null);
  });

  test('newerOnly (the staged wiring): only a NEWER project is gated', () => {
    expect(formatGate(ctx({}), { newerOnly: true })).toBe(null);
    expect(formatGate(ctx({ formatVersion: 3 }), { newerOnly: true })).toEqual({
      projectFormat: 3,
      supported: 2,
      source: 'config',
    });
    expect(formatConfigFields(ctx({}), false, { newerOnly: true })).toMatchObject({
      readOnly: false,
      formatGate: null,
      formatVersion: 1,
    });
  });

  test('the refusal: 403, read-only + detail format, the copy by direction', async () => {
    const newer = formatRefusalResponse({ projectFormat: 2, supported: 1, source: 'hub' });
    expect(newer.status).toBe(403);
    expect(await newer.json()).toEqual({
      error: 'read-only',
      reason: 'read-only',
      detail: 'format',
      formatVersion: 2,
      message: 'This project now uses Maude 2. Update Maude to edit it.',
    });
    const older = await formatRefusalResponse({
      projectFormat: 1,
      supported: 2,
      source: 'config',
    }).json();
    expect(older.message).toBe(FORMAT_COPY.olderStatus);
  });

  test('the allowlist: read-only writes minus comments, plus the migrate route', () => {
    const base = {
      exact: new Set([
        '/_canvas-state',
        '/_api/ui-prefs',
        '/_api/export',
        '/_comments',
        '/_api/hub/link',
      ]),
      patterns: [/^\/_api\/comments\/[A-Za-z0-9_-]+\/reply$/],
    };
    expect(formatGateAllowsWrite('/_canvas-state', base)).toBe(true);
    expect(formatGateAllowsWrite('/_api/export', base)).toBe(true);
    expect(formatGateAllowsWrite('/_api/hub/link', base)).toBe(true);
    expect(formatGateAllowsWrite('/_comments', base)).toBe(false); // §9 Q3: look only
    expect(formatGateAllowsWrite('/_api/comments/c_1/reply', base)).toBe(false);
    expect(formatGateAllowsWrite('/_api/project/migrate', base)).toBe(true); // the way out
    expect(formatGateAllowsWrite('/_api/canvas', base)).toBe(false);
  });

  test('/_config fields: readOnly when gated, the reason names role over format', () => {
    expect(formatConfigFields(ctx({ formatVersion: 2 }), false)).toEqual({
      formatVersion: 2,
      formatGate: null,
      readOnly: false,
      readOnlyReason: null,
    });
    expect(formatConfigFields(ctx({}), false)).toMatchObject({
      readOnly: true,
      readOnlyReason: 'format',
    });
    expect(formatConfigFields(ctx({}), true)).toMatchObject({
      readOnly: true,
      readOnlyReason: 'role',
    });
    expect(formatConfigFields(ctx({ formatVersion: 2 }), true)).toMatchObject({
      readOnlyReason: 'role',
    });
  });
});
