// 2.1.1 T5 — the one "Link your server" dialog (canvas 17, artboards 12–13), as a state machine:
// empty → checking → answers / didn't answer / not a Maude server; the primary button wakes only once
// the server answered; an invite link fills the address and rides the sign-in once; Advanced takes a
// sign-in key instead of the browser. `runLink` drives the injected API (project or Home).

import { describe, expect, test } from 'bun:test';
import {
  folderOfStatus,
  linkFolderAnswerOf,
  projectLinkApi,
} from '../client/v2/link-server/link-server-api.js';
import {
  addressOf,
  advancedParts,
  canSubmit,
  checkLine,
  confirmLines,
  hostOf,
  initialLink,
  LINK_WORDS,
  linkReducer,
  primaryLabel,
  runConfirm,
  runLink,
  whyNotSubmit,
} from '../client/v2/link-server/link-server-model.js';

const HUB = 'https://design.example.com';
const KEY = `inv_${'k'.repeat(24)}`;

const step = (s: ReturnType<typeof initialLink>, ...actions: Record<string, unknown>[]) =>
  actions.reduce((acc, a) => linkReducer(acc, a), s);

describe('the address', () => {
  test('a bare host becomes https; an explicit scheme is kept; blank is nothing', () => {
    expect(addressOf('design.example.com')).toBe(HUB);
    expect(addressOf('  design.example.com/  ')).toBe(`${HUB}/`);
    expect(addressOf('http://127.0.0.1:4400')).toBe('http://127.0.0.1:4400');
    expect(addressOf('   ')).toBeNull();
    expect(hostOf(HUB)).toBe('design.example.com');
  });
});

describe('the check', () => {
  test('empty → checking as you type → answers names the server and its Maude version', () => {
    let s = initialLink();
    expect(s.check.phase).toBe('empty');
    expect(checkLine(s)).toEqual({ tone: 'hint', text: LINK_WORDS.hint });
    expect(canSubmit(s)).toBe(false);
    expect(whyNotSubmit(s)).toBe('Type the server’s address first.');
    s = step(s, { type: 'type', url: 'design.example.com' });
    expect(s.check.phase).toBe('checking');
    expect(checkLine(s)).toEqual({ tone: 'busy', text: 'Checking design.example.com…' });
    expect(canSubmit(s)).toBe(false);
    s = step(s, { type: 'check-done', seq: s.check.seq, answer: { ok: true, version: '2.1.0' } });
    expect(s.check.phase).toBe('answers');
    expect(checkLine(s)).toEqual({
      tone: 'ok',
      text: 'design.example.com answers — Maude 2.1.0',
    });
    expect(canSubmit(s)).toBe(true);
    expect(primaryLabel(s)).toBe('Sign in in your browser');
  });

  test("didn't answer and isn't a Maude server are different errors; the button stays asleep", () => {
    const typed = step(initialLink(), { type: 'type', url: 'design.example.com' });
    const down = step(typed, {
      type: 'check-done',
      seq: typed.check.seq,
      answer: { ok: false, reason: 'unreachable' },
    });
    expect(down.check.phase).toBe('no-answer');
    expect(checkLine(down)).toEqual({
      tone: 'bad',
      text: 'design.example.com didn’t answer. Check the address, or try again when this Mac is online.',
    });
    expect(canSubmit(down)).toBe(false);
    const other = step(typed, {
      type: 'check-done',
      seq: typed.check.seq,
      answer: { ok: false, reason: 'not-a-maude-workspace' },
    });
    expect(other.check.phase).toBe('not-maude');
    expect(checkLine(other).text).toBe(
      'design.example.com answers, but it isn’t a Maude server. Check the address with whoever runs it.'
    );
    expect(canSubmit(other)).toBe(false);
    const bad = step(typed, {
      type: 'check-done',
      seq: typed.check.seq,
      answer: {
        ok: false,
        reason: 'bad-address',
        error: 'The hub address must start with https://.',
      },
    });
    expect(bad.check.phase).toBe('bad-address');
    expect(checkLine(bad).tone).toBe('bad');
  });

  test('an answer for an address that has since changed is dropped; clearing the field empties it', () => {
    const a = step(initialLink(), { type: 'type', url: 'design.example.co' });
    const b = step(a, { type: 'type', url: 'design.example.com' });
    const stale = step(b, { type: 'check-done', seq: a.check.seq, answer: { ok: true } });
    expect(stale.check.phase).toBe('checking');
    expect(step(b, { type: 'type', url: '' }).check.phase).toBe('empty');
  });
});

