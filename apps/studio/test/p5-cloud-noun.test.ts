// P5 / TD8 (UX audit F07 · F36) — "Maude Cloud" is the one noun; a self-hosted hub shows its own name;
// Share on a local project leads with Move to Maude Cloud… and an export for the person who only needs a file.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { CLOUD_NAME, hubName, isMaudeCloud } from '../client/v2/cloud/cloud-name.js';
import { moveWords, advancedView } from '../client/v2/share/share-model.js';
import { movingWords } from '../client/v2/share/move-to-cloud.jsx';

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');

describe('the noun', () => {
  test('Maude Cloud for ours, the host for a self-hosted hub', () => {
    expect(CLOUD_NAME).toBe('Maude Cloud');
    expect(hubName('https://alligators.cloud.maude.sh')).toBe('Maude Cloud');
    expect(hubName('https://cloud.maude.sh/x')).toBe('Maude Cloud');
    expect(hubName('https://hub.example.org:8443')).toBe('hub.example.org');
    expect(hubName('')).toBe('');
    expect(isMaudeCloud('https://evil-cloud.maude.sh.example.org')).toBe(false);
  });

  test('the action row and the move words say Maude Cloud, never "the cloud"', () => {
    expect(ACTIONS_BY_ID.get('share.move-to-cloud')?.label).toBe('Move to Maude Cloud…');
    for (const s of [
      movingWords('ready'),
      movingWords('linking'),
      moveWords(404, null),
      moveWords(401, null),
      moveWords(500, null),
    ]) {
      expect(String(s)).not.toMatch(/\bthe cloud\b/i);
      expect(String(s)).not.toMatch(/to cloud\b/i);
    }
  });
});

describe('Share on a local project', () => {
  test('the offer leads with Move to Maude Cloud and keeps an export door for people who only need a file', () => {
    const src = read('client/v2/share/move-to-cloud.jsx');
    expect(src.includes('Move to Maude Cloud')).toBe(true);
    expect(src.includes('Export a PNG or PDF to send')).toBe(true);
    expect(src.includes('share-export-instead')).toBe(true);
  });

  test('a sheet that cannot move (a browser) still gives the export door and names Maude Cloud', () => {
    const src = read('client/v2/share/share-sheet.jsx');
    expect(src.includes('Invite people once it is in the cloud')).toBe(false);
    expect(src.includes('<ExportInstead')).toBe(true);
  });
});

describe('Share › Advanced', () => {
  test('a local project does not lead with loopback links, and the hint says so', () => {
    const local = advancedView({ view: { linked: false }, shell: 'native' });
    expect(local.hint).not.toBe('Links, link rules, sync');
    expect(local.hint).toMatch(/this Mac/i);
    expect(local.thisMacLast).toBe(true);
  });

  test('a linked hub shows its own name', () => {
    const v = {
      linked: true,
      reachable: true,
      access: { authority: 'hub', roles: ['owner', 'member'] },
    };
    expect(advancedView({ view: v, hubUrl: 'https://hub.example.org' }).syncsName).toBe(
      'hub.example.org'
    );
    expect(advancedView({ view: v, hubUrl: 'https://a.cloud.maude.sh' }).syncsName).toBe(
      'Maude Cloud'
    );
  });
});
