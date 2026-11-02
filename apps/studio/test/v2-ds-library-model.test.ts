// S10.18c — the words of a linked team library (13 · ds-many-library, ds-many-linked): CONTRACT §3–§4 phrasing,
// singular and plural, and what is never shown (an e-mail address, markup, a host that is not a host).
import { describe, expect, test } from 'bun:test';
import {
  byWhen,
  cardKind,
  changeCount,
  changeLines,
  dialogTitle,
  hostOf,
  LIBRARY_WORDS,
  linkedRows,
  noGrantLine,
  refusalWords,
  relinkLead,
  relinkLine,
  updateBody,
  updatedWords,
  usedByLine,
  waitingLine,
  whoName,
} from '../client/v2/ds/library-model.js';

describe('counts', () => {
  test('Used by N projects · N updates waiting · Update from <system>? N changes', () => {
    expect(usedByLine(3)).toBe('Used by 3 projects');
    expect(usedByLine(1)).toBe('Used by 1 project');
    expect(usedByLine(null)).toBeNull(); // the hub tells members only: no number, no line
    expect(usedByLine(0)).toBeNull();
    expect(usedByLine(2.5)).toBeNull();
    expect(waitingLine(3)).toBe('3 updates waiting');
    expect(waitingLine(1)).toBe('1 update waiting');
    expect(waitingLine(0)).toBe('Up to date');
    expect(dialogTitle('Alligators', 3)).toBe('Update from Alligators? 3 changes');
    expect(dialogTitle('Alligators', 1)).toBe('Update from Alligators? 1 change');
    expect(updatedWords('gator', 4, 0)).toBe('Updated from gator. 4 canvases follow it.');
    expect(updatedWords('gator', 1, 2)).toBe(
      'Updated from gator. 1 canvas follows it; 2 left out keep the old look.'
    );
  });
});

describe('what is shown of a peer or a hub', () => {
  test('the hub is its host; anything else is nothing', () => {
    expect(hostOf('https://alligators.cloud.maude.sh')).toBe('alligators.cloud.maude.sh');
    expect(hostOf('http://127.0.0.1:4401')).toBe('127.0.0.1:4401');
    expect(hostOf('javascript:alert(1)')).toBe('');
    expect(hostOf('not a url')).toBe('');
    expect(cardKind({ hub: 'https://alligators.cloud.maude.sh' })).toBe(
      'Team library · alligators.cloud.maude.sh'
    );
    expect(cardKind({ hub: 'nope' })).toBe('Team library');
  });

  test('a name is text: no e-mail address, no control or bidi characters, bounded', () => {
    expect(whoName({ kind: 'person', name: 'Tereza' })).toBe('Tereza');
    expect(whoName({ kind: 'person', name: 'Tere‮za' })).toBe('Tereza');
    expect(whoName({ kind: 'person', name: 'tereza@studyfi.com' })).toBeNull();
    expect(whoName({ kind: 'ai', name: '' })).toBe('AI');
    expect(whoName({ kind: 'person' })).toBeNull();
    expect(whoName({ kind: 'person', name: 'x'.repeat(200) })?.length).toBe(64);
    expect(whoName(null)).toBeNull();
  });

  test('the lead default: only whoever linked it can update from their Mac', () => {
    expect(noGrantLine({ kind: 'person', name: 'Michal' })).toBe(
      'Only Michal can update this library from their Mac.'
    );
    expect(noGrantLine({ kind: 'person', name: 'michal@studyfi.com' })).toBe(
      'Only the person who linked it can update this library from their Mac.'
    );
    expect(noGrantLine(null)).not.toContain('@');
  });

  test('change lines are text; a trashed token, an added one and the components each read plainly', () => {
    const lines = changeLines({
      changes: [
        { css: '--radius', label: 'Corners', before: { light: '2px' }, after: { light: '6px' } },
        { css: '--win', label: '<b>Výhra</b>', before: null, after: { light: '#0a7d3b' } },
        {
          css: '--line-1',
          label: null,
          before: { light: '1px' },
          after: null,
          trashed: { replacement: '--line-2' },
        },
      ],
      components: true,
    });
    expect(lines.map((l) => l.text)).toEqual([
      '2px → 6px',
      'added · #0a7d3b',
      'moved to the trash',
      'changed',
    ]);
    expect(lines[1].name).toBe('<b>Výhra</b>'); // a string: React escapes it
    expect(changeCount({ changes: [{}, {}], components: true })).toBe(3);
    expect(changeCount({})).toBe(0);
    expect(byWhen({ kind: 'person', name: 'Tereza' }, 'yesterday')).toBe('By Tereza, yesterday.');
    expect(byWhen(null, null)).toBe('');
  });
});