describe('the invite path', () => {
  test("a pasted invite link fills an empty address and checks it; the field is the person's to clear", () => {
    let s = step(initialLink(), { type: 'invite-open' });
    expect(s.invite.open).toBe(true);
    s = step(s, { type: 'invite', value: `${HUB}/join/${KEY}` });
    expect(s.url).toBe(HUB);
    expect(s.check.phase).toBe('checking');
    // a typed address is never replaced by the link's
    const typed = step(
      initialLink(),
      { type: 'type', url: 'mine.example.com' },
      { type: 'invite-open' }
    );
    expect(step(typed, { type: 'invite', value: `${HUB}/join/${KEY}` }).url).toBe(
      'mine.example.com'
    );
  });

  test('runLink sends the invite to start once and empties nothing it was not given', async () => {
    const calls: unknown[][] = [];
    const api = fakeApi(calls);
    let s = step(
      initialLink(),
      { type: 'invite-open' },
      { type: 'invite', value: `${HUB}/join/${KEY}` }
    );
    s = step(s, { type: 'check-done', seq: s.check.seq, answer: { ok: true } });
    const r = await runLink(s, api, { sleep: async () => {} });
    expect(r).toEqual({ ok: true });
    expect(calls.filter((c) => c[0] === 'signInStart')).toEqual([
      ['signInStart', HUB, `${HUB}/join/${KEY}`],
    ]);
    expect(calls.at(-1)).toEqual(['finish', HUB, { mode: 'kept', path: '' }]);
  });
});

describe('the browser sign-in', () => {
  test('start → open the page → waiting → poll until the browser came back → finish', async () => {
    const calls: unknown[][] = [];
    let polls = 0;
    const api = fakeApi(calls, {
      signInPoll: async () => (++polls < 3 ? { ok: true, pending: true } : { ok: true, url: HUB }),
    });
    const s = answered();
    const waits: unknown[] = [];
    const r = await runLink(s, api, { sleep: async () => {}, onWaiting: (w) => waits.push(w) });
    expect(r).toEqual({ ok: true });
    expect(waits).toEqual([
      { id: 'att-1', signInUrl: `${HUB}/studio/signin?x`, host: 'design.example.com' },
    ]);
    expect(polls).toBe(3);
    expect(calls.map((c) => c[0])).toEqual([
      'signInStart',
      'openSignIn',
      'signInPoll',
      'signInPoll',
      'signInPoll',
      'finish',
    ]);
  });

  test('a page the shell will not open forgets the attempt and says why', async () => {
    const calls: unknown[][] = [];
    const api = fakeApi(calls, { openSignIn: async () => 'refused' });
    const r = await runLink(answered(), api, { sleep: async () => {} });
    expect(r).toEqual({ ok: false, error: LINK_WORDS.refused });
    expect(calls.map((c) => c[0])).toEqual(['signInStart', 'openSignIn', 'signInCancel']);
  });

  test('a cancelled wait ends quietly and finishes nothing', async () => {
    const calls: unknown[][] = [];
    let cancelled = false;
    const api = fakeApi(calls, {
      signInPoll: async () => {
        cancelled = true;
        return { ok: true, pending: true };
      },
    });
    const r = await runLink(answered(), api, {
      sleep: async () => {},
      isCancelled: () => cancelled,
    });
    expect(r).toEqual({ ok: false, cancelled: true });
    expect(calls.some((c) => c[0] === 'finish')).toBe(false);
  });

  test("the server's refusal comes back in its own words", async () => {
    const api = fakeApi([], {
      signInStart: async () => ({ ok: false, error: 'This team server is too old.' }),
    });
    expect(await runLink(answered(), api, { sleep: async () => {} })).toEqual({
      ok: false,
      error: 'This team server is too old.',
    });
  });
});

