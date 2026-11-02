// P8 test round (G1b, 01 cf-offline-create) — two things the desktop leg found beside a queued prompt:
//   (b) the board draws the queued prompt with NO follow-up chips under it ("Same on the other artboards",
//       "Try a variation" follow up on a reply that has not happened yet);
//   (c) the empty canvas's "AI is back when this Mac is online." followed navigator.onLine only, while the
//       queued card follows the hub gate too — for a hub-linked project the hub gate is the truth
//       (outbox/hub-reachability.ts: only the connection states offline / offline-long close it).
import { describe, expect, test } from 'bun:test';
import { deriveSuggestions } from '../client/v2/ai/suggest-why.js';
import { emptyCanvasModel, hubAway } from '../client/v2/empty/use-empty-canvas.js';

describe('(b) a queued ask has nothing to follow up on yet', () => {
  const ask = { lastAsk: { text: 'Three reel covers for Krpole v pohybu' } };
  test('the last-ask strip is not drawn while that ask waits in line', () => {
    expect(deriveSuggestions({ ...ask })?.context).toBe('last-ask');
    expect(deriveSuggestions({ ...ask, queued: true })).toBeNull();
  });
  test('nor the answered strip', () => {
    expect(deriveSuggestions({ ...ask, answered: true, queued: true })).toBeNull();
  });
  test('what is not a follow-up still shows: open comments, the repair chip', () => {
    expect(deriveSuggestions({ ...ask, queued: true, openComments: 2 })?.context).toBe('comments');
    expect(deriveSuggestions({ ...ask, queued: true, repair: 'fix it' })?.context).toBe('repair');
  });
});

describe('(c) the empty canvas reads the hub gate, like the queued card', () => {
  const facts = { count: 0, mode: 'edit', canEdit: true, claude: 'present', canAsk: true } as const;
  test('the gate: a linked project past the grace window is away; connecting is not', () => {
    expect(hubAway({ linked: true, state: 'offline' })).toBe(true);
    expect(hubAway({ linked: true, state: 'offline-long' })).toBe(true);
    expect(hubAway({ linked: true, state: 'connecting' })).toBe(false);
    expect(hubAway({ linked: true, state: 'online' })).toBe(false);
    // a local project never closes it
    expect(hubAway({ linked: false, state: 'offline' })).toBe(false);
    expect(hubAway(null)).toBe(false);
    expect(hubAway(undefined)).toBe(false);
  });
  test('the hub away with the Mac online draws the offline line', () => {
    const online = true && !hubAway({ linked: true, state: 'offline' });
    const m = emptyCanvasModel({ ...facts, online });
    expect(m?.variant).toBe('offline');
    expect(m?.offlineLine).toBe('AI is back when this Mac is online.');
  });
});
