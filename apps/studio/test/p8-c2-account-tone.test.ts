// p8-c2 account tone — ONE function for an account's colour on every surface (11 pn-home · pn-tab-b):
// Home's face, the Share cluster's chip/card and the tab strip's badge (tabs.rs `account_tone`, same table).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { accountFace } from '../client/home/home-model.js';
import { accountTone } from '../client/shell/account-tone.js';
import { accountCard, accountChip } from '../client/v2/shell/account-card-model.js';

// the table tabs.rs pins too (`account_tone` test)
const TABLE: Array<[string, string, string]> = [
  ['work', '', 'sky'],
  ['personal', '', 'yellow'],
  ['default', 'Personal', 'yellow'],
  ['w2', 'Work', 'sky'],
  ['x', 'Personal', 'yellow'],
];

describe('accountTone', () => {
  test('Work is sky, Personal is yellow — by id or by label', () => {
    for (const [id, label, tone] of TABLE) expect(accountTone(id, label)).toBe(tone);
  });
  test('any other account keeps one tone of the object palette', () => {
    const t = accountTone('e2e-b');
    expect(['lilac', 'yellow', 'sky', 'green', 'coral']).toContain(t);
    expect(accountTone('e2e-b')).toBe(t);
  });
});

describe('every surface asks the same function', () => {
  test('Home face · Share chip · account card', () => {
    expect(accountFace({ id: 'work', label: 'Work' }).tone).toBe('sky');
    expect(accountFace({ id: 'personal', label: 'Personal' }).tone).toBe('yellow');
    const chip = accountChip({
      native: true,
      connected: true,
      profile: { id: 'work', label: 'Work' },
      accounts: [{ id: 'work' }, { id: 'default' }],
    });
    expect(chip?.tone).toBe('sky');
    const card = accountCard({
      project: 'P',
      profile: { id: 'work', label: 'Work' },
      accounts: [
        { id: 'work', label: 'Work' },
        { id: 'personal', label: 'Personal' },
      ],
    });
    expect(card.current.tone).toBe('sky');
    expect(card.others[0].tone).toBe('yellow');
  });
  test('tabs.rs states the same table', () => {
    const rs = readFileSync(join(import.meta.dir, '../../desktop/src-tauri/src/tabs.rs'), 'utf8');
    for (const [id, label, tone] of TABLE) expect(rs).toContain(`("${id}", "${label}", "${tone}")`);
  });
});
