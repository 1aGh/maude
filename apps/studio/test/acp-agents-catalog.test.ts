import { describe, expect, test } from 'bun:test';

import { CATALOG, CLAUDE, agentById, isOfferable } from '../acp/agents/catalog.ts';
import { assertDescriptor, compareVersions, versionFit } from '../acp/agents/descriptor.ts';

describe('agent catalog', () => {
  test('Claude is first, claude-meta, and the only claude-meta entry', () => {
    expect(CATALOG[0]).toBe(CLAUDE);
    expect(CATALOG.filter((d) => d.policy === 'claude-meta').map((d) => d.id)).toEqual(['claude']);
  });

  test('ids are unique and resolvable', () => {
    const ids = CATALOG.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(agentById(id)?.id).toBe(id);
  });

  test('nothing is offerable until it is bridge-enforced; Claude never is', () => {
    expect(isOfferable(CLAUDE)).toBe(false);
    for (const d of CATALOG) {
      if (d.policy !== 'bridge-enforced') expect(isOfferable(d)).toBe(false);
    }
  });

  test('F6b: opencode passed the conformance probe and is offerable; Codex is not yet', () => {
    expect(CATALOG.filter(isOfferable).map((d) => d.id)).toEqual(['opencode']);
    expect(agentById('opencode')?.detect).toMatchObject({
      minVersion: '1.18.30',
      testedMax: '1.18.99',
    });
    expect(agentById('codex')?.policy).toBe('unrestricted');
  });

  test('a bridge-enforced descriptor without enforcement fails at load', () => {
    expect(() =>
      assertDescriptor({ ...CLAUDE, id: 'codex', policy: 'bridge-enforced', plugins: 'none' })
    ).toThrow(/enforcement/);
  });

  test('only claude-meta may carry plugins over _meta', () => {
    expect(() => assertDescriptor({ ...CLAUDE, id: 'codex', policy: 'unrestricted' })).toThrow(
      /_meta/
    );
  });
});

describe('versions', () => {
  test('compareVersions orders numerically', () => {
    expect(compareVersions('0.166.0', '0.154.0')).toBe(1);
    expect(compareVersions('1.18.30', '1.18.30')).toBe(0);
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1);
  });

  test('versionFit classifies against min and tested range', () => {
    const codex = agentById('codex');
    if (!codex) throw new Error('codex missing from the catalog');
    expect(versionFit(codex, '0.154.0')).toBe('too-old');
    expect(versionFit(codex, '0.166.2')).toBe('ok');
    expect(versionFit(codex, '0.170.0')).toBe('untested');
  });
});