describe('Advanced', () => {
  test('a sign-in key replaces the browser: the button says so, and the key is linked, not signed in', async () => {
    let s = step(answered(), { type: 'advanced' }, { type: 'key', value: '  hk_secret_value  ' });
    expect(s.advanced).toBe(true);
    expect(primaryLabel(s)).toBe('Link with this key');
    expect(canSubmit(s)).toBe(true);
    const calls: unknown[][] = [];
    const r = await runLink(s, fakeApi(calls), { sleep: async () => {} });
    expect(r).toEqual({ ok: true });
    expect(calls.map((c) => c[0])).toEqual(['linkKey', 'finish']);
    expect(calls[0]).toEqual(['linkKey', HUB, 'hk_secret_value']);
    s = step(s, { type: 'key', value: '' });
    expect(primaryLabel(s)).toBe('Sign in in your browser');
  });

  test('a refused key stops before anything opens', async () => {
    const calls: unknown[][] = [];
    const api = fakeApi(calls, {
      linkKey: async () => ({ ok: false, error: 'Couldn’t save it.' }),
    });
    const s = step(answered(), { type: 'key', value: 'k' });
    expect(await runLink(s, api, { sleep: async () => {} })).toEqual({
      ok: false,
      error: 'Couldn’t save it.',
    });
    expect(calls.map((c) => c[0])).toEqual(['linkKey']);
  });

  test('"Use my folder…" needs a folder before the button wakes; the choice reaches finish', async () => {
    let s = step(answered(), { type: 'folder', mode: 'mine' });
    expect(canSubmit(s)).toBe(false);
    s = step(s, { type: 'folder-path', path: '/Users/me/git/logo-ideas' });
    expect(canSubmit(s)).toBe(true);
    const calls: unknown[][] = [];
    await runLink(s, fakeApi(calls), { sleep: async () => {} });
    expect(calls.at(-1)).toEqual([
      'finish',
      HUB,
      { mode: 'mine', path: '/Users/me/git/logo-ideas' },
    ]);
  });

  test('Advanced lists only what this context can do — nothing, and the fold is not drawn', () => {
    expect(advancedParts({ linkKey: async () => ({ ok: true }), folders: true })).toEqual([
      'Sign-in key',
      'folder',
    ]);
    expect(advancedParts({ linkKey: async () => ({ ok: true }) })).toEqual(['Sign-in key']);
    expect(advancedParts({})).toEqual([]);
  });

  test('nothing is submitted twice while a sign-in runs; the invite and the key are emptied at the press', () => {
    const s = step(
      answered(),
      { type: 'invite-open' },
      { type: 'invite', value: KEY },
      { type: 'key', value: 'hk_x' },
      { type: 'submit' }
    );
    expect(s.invite.value).toBe('');
    expect(s.key).toBe('');
    expect(s.phase).toBe('starting');
    expect(canSubmit(s)).toBe(false);
    const w = step(s, { type: 'waiting', host: 'design.example.com', signInUrl: 'x', id: 'a' });
    expect(w.phase).toBe('waiting');
    expect(canSubmit(w)).toBe(false);
    const back = step(w, { type: 'failed', error: 'no' });
    expect(back.phase).toBe('form');
    expect(back.error).toBe('no');
    expect(canSubmit(back)).toBe(true);
  });
});

