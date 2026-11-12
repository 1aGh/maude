// Security review 2026-11-12 (defender warnings): the agent consent store's temp file must not be
// a predictable name a same-user process can plant a symlink at (writeFileSync follows it).

import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hasAgentConsent, recordAgentConsent } from '../acp/agents/consent.ts';

const root = mkdtempSync(join(tmpdir(), 'acp-consent-store-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test('a planted symlink at the old temp name is never written through', () => {
  const app = join(root, 'app');
  mkdirSync(app, { recursive: true });
  const file = join(app, 'agent-consent.json');
  const victim = join(root, 'victim.txt');
  writeFileSync(victim, 'UNTOUCHED');
  symlinkSync(victim, `${file}.${process.pid}.tmp`);
  const place = { projectRoot: join(root, 'proj'), file };
  recordAgentConsent(place, 'gemini');
  expect(readFileSync(victim, 'utf8')).toBe('UNTOUCHED');
  expect(hasAgentConsent(place, 'gemini')).toBe(true);
});
