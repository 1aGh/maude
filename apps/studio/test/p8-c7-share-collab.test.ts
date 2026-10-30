// P8 C7 (10 Share and Collaboration) — the words and rules the fidelity pass changed, as plain tests.
import { describe, expect, test } from 'bun:test';
import { menuPlace } from '../client/v2/share/role-menu.jsx';
import {
  advancedView,
  countLine,
  invitedAgo,
  linkRowWords,
  peopleRows,
  restLine,
  teamRow,
} from '../client/v2/share/share-model.js';
import { faceLetter, facesOf } from '../client/v2/shell/save-status.js';
import { conflictCard, whenWords } from '../client/v2/sync-states/sync-states-model.js';

const NOW = Date.UTC(2026, 9, 18, 12);
const DAY = 86_400_000;

describe('Share sheet rows', () => {
  test('a person wears their tone and ONE letter; You is yellow with no sub-line', () => {
    const rows = peopleRows(
      [
        { id: 'a', name: 'Michal', email: 'm@x.cz', role: 'owner' },
        { id: 'b', name: 'Tereza', email: 't@x.cz', role: 'member' },
      ],
      { youEmail: 'm@x.cz', now: NOW }
    );
    expect(rows[0]).toMatchObject({ name: 'You', tone: 'yellow', initial: 'M', sub: '' });
    expect(rows[1].initial).toBe('T');
    expect(['sky', 'green', 'lilac', 'grey', 'yellow']).toContain(rows[1].tone);
  });
  test('an invitation says when it went out and when it ends', () => {
    const [r] = peopleRows(
      [
        {
          id: 'i',
          name: 'Petra',
          role: 'viewer',
          state: 'invited',
          invitedAt: NOW - 2 * DAY,
          expiresAt: NOW + 5 * DAY - 1000,
        },
      ],
      { now: NOW }
    );
    expect(r.sub).toBe('Invited 2 days ago · expires in 5 days');
    expect(invitedAgo(undefined, NOW)).toBe('');
  });
  test('the team row is the rest of the project, with its count line', () => {
    const canvas = [{ id: 'a', role: 'owner' }];
    const project = [
      { id: 'a', role: 'owner' },
      { id: 'b', role: 'member' },
      { id: 'c', role: 'viewer' },
    ];
    const t = teamRow(canvas, project, 'Alligators brand');
    expect(t).toMatchObject({
      name: 'Everyone in Alligators brand',
      sub: '2 people · change it in Whole project',
      role: 'viewer',
    });
    expect(restLine(t, 'Alligators brand')).toBe('+ 2 in Alligators brand');
    expect(teamRow(project, project, 'x')).toBeNull();
    expect(countLine([{ invited: false }, { invited: true }])).toBe('1 person · 1 invited');
  });
  test('the link row says the role; the fold hint is the board’s', () => {
    expect(linkRowWords({ who: 'team', project: 'Alligators brand' }).sub).toBe('Can view');
    expect(
      advancedView({ view: { linked: true, access: { authority: 'control-plane', roles: [] } } })
        .hint
    ).toBe('Links, link rules, sync');
  });
  test('the role menu flips above its button when there is no room below', () => {
    const anchor = { top: 700, bottom: 720, right: 400, left: 300 };
    const p = menuPlace(anchor, { width: 296, height: 280 }, { width: 1440, height: 800 });
    expect(p.flip).toBe(true);
    expect(p.top).toBeLessThan(anchor.top);
    expect(
      menuPlace(
        { top: 50, bottom: 70, right: 400, left: 300 },
        { width: 296, height: 280 },
        { width: 1440, height: 800 }
      ).flip
    ).toBe(false);
  });
});

describe('faces', () => {
  test('one letter, never "YO"; the AI carries none', () => {
    expect(faceLetter('1aGh')).toBe('1');
    const f = facesOf({ you: undefined, agentActive: true });
    expect(f[0].initials).toBe('Y');
    expect(f[1]).toMatchObject({ agent: true, initials: '' });
  });
});

describe('sync words', () => {
  test('an absolute time is "6 Oct, 14:05" (CONTRACT §4)', () => {
    const t = new Date(2026, 9, 6, 14, 5).getTime();
    expect(whenWords(t, new Date(2026, 9, 18, 12).getTime())).toBe('6 Oct, 14:05');
  });
  test('the conflict names who, when and whose Mac; a removal is "removed", never "deleted"', () => {
    const at = new Date(2026, 9, 18, 7, 55).getTime();
    const now = new Date(2026, 9, 18, 12).getTime();
    const c = conflictCard(
      {
        slug: 's',
        id: 'x',
        type: 'sticky',
        mine: { text: 'a' },
        theirs: { author: { name: 'Jonas' }, text: 'b', at },
      },
      { me: 'Michal', now }
    );
    expect(c.mine.who).toBe('Yours · this Mac');
    expect(c.theirs.who).toBe('Jonas · 07:55 · their Mac');
    const gone = conflictCard(
      {
        slug: 's',
        id: 'x',
        type: 'sticky',
        mine: null,
        theirs: { author: { name: 'Jonas' }, text: 'b' },
      },
      { me: 'M' }
    );
    expect(gone.mine.text).toBe('You removed it.');
    expect(c.hint).toBe('Both stay here whatever you keep.');
  });
});