describe('B5 — this folder joins the server (a project tab)', () => {
  const COUNTS = {
    onlyHere: 3,
    onlyThere: 1,
    differ: 1,
    same: 0,
    canvases: { onlyHere: 1, onlyThere: 1, differ: 1, same: 0 },
    files: { onlyHere: 2, onlyThere: 0, differ: 0, same: 0 },
  };

  test('the project’s own folder makes the folder THIS one: not a choice, Advanced names it', () => {
    const s = step(answered(), { type: 'here', folder: '~/git/logo-ideas' });
    expect(s.folder).toEqual({ mode: 'this', path: '~/git/logo-ideas' });
    expect(step(s, { type: 'folder', mode: 'kept' }).folder.mode).toBe('this');
    expect(step(s, { type: 'folder-path', path: '/x' }).folder.path).toBe('~/git/logo-ideas');
    expect(canSubmit(s)).toBe(true);
    expect(advancedParts({ linkKey: async () => ({}), folders: 'this' }, s)).toEqual([
      'Sign-in key',
      'folder',
    ]);
    // a copy Maude keeps / a linked project: nothing changes
    expect(step(answered(), { type: 'here', folder: null }).folder.mode).toBe('kept');
    expect(advancedParts({ folders: 'this' }, answered())).toEqual([]);
    expect(LINK_WORDS.folderThis('~/git/logo-ideas')).toBe('This folder (~/git/logo-ideas)');
  });

  test('finish answers needs-confirm → runLink hands back the counts and nothing else ran', async () => {
    const calls: unknown[][] = [];
    const s = step(answered(), { type: 'here', folder: '~/git/logo-ideas' });
    const r = await runLink(
      s,
      fakeApi(calls, {
        finish: async () => ({
          ok: false,
          needsConfirm: { host: 'design.example.com', counts: COUNTS, code: 'c1' },
        }),
      }),
      { sleep: async () => {} }
    );
    expect(calls.at(-1)).toEqual(['finish', HUB, { mode: 'this', path: '' }]);
    expect(r).toEqual({
      ok: false,
      needsConfirm: { url: HUB, host: 'design.example.com', counts: COUNTS, code: 'c1' },
    });
    const c = step(s, { type: 'needs-confirm', confirm: r.needsConfirm });
    expect(c.phase).toBe('confirm');
    expect(c.confirm?.code).toBe('c1');
    expect(canSubmit(c)).toBe(false);
    // Cancel / a failure drops the code
    expect(step(c, { type: 'cancelled' }).confirm).toBeNull();
    expect(step(c, { type: 'needs-confirm', confirm: {} }).phase).toBe('form');
  });

  test('the confirm words: counts with nouns for one and many, a zero line left out', () => {
    expect(confirmLines(COUNTS, 'design.example.com')).toEqual([
      {
        id: 'here',
        text: '1 canvas and 2 files only on this Mac — sent up to design.example.com',
      },
      {
        id: 'there',
        text: '1 canvas only on design.example.com — copied to this folder',
      },
      {
        id: 'differ',
        text: '1 canvas on both, but different — this Mac keeps its version until you choose which to keep',
      },
    ]);
    expect(LINK_WORDS.confirmTitle('design.example.com')).toBe(
      'Sync this folder with design.example.com?'
    );
    expect(LINK_WORDS.confirmButton).toBe('Sync this folder');
    expect(confirmLines(null, 'x')).toEqual([]);
  });

  test('S1 — each "different" line says what the first sync does to it (measured, not assumed)', () => {
    const at = (canvases: number, files: number, same = 0) =>
      confirmLines(
        {
          canvases: { onlyHere: 0, onlyThere: 0, differ: canvases, same },
          files: { onlyHere: 0, onlyThere: 0, differ: files, same: 0 },
        },
        'x.test'
      );
    expect(at(0, 2)).toEqual([
      {
        id: 'differ',
        text: '2 files on both, but different — x.test’s version is used, and this Mac’s is kept beside it as a copy',
      },
    ]);
    expect(at(1, 1)[0]?.text).toBe(
      '1 canvas and 1 file on both, but different — for a canvas, this Mac keeps its version until you choose which to keep; for a file, x.test’s version is used, and this Mac’s is kept beside it as a copy'
    );
    expect(at(0, 0, 3)).toEqual([
      { id: 'same', text: '3 canvases already the same on both — nothing changes' },
    ]);
  });

  test('Sync this folder sends the one-time code back once; an error returns to the form', async () => {
    const s = step(
      answered(),
      { type: 'here', folder: '~/x' },
      {
        type: 'needs-confirm',
        confirm: { url: HUB, host: 'design.example.com', counts: COUNTS, code: 'c1' },
      }
    );
    const calls: unknown[][] = [];
    const ok = await runConfirm(s, fakeApi(calls, { confirmLink: async () => ({ ok: true }) }));
    expect(ok).toEqual({ ok: true });
    expect(calls).toEqual([['confirmLink', HUB, 'c1']]);
    const bad = await runConfirm(
      s,
      fakeApi([], { confirmLink: async () => ({ ok: false, error: 'That confirmation expired.' }) })
    );
    expect(bad).toEqual({ ok: false, error: 'That confirmation expired.' });
    expect(step(s, { type: 'confirming' }).phase).toBe('linking');
    expect(step(s, { type: 'failed', error: 'x' })).toMatchObject({ phase: 'form', confirm: null });
  });

  test('the project API: where = an unlinked own folder; finish links THIS folder; confirm sends the code', async () => {
    expect(folderOfStatus({ place: { kept: false, folder: '~/git/a' }, linkedHub: null })).toBe(
      '~/git/a'
    );
    expect(folderOfStatus({ place: { kept: true } })).toBeNull();
    expect(
      folderOfStatus({ place: { kept: false, folder: '~/git/a' }, linkedHub: { url: HUB } })
    ).toBeNull();
    expect(folderOfStatus(null)).toBeNull();

    const posts: [string, unknown][] = [];
    const opened: unknown[] = [];
    let answer: unknown = { ok: true, state: 'linked', url: HUB };
    const api = projectLinkApi({
      fetchGet: async () => ({ place: { kept: false, folder: '~/git/a' }, linkedHub: null }),
      fetchPost: async (path: string, body: unknown) => {
        posts.push([path, body]);
        return { ok: true, status: 200, json: answer };
      },
      openProject: async (x: unknown) => {
        opened.push(x);
        return { ok: true };
      },
    } as never);
    expect(api.folders).toBe('this');
    expect(await api.where()).toEqual({ folder: '~/git/a' });
    expect(await api.finish(HUB, { mode: 'this', path: '' })).toEqual({ ok: true });
    answer = { ok: true, state: 'needs-confirm', host: 'h', counts: COUNTS, confirm: 'c9' };
    expect(await api.finish(HUB, { mode: 'this', path: '' })).toEqual({
      ok: false,
      needsConfirm: { host: 'h', counts: COUNTS, code: 'c9' },
    });
    answer = { ok: true, state: 'linked', url: HUB };
    expect(await api.confirmLink(HUB, 'c9')).toEqual({ ok: true });
    expect(posts).toEqual([
      ['/_api/hub/link-folder', { url: HUB }],
      ['/_api/hub/link-folder', { url: HUB }],
      ['/_api/hub/link-folder', { url: HUB, confirm: 'c9' }],
    ]);
    expect(opened).toEqual([]);
    // not this folder: the server's project opens in its own tab, as before
    await api.finish(HUB, { mode: 'kept', path: '' });
    expect(opened).toEqual([{ kind: 'known-hub', url: HUB }]);
  });

  test('a refusal keeps its words; a malformed answer is a plain failure', () => {
    expect(
      linkFolderAnswerOf({
        ok: false,
        json: { ok: false, reason: 'linked-elsewhere', error: 'This project already syncs.' },
      })
    ).toEqual({ ok: false, error: 'This project already syncs.' });
    expect(linkFolderAnswerOf({ ok: true, json: { ok: true, state: 'needs-confirm' } })).toEqual({
      ok: false,
    });
    expect(linkFolderAnswerOf(null)).toEqual({ ok: false });
  });
});

function answered() {
  const s = step(initialLink(), { type: 'type', url: 'design.example.com' });
  return step(s, { type: 'check-done', seq: s.check.seq, answer: { ok: true, version: '2.1.0' } });
}

function fakeApi(calls: unknown[][], over: Record<string, (...a: never[]) => unknown> = {}) {
  const rec =
    (name: string, fn: (...a: never[]) => unknown) =>
    async (...a: unknown[]) => {
      calls.push([name, ...a]);
      return (fn as (...b: unknown[]) => unknown)(...a);
    };
  const base: Record<string, (...a: never[]) => unknown> = {
    check: async () => ({ ok: true, version: '2.1.0' }),
    signInStart: async () => ({ ok: true, id: 'att-1', signInUrl: `${HUB}/studio/signin?x` }),
    openSignIn: async () => 'ok',
    signInPoll: async () => ({ ok: true, url: HUB }),
    signInCancel: async () => ({ ok: true }),
    linkKey: async () => ({ ok: true }),
    finish: async () => ({ ok: true }),
  };
  const out: Record<string, unknown> = {};
  for (const [k, fn] of Object.entries({ ...base, ...over })) out[k] = rec(k, fn);
  return out;
}