describe('refusals', () => {
  test('a library error code is the person’s words', () => {
    expect(refusalWords('forbidden')).toBe(LIBRARY_WORDS.forbidden);
    expect(refusalWords('ds-library-unreachable')).toBe(LIBRARY_WORDS.offline);
    expect(refusalWords('unreachable')).toBe(LIBRARY_WORDS.offline);
    expect(refusalWords('ds-library-denied')).toBe(LIBRARY_WORDS.denied);
    expect(refusalWords('ds-library-invalid')).toBe(LIBRARY_WORDS.invalid);
    expect(refusalWords('ds-head-moved')).toBe(LIBRARY_WORDS.headMoved);
    expect(refusalWords('ds-library-moved')).toBe(LIBRARY_WORDS.headMoved);
    expect(refusalWords('ds-library-unsupported')).toBe(LIBRARY_WORDS.unsupported);
    expect(refusalWords('something-new')).toBe(LIBRARY_WORDS.failed);
  });
});

describe('the state rows and the update body', () => {
  test('only systems that carry a library are linked rows; a bad record is bounded, not trusted', () => {
    const rows = linkedRows({
      systems: [
        { name: 'studio', library: null },
        {
          name: 'gator',
          label: 'Alligators',
          head: 'a'.repeat(64),
          library: { hub: 'https://h.test', project: 'p', label: 'x'.repeat(500), upstreamHead: 7 },
        },
        { library: { hub: 'x' } },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].ds).toBe('gator');
    expect(rows[0].library.label.length).toBe(120);
    expect(rows[0].library.upstreamHead).toBeNull();
    expect(linkedRows(null)).toEqual([]);
  });

  test('the update says exactly what the review showed, plus each tick; a locked canvas is not sent', () => {
    const body = updateBody(
      { ds: 'gator', review: { expectHead: 'a'.repeat(64), upstream: 'b'.repeat(64) } },
      [
        { path: 'ui/A.tsx', locked: false, ticked: true },
        { path: 'ui/B.tsx', locked: false, ticked: false },
        { path: 'ui/C.tsx', locked: true, ticked: false },
      ]
    );
    expect(body).toEqual({
      action: 'update',
      ds: 'gator',
      expectHead: 'a'.repeat(64),
      upstream: 'b'.repeat(64),
      canvases: [
        { path: 'ui/A.tsx', ticked: true },
        { path: 'ui/B.tsx', ticked: false },
      ],
    });
  });
});

// gate-b-sec2 finding 2 — "Link again" names what the (possibly peer-written) record points at
describe('Link again names the library', () => {
  const lib = { hub: 'https://bravo.cloud.test', project: 'p_bravo', system: 'gator' };
  test('system, project, host and who set it last; never an e-mail address', () => {
    expect(relinkLine({ ...lib, linkedBy: { kind: 'person', name: 'Tereza' } })).toBe(
      'This Mac hasn’t linked gator from p_bravo on bravo.cloud.test. Tereza set this link last. Nothing is sent there until you paste its library link again.'
    );
    expect(relinkLine({ ...lib, linkedBy: { kind: 'person', name: 'eve@evil.test' } })).toBe(
      'This Mac hasn’t linked gator from p_bravo on bravo.cloud.test. Nothing is sent there until you paste its library link again.'
    );
    expect(relinkLine({ hub: 'nope' })).toBe(LIBRARY_WORDS.relink);
    expect(relinkLead(lib)).toBe(
      'Paste the library link of gator from p_bravo on bravo.cloud.test. A link to any other library links nothing.'
    );
    expect(refusalWords('ds-library-other')).toBe(
      'That link is for a different library. Nothing was linked.'
    );
  });
});
