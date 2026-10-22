// V2-4.3a — the Share cluster's status word is ONE pure machine (client/v2/shell/save-status.js):
// every word of CONTRACT §6 is reachable, the precedence is Not saved > Local project > Offline >
// Syncing… > Saved, "Not saved" shows only while it is true, and a person without edit rights sees an
// access word (Can view / Can comment) in the same slot with "Ask to edit" as the one action.
import { describe, expect, test } from 'bun:test';
import {
  ACCESS_WORDS,
  accessStatus,
  exportsRing,
  facesOf,
  outboxPending,
  saveStatus,
  WORDS,
} from '../client/v2/shell/save-status.js';

const linked = { linked: true, online: true, phase: 'synced', pending: 0, writeFailed: null };

describe('saveStatus — the five words', () => {
  test('Saved: a linked project with nothing waiting and a link that carries edits', () => {
    expect(saveStatus(linked)).toMatchObject({ kind: 'saved', word: 'Saved' });
  });
  test('Syncing…: connecting, syncing, or edits still waiting while online', () => {
    for (const phase of ['connecting', 'syncing'])
      expect(saveStatus({ ...linked, phase }).word).toBe('Syncing…');
    expect(saveStatus({ ...linked, pending: 3 }).word).toBe('Syncing…');
  });
  test('Offline — kept on this Mac: no network, an offline or stalled link', () => {
    expect(saveStatus({ ...linked, online: false }).word).toBe('Offline — kept on this Mac');
    expect(saveStatus({ ...linked, phase: 'offline' }).word).toBe('Offline — kept on this Mac');
    expect(saveStatus({ ...linked, phase: 'stalled' }).word).toBe('Offline — kept on this Mac');
    expect(saveStatus({ ...linked, online: false, pending: 4 }).tone).toBe('warn');
  });
  test('Local project: nothing is linked', () => {
    expect(saveStatus({ ...linked, linked: false, phase: null })).toMatchObject({
      kind: 'local',
      word: 'Local project',
    });
  });
  test('Not saved: a failed write, with Retry', () => {
    const s = saveStatus({ ...linked, writeFailed: { kind: 'failed' } });
    expect(s).toMatchObject({ kind: 'not-saved', word: 'Not saved', tone: 'error' });
    expect(s.actions.map((a: { id: string }) => a.id)).toEqual(['retry']);
  });
  test('a hub that refused the documents is a failed write', () => {
    expect(saveStatus({ ...linked, phase: 'refused' }).kind).toBe('not-saved');
  });
  test('a full disk: Not saved + the sentence + Retry and Show in Finder (C37)', () => {
    const s = saveStatus({ ...linked, writeFailed: { kind: 'disk-full' } });
    expect(s.word).toBe('Not saved');
    expect(s.detail).toBe("This Mac is out of space — changes wait here until there's room.");
    expect(s.actions.map((a: { id: string }) => a.id)).toEqual(['retry', 'show-in-finder']);
  });
  test('the words are the contract’s, nothing else', () => {
    expect(Object.values(WORDS).sort()).toEqual(
      ['Local project', 'Not saved', 'Offline — kept on this Mac', 'Saved', 'Syncing…'].sort()
    );
  });
});

describe('saveStatus — precedence', () => {
  test('Not saved outranks everything, local or linked, online or not', () => {
    const failed = { kind: 'failed' };
    expect(saveStatus({ ...linked, online: false, pending: 2, writeFailed: failed }).kind).toBe(
      'not-saved'
    );
    expect(saveStatus({ ...linked, linked: false, writeFailed: failed }).kind).toBe('not-saved');
  });
  test('a local project never says Offline or Syncing…', () => {
    expect(saveStatus({ ...linked, linked: false, online: false, pending: 5 }).kind).toBe('local');
  });
  test('Offline outranks Syncing… (edits waiting with no network are kept, not syncing)', () => {
    expect(saveStatus({ ...linked, online: false, phase: 'syncing', pending: 2 }).kind).toBe(
      'offline'
    );
  });
  test('Syncing… outranks Saved', () => {
    expect(saveStatus({ ...linked, pending: 1 }).kind).toBe('syncing');
  });
  test('"Not saved" is only true while the failure is: clearing it clears the word', () => {
    expect(saveStatus({ ...linked, writeFailed: { kind: 'failed' } }).kind).toBe('not-saved');
    expect(saveStatus({ ...linked, writeFailed: null }).kind).toBe('saved');
  });
  test('quiet phases do not read as trouble', () => {
    for (const phase of ['parked', 'nothing-syncable', 'attention', 'synced'])
      expect(saveStatus({ ...linked, phase }).kind).toBe('saved');
  });
  test('garbage in never throws and never says Saved for an unreadable link', () => {
    expect(saveStatus(undefined).kind).toBe('local');
    expect(saveStatus({ linked: true }).kind).toBe('saved');
    expect(saveStatus({ ...linked, pending: Number.NaN }).kind).toBe('saved');
  });
});

describe('accessStatus — people without edit rights', () => {
  test('editors get none', () => {
    expect(accessStatus({ canEdit: true, role: 'member' })).toBeNull();
  });
  test('Can comment is today’s viewer; Can view is a role below it', () => {
    expect(accessStatus({ canEdit: false, role: 'viewer' })).toEqual({
      word: ACCESS_WORDS.comment,
      action: 'Ask to edit',
    });
    expect(accessStatus({ canEdit: false, role: 'observer' })?.word).toBe('Can view');
  });
  test('an unknown role without edit rights is the safer floor of the two shown, Can comment', () => {
    expect(accessStatus({ canEdit: false, role: undefined })?.word).toBe('Can comment');
  });
});

describe('exportsRing', () => {
  const job = (status: string, current = 0, total = 0) => ({
    id: status + current,
    status,
    progress: total ? { current, total } : undefined,
  });
  test('hidden until an export exists', () => {
    expect(exportsRing([])).toEqual({ show: false, ring: undefined, busy: 0 });
  });
  test('shown once any export exists; no ring when nothing runs', () => {
    expect(exportsRing([job('done')])).toEqual({ show: true, ring: undefined, busy: 0 });
  });
  test('the ring is the mean progress of the running jobs, 0–100', () => {
    expect(exportsRing([job('running', 1, 4), job('running', 3, 4)])).toMatchObject({
      show: true,
      ring: 50,
      busy: 2,
    });
  });
  test('a running job with no total counts as 0 %, a queued one is busy too', () => {
    expect(exportsRing([job('running'), job('queued')])).toMatchObject({ ring: 0, busy: 2 });
  });
});

describe('outboxPending', () => {
  test('reads content.pending off GET /_api/outbox, 0 for anything else', () => {
    expect(outboxPending({ content: { pending: 3 } })).toBe(3);
    expect(outboxPending({ content: {} })).toBe(0);
    expect(outboxPending(null)).toBe(0);
    expect(outboxPending({ content: { pending: -1 } })).toBe(0);
  });
});

describe('facesOf', () => {
  test('you first, the agent while it works, then peers, capped', () => {
    const f = facesOf({ you: 'Michal Dovrtěl', agentActive: true, peers: [{ name: 'Tereza K' }] });
    // one letter each; the AI face carries none (it draws the spark — 10 co-presence)
    expect(f.map((x: { initials: string }) => x.initials)).toEqual(['M', '', 'T']);
    expect(f[0].you).toBe(true);
    const many = facesOf({
      you: 'a',
      peers: Array.from({ length: 9 }, (_, i) => ({ name: `Person ${i}` })),
    });
    expect(many.length).toBe(4);
  });
});
