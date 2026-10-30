// Decision maude/v2-p8-detach-keeps-format — the CLI's copy of the detach rule
// (`hubFormatToCarry`, cli/lib/design-link.mjs; the CLI is Node and cannot
// import format.ts) must agree with the studio's, which calls `projectFormat`.
// Both are run over the same mirrors: for every case the format the config
// keeps after the link is dropped equals the format `projectFormat` reported
// while the link stood (raise only).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hubFormatToCarry } from '../../../cli/lib/design-link.mjs';
import { asFormat, noteHubFormat, projectFormat } from '../format.ts';

const HUB = 'https://hub.example.com';
let designRoot = '';

beforeEach(() => {
  designRoot = mkdtempSync(join(tmpdir(), 'detach-fmt-parity-'));
  mkdirSync(designRoot, { recursive: true });
});
afterEach(() => rmSync(designRoot, { recursive: true, force: true }));

describe('CLI hubFormatToCarry == studio projectFormat', () => {
  const cases: Array<[string, unknown, number | null, string?]> = [
    ['absent config, mirror 2', undefined, 2],
    ['absent config, mirror 1', undefined, 1],
    ['absent config, no mirror', undefined, null],
    ['config 2, mirror 1', 2, 1],
    ['config 2, mirror 2', 2, 2],
    ['config 1, mirror 2', 1, 2],
    ['a mirror left by another hub', undefined, 2, 'https://other.example.com'],
    ['trailing slash on the link', undefined, 2, `${HUB}/`],
  ];
  for (const [name, cfgFormat, mirror, mirrorHub] of cases) {
    test(name, () => {
      if (mirror !== null) {
        noteHubFormat(designRoot, { hub: mirrorHub ?? HUB, formatVersion: mirror });
      }
      const cfg = { formatVersion: cfgFormat, linkedHub: { url: HUB } };
      const viaStudio = projectFormat({ cfg, paths: { designRoot } }).value;
      const carry = hubFormatToCarry(cfg, designRoot);
      expect(carry ?? asFormat(cfgFormat)).toBe(viaStudio);
    });
  }

  test('a link with no url carries nothing', () => {
    noteHubFormat(designRoot, { hub: HUB, formatVersion: 2 });
    expect(hubFormatToCarry({ linkedHub: {} }, designRoot)).toBeNull();
    expect(hubFormatToCarry({}, designRoot)).toBeNull();
  });
});
