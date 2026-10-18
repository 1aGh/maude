// S5.13 — the pure half of "Needs you, inline cards, not-ready" (03 `ai-permission`, `ai-choice-fail`,
// `ai-not-ready`, `ai-needs-hidden`, `ai-panel-closed`). No DOM here: models, frame readers, the connect flow and
// the parity pins against the SERVER's own words (so a drift on either side is a red test).
import { describe, expect, test } from 'bun:test';
import { READ_ONLY_CHAT_WORDS } from '../acp/index.ts';
import { ASK_ID_RE } from '../ai/run-lifecycle.ts';
import { buildChatContext } from '../client/panels/chat-context.js';
import {
  isAskId,
  mergeOutbox,
  newAskId,
  promptFrame,
  reduceQueued,
  runScopeOf,
} from '../client/v2/ai/ask-frame.js';
import { connectClaude } from '../client/v2/ai/connect-flow.js';
import {
  CONNECT_WORDS,
  clock,
  notReadyModel,
  OFFLINE_QUEUED,
  queuedForChat,
  quotaModel,
  SETTING_UP,
  splitLead,
  usedUpWords,
} from '../client/v2/ai/gate-lines.js';
import {
  choiceAnswer,
  choiceModel,
  needsYouLine,
  permissionAnswer,
  permissionDecline,
  permissionModel,
  problemModel,
} from '../client/v2/ai/needs-you.js';
import {
  getNeedsYou,
  resetNeedsYou,
  setLocalNeedsYou,
  setServerNeedsYou,
  startNeedsYouFeed,
} from '../client/v2/ai/needs-you-store.js';
import {
  canvasTitle,
  doneLine,
  doneNotice,
  needsYouNotice,
} from '../client/v2/ai/needs-you-toast.js';
import { gateWords } from '../outbox/policy.ts';

const OPT = {
  once: { optionId: 'allow-once', kind: 'allow_once', name: 'Allow' },
  always: { optionId: 'allow-always', kind: 'allow_always', name: 'Always allow' },
  reject: { optionId: 'reject-once', kind: 'reject_once', name: 'Reject' },
};
const req = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  toolCall: { title: 'Edit Post.tsx', kind: 'edit', rawInput: { file_path: '/p/ui/Post.tsx' } },
  options: [OPT.always, OPT.once, OPT.reject],
  scope: null,
  ...over,
});

describe('permission card model (D4)', () => {
  test('the title verb IS the button verb, for every kind the card words', () => {
    const kinds: Array<[string, string]> = [
      ['edit', 'Edit'],
      ['delete', 'Delete'],
      ['move', 'Move'],
      ['execute', 'Run'],
      ['fetch', 'Fetch'],
    ];
    for (const [kind, verb] of kinds) {
      const m = permissionModel(
        req({ toolCall: { title: 'x', kind, rawInput: { path: '/a/b.txt' } } })
      );
      expect(m.shape).toBe('simple');
      expect(m.verb).toBe(verb);
      expect(m.title.startsWith(`${verb} `)).toBe(true);
      expect(m.title.endsWith('?')).toBe(true);
    }
    // a new file is Write, not Edit — the adapter says which in its own title
    expect(
      permissionModel(req({ toolCall: { title: 'Write /p/new.tsx', kind: 'edit' } })).verb
    ).toBe('Write');
  });

  test('"Always for this canvas" exists only when the agent offered allow_always', () => {
    expect(permissionModel(req()).always?.optionId).toBe('allow-always');
    const without = permissionModel(req({ options: [OPT.once, OPT.reject] }));
    expect(without.always).toBeNull();
    // ticking a box that is not there cannot widen the answer
    expect(permissionAnswer(without, true)).toBe('allow-once');
  });

  test('Enter / the allow button answer once-only; the standing option needs the ticked box', () => {
    const m = permissionModel(req());
    expect(permissionAnswer(m, false)).toBe('allow-once'); // allow_always is listed FIRST by the adapter
    expect(permissionAnswer(m, true)).toBe('allow-always');
    expect(permissionDecline(m)).toBe('reject-once');
    expect(permissionDecline(permissionModel(req({ options: [OPT.once] })))).toBe('cancelled');
  });

  test('an out-of-project write: fixed headline, resolved path, never the standing option', () => {
    const m = permissionModel(
      req({
        scope: {
          outOfProjectWrite: true,
          resolvedPaths: ['/Users/x/.zshenv'],
          scopeRoot: '/p',
          reason: 'outside',
        },
        toolCall: { title: 'Write docs/../../../.zshenv', kind: 'edit' },
      })
    );
    expect(m.outside?.paths).toEqual(['/Users/x/.zshenv']);
    expect(m.title).toBe('Write outside this project — .zshenv?');
    expect(m.title).not.toContain('docs/');
    expect(m.always).toBeNull(); // the server strips it; the second pass keeps a stale frame honest
  });

  test('bidi / control characters in a path are neutralised in the title and the detail', () => {
    const m = permissionModel(
      req({ toolCall: { title: 'Edit a‮b', kind: 'edit', rawInput: { path: '/x/s‮gnp.tsx' } } })
    );
    expect(m.title).not.toContain('‮');
    expect(m.detail ?? '').not.toContain('‮');
  });

  test('a multi-way set (ExitPlanMode) keeps every option as its own button', () => {
    const m = permissionModel(
      req({
        toolCall: { title: 'Ready to code?', kind: 'switch_mode' },
        options: [
          { optionId: 'auto', kind: 'allow_always', name: 'Yes, and use auto mode' },
          { optionId: 'acceptEdits', kind: 'allow_always', name: 'Yes, and auto-accept edits' },
          { optionId: 'default', kind: 'allow_once', name: 'Yes, manually approve edits' },
          { optionId: 'plan', kind: 'reject_once', name: 'No, keep planning' },
        ],
      })
    );
    expect(m.shape).toBe('options');
    expect(m.options).toHaveLength(4);
    expect(m.verb).toBeNull();
  });

  test('the Needs-you line quotes the question without its "?"', () => {
    expect(needsYouLine(permissionModel(req()))).toBe('Edit Post.tsx');
  });
});

describe('choice card model', () => {
  const schema = (extra: Record<string, unknown> = {}) => ({
    properties: {
      question_0: {
        type: 'string',
        title: 'Green',
        description: 'Which green?',
        oneOf: [
          { const: 'club', title: 'Club green', description: 'from the design system' },
          { const: 'light', title: 'Lighter green' },
        ],
        ...extra,
      },
      question_0_custom: { type: 'string' },
    },
    required: ['question_0'],
  });
  const elicit = (requestedSchema: unknown, message = 'Which green?') => ({
    id: 'e1',
    message,
    requestedSchema,
  });

  test('one single-select question → the simple card, with a way to type your own', () => {
    const m = choiceModel(elicit(schema()));
    expect(m?.question).toBe('Which green?');
    expect(m?.options.map((o: { label: string }) => o.label)).toEqual([
      'Club green',
      'Lighter green',
    ]);
    expect(m?.options[0].hint).toBe('from the design system');
    expect(m?.otherFieldId).toBe('question_0_custom');
  });

  test('anything else is the v1 form: several questions, multi-select, free text, a secret-shaped ask', () => {
    const two = {
      properties: { a: schema().properties.question_0, b: schema().properties.question_0 },
    };
    expect(choiceModel(elicit(two))).toBeNull();
    const multi = { properties: { q: { type: 'array', items: { enum: ['a', 'b'] } } } };
    expect(choiceModel(elicit(multi))).toBeNull();
    expect(choiceModel(elicit({ properties: { q: { type: 'string' } } }))).toBeNull();
    const secret = {
      properties: { q: { ...schema().properties.question_0, description: 'Paste your API key' } },
    };
    expect(choiceModel(elicit(secret))).toBeNull();
    expect(choiceModel(elicit(null))).toBeNull();
  });

  test('answers: a pick fills the question; typed text wins and rides the custom field', () => {
    const m = choiceModel(elicit(schema()));
    expect(choiceAnswer(m, { value: 'light' })).toEqual({
      action: 'accept',
      content: { question_0: 'light' },
    });
    expect(choiceAnswer(m, { custom: ' Forest ' })).toEqual({
      action: 'accept',
      content: { question_0_custom: 'Forest' },
    });
  });
});

describe('problem card model', () => {
  test("a coded refusal says plainly what happened — the server's words, no verb that cannot work", () => {
    const ro = problemModel({ code: 'read-only', message: READ_ONLY_CHAT_WORDS });
    expect(ro?.title).toBe(READ_ONLY_CHAT_WORDS);
    expect(ro?.verb).toBeNull();
    // the fallback is the same sentence the server sends (a pin: change one side, this goes red)
    expect(problemModel({ code: 'read-only', message: '' })?.title).toBe(READ_ONLY_CHAT_WORDS);
    const nq = problemModel({ code: 'not-queued', message: 'The outbox is full.' });
    expect(nq?.title).toBe('The outbox is full.');
    expect(nq?.detail).toBe('Your text is still in the box.');
  });
  test('an uncoded error keeps the v1 connection-problem card', () => {
    expect(problemModel({ message: 'socket closed' })).toBeNull();
    expect(problemModel(null)).toBeNull();
  });
});

describe("not-ready lines are the server's own words", () => {
  test('parity with gateWords for each gate an ai.prompt can wait on', () => {
    expect(gateWords(['online'], 'ai.prompt')?.text).toBe(OFFLINE_QUEUED);
    expect(gateWords(['hub'], 'ai.prompt')?.text).toBe(OFFLINE_QUEUED);
    expect(gateWords(['ai-connected'], 'ai.prompt')?.text).toBe(CONNECT_WORDS);
    expect(gateWords(['ai-ready'], 'ai.prompt')?.text).toBe(SETTING_UP);
    expect(gateWords(['ai-allowance'], 'ai.prompt', '18:40')?.text).toBe(usedUpWords('18:40'));
  });

  test('the first closed gate decides the surface', () => {
    expect(notReadyModel({ gates: ['online'] }).kind).toBe('offline');
    expect(notReadyModel({ gates: ['online'] }).lines).toEqual([
      OFFLINE_QUEUED,
      'AI is back when this Mac is online.',
    ]);
    expect(notReadyModel({ gates: ['ai-connected', 'ai-ready'] }).kind).toBe('connect');
    const setting = notReadyModel({ gates: ['ai-ready'], presentation: 'field' });
    expect(setting.kind).toBe('setting-up');
    expect(setting.lead).toBe('Setting up AI on this Mac.');
    expect(setting.rest).toBe('About a minute — keep drawing meanwhile.');
    const at = new Date(2026, 9, 18, 18, 40).getTime();
    const used = notReadyModel({ gates: ['ai-allowance'], allowanceResetsAt: at });
    expect(used.kind).toBe('used-up');
    expect(used.lead).toBe("AI's allowance is used up until 18:40.");
    // an earlier ask of this chat is ahead of it (O2): nothing is wrong, it goes by itself
    expect(notReadyModel({ gates: [] }).kind).toBe('waiting');
  });

  test("the frame's words win over the table", () => {
    expect(notReadyModel({ gates: ['online'], words: 'Queued — custom.' }).lines[0]).toBe(
      'Queued — custom.'
    );
  });

  test('clock and splitLead', () => {
    expect(clock(new Date(2026, 0, 1, 7, 5).getTime())).toBe('07:05');
    expect(clock(Number.NaN)).toBe('');
    expect(splitLead('One. Two three.')).toEqual({ lead: 'One.', rest: 'Two three.' });
  });

  test("after a reload the outbox brings back exactly this chat's waiting prompts", () => {
    const intents = [
      {
        id: 'i_aaa111',
        kind: 'ai.prompt',
        state: 'queued',
        gates: ['ai-allowance'],
        allowanceResetsAt: 1_900_000_000_000,
        payload: { chatId: 'c1', text: 'later', presentation: 'field' },
      },
      {
        id: 'i_bbb222',
        kind: 'ai.prompt',
        state: 'queued',
        gates: ['online'],
        payload: { chatId: 'c2' },
      },
      { id: 'i_ccc333', kind: 'ai.prompt', state: 'done', gates: [], payload: { chatId: 'c1' } },
      { id: 'i_ddd444', kind: 'share.invite', state: 'queued', gates: ['online'], payload: {} },
    ];
    const q = queuedForChat(intents, 'c1');
    expect(q).toHaveLength(1);
    expect(q[0].gates).toEqual(['ai-allowance']);
    expect(q[0].presentation).toBe('field');
    expect(q[0].askId).toBe('a_aaa111'); // the server's askIdForIntent: the run the drain makes carries it
    expect(queuedForChat(null, 'c1')).toEqual([]);
  });

  test('the meter says how much is used and when it resets, only while a warning stands', () => {
    const resets = Math.floor(new Date(2026, 9, 18, 18, 40).getTime() / 1000);
    expect(
      quotaModel({ status: 'allowed_warning', type: 'five_hour', pct: 90, resetsAt: resets })?.text
    ).toBe('90% of this 5-hour allowance used · resets 18:40');
    expect(quotaModel({ status: 'allowed', pct: 90 })).toBeNull();
    expect(quotaModel({ status: 'rejected', pct: 100 })).toBeNull();
    expect(quotaModel(null)).toBeNull();
  });
});

describe('the prompt frame (S5.6 client patch)', () => {
  test('an askId the server accepts, and a scope as data beside the bracket line', () => {
    const id = newAskId();
    expect(ASK_ID_RE.test(id)).toBe(true);
    expect(isAskId(id)).toBe(true);
    expect(newAskId()).not.toBe(id);
    const f = promptFrame({
      text: 'hi',
      chat: 'c1',
      askId: id,
      scope: { canvas: '.design/ui/A.tsx', artboards: ['a1'] },
    });
    expect(f).toMatchObject({
      t: 'prompt',
      text: 'hi',
      chat: 'c1',
      askId: id,
      scope: { canvas: '.design/ui/A.tsx', artboards: ['a1'] },
    });
    // a malformed id is dropped, not sent (the server would fold it into a double-submit guess)
    expect(promptFrame({ text: 'x', askId: 'nope' }).askId).toBeUndefined();
  });

  test('scope: whole canvas = "*", artboards = ids the server\'s regex takes, none = no scope', () => {
    const canvas = '.design/ui/A.tsx';
    expect(runScopeOf({ canvas, scope: { kind: 'whole', ids: [] } })).toEqual({
      canvas,
      artboards: '*',
    });
    expect(
      runScopeOf({ canvas, scope: { kind: 'artboards', ids: ['a', 'b', 'a', 'has space'] } })
    ).toEqual({
      canvas,
      artboards: ['a', 'b'],
    });
    expect(
      runScopeOf({ canvas, scope: { kind: 'artboards', ids: ['has space'] } })
    ).toBeUndefined();
    expect(runScopeOf({ canvas, scope: null })).toBeUndefined();
    expect(runScopeOf({ canvas: null, scope: { kind: 'whole' } })).toBeUndefined();
  });

  test('the frozen context carries the scope as data — and still the [maude-scope] line for old servers', () => {
    const canvas = '.design/ui/A.tsx';
    const whole = buildChatContext({ canvas, selected: null, scope: { kind: 'whole', ids: [] } });
    expect(whole?.runScope).toEqual({ canvas, artboards: '*' });
    expect(whole?.block).toContain('[maude-scope whole-canvas]');
    const some = buildChatContext({
      canvas,
      selected: null,
      scope: { kind: 'artboards', ids: ['x1'] },
    });
    expect(some?.runScope).toEqual({ canvas, artboards: ['x1'] });
    expect(some?.block).toContain('[maude-scope artboards="x1"]');
    expect(buildChatContext({ canvas, selected: null })?.runScope).toBeUndefined();
  });
});

describe('queued / run frames', () => {
  const queuedFrame = {
    t: 'queued',
    chat: 'c1',
    askId: 'a_abc123',
    intentId: 'i_abc123',
    gates: ['online'],
    words: OFFLINE_QUEUED,
    presentation: 'sent',
  };
  test('a queued frame adds the prompt; the run the drain makes (same askId) removes it', () => {
    const one = reduceQueued([], queuedFrame);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({
      intentId: 'i_abc123',
      gates: ['online'],
      words: OFFLINE_QUEUED,
    });
    expect(reduceQueued(one, { ...queuedFrame, gates: ['ai-ready'] })).toHaveLength(1); // same intent: replaced
    expect(reduceQueued(one, { t: 'run', run: { runId: 'r1', askId: 'a_other' } })).toBe(one);
    expect(reduceQueued(one, { t: 'run', run: { runId: 'r1', askId: 'a_abc123' } })).toEqual([]);
    expect(reduceQueued(one, { t: 'update' })).toBe(one);
  });

  test("the outbox merge keeps the frames' richer items, adds what a reload found, drops what was sent", () => {
    const fromFrame = reduceQueued([], queuedFrame);
    const rec = (id: string, gates: string[]) => ({
      intentId: id,
      askId: `a_${id.slice(2)}`,
      gates,
      words: null,
      presentation: 'sent',
      allowanceResetsAt: null,
      text: '',
    });
    // still queued, gates moved on: updated in place, words kept
    const a = mergeOutbox(fromFrame, [rec('i_abc123', ['ai-connected'])]);
    expect(a[0].gates).toEqual(['ai-connected']);
    expect(a[0].words).toBe(OFFLINE_QUEUED);
    // a prompt only the outbox knows (a reload) is added
    expect(mergeOutbox([], [rec('i_zzz999', ['online'])])).toHaveLength(1);
    // released (no longer queued in the outbox): gone
    expect(mergeOutbox(fromFrame, [])).toEqual([]);
    // nothing changed → the same array (no re-render)
    const same = mergeOutbox(a, [rec('i_abc123', ['ai-connected'])]);
    expect(same).toBe(a);
  });
});

describe('Connect: install if missing, sign in, wait until present', () => {
  type Step = { match: string; body: unknown };
  function rig(steps: Step[]) {
    const calls: string[] = [];
    const fetchImpl = async (url: string, init?: { method?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      const i = steps.findIndex((s) => s.match === url);
      const step = i >= 0 ? steps.splice(i, 1)[0] : { body: {} };
      return { ok: true, json: async () => step.body } as Response;
    };
    return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
  }
  const pre = (item: object) => ({ items: [{ id: 'claude', ...item }] });
  const base = { sleep: async () => {}, now: () => 0 };

  test('already connected → nothing to do', async () => {
    const { calls, fetchImpl } = rig([
      { match: '/_api/preflight', body: pre({ status: 'present' }) },
    ]);
    expect(await connectClaude({ ...base, fetchImpl })).toEqual({ ok: true });
    expect(calls).toEqual(['GET /_api/preflight']);
  });

  test('missing → install, wait for it, then ONE click goes on to the browser sign-in', async () => {
    const phases: string[] = [];
    const { calls, fetchImpl } = rig([
      { match: '/_api/preflight', body: pre({ status: 'missing', action: 'install' }) },
      { match: '/_api/claude/install', body: { ok: true } },
      { match: '/_api/claude/install-status', body: { phase: 'running' } },
      { match: '/_api/claude/install-status', body: { phase: 'done', ok: true } },
      { match: '/_api/claude/signin', body: { ok: true } },
      { match: '/_api/preflight', body: pre({ status: 'present' }) },
    ]);
    const r = await connectClaude({ ...base, fetchImpl, onPhase: (p: string) => phases.push(p) });
    expect(r).toEqual({ ok: true });
    expect(phases).toEqual(['installing', 'waiting']);
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual([
      'POST /_api/claude/install',
      'POST /_api/claude/signin',
    ]);
  });

  test('a failed install says why and never opens a sign-in', async () => {
    const { calls, fetchImpl } = rig([
      { match: '/_api/preflight', body: pre({ status: 'missing', action: 'install' }) },
      { match: '/_api/claude/install', body: { ok: true } },
      {
        match: '/_api/claude/install-status',
        body: { phase: 'done', ok: false, reason: 'No network.' },
      },
    ]);
    expect(await connectClaude({ ...base, fetchImpl })).toEqual({
      ok: false,
      reason: 'No network.',
    });
    expect(calls).not.toContain('POST /_api/claude/signin');
  });

  test('cancel while waiting for the browser withdraws the sign-in', async () => {
    const ctl = new AbortController();
    const { calls, fetchImpl } = rig([
      { match: '/_api/preflight', body: pre({ status: 'missing', action: 'signin' }) },
      { match: '/_api/claude/signin', body: { ok: true } },
    ]);
    const r = await connectClaude({
      ...base,
      fetchImpl,
      signal: ctl.signal,
      sleep: async () => ctl.abort(),
    });
    expect(r).toEqual({ ok: false, reason: 'cancelled' });
    expect(calls).toContain('POST /_api/claude/signin-cancel');
  });
});

describe('the Needs-you count behind the folded spark', () => {
  test("the larger of the open chats' own questions and the server's number", () => {
    resetNeedsYou();
    expect(getNeedsYou()).toBe(0);
    setLocalNeedsYou('c1', 1);
    expect(getNeedsYou()).toBe(1);
    setLocalNeedsYou('c2', 2);
    expect(getNeedsYou()).toBe(3);
    setServerNeedsYou(5); // a chat this tab never attached to is waiting too
    expect(getNeedsYou()).toBe(5);
    setServerNeedsYou(0);
    setLocalNeedsYou('c1', 0);
    setLocalNeedsYou('c2', 0);
    expect(getNeedsYou()).toBe(0);
    resetNeedsYou();
  });

  test('the feed reads GET /_api/ai/runs, again on the shell relay event, and stops cleanly', async () => {
    resetNeedsYou();
    const win = new EventTarget();
    let n = 2;
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return { ok: true, json: async () => ({ needsYou: n }) };
    }) as unknown as typeof fetch;
    const stop = startNeedsYouFeed({ fetchImpl, win: win as unknown as Window, pollMs: 0 });
    await new Promise((r) => setTimeout(r, 5));
    expect(urls).toEqual(['/_api/ai/runs']);
    expect(getNeedsYou()).toBe(2);
    n = 0;
    win.dispatchEvent(new Event('maude:ai-runs'));
    await new Promise((r) => setTimeout(r, 5));
    expect(getNeedsYou()).toBe(0);
    stop();
    win.dispatchEvent(new Event('maude:ai-runs'));
    await new Promise((r) => setTimeout(r, 5));
    expect(urls).toHaveLength(2);
    resetNeedsYou();
  });
});

describe('in-app toasts', () => {
  test('Needs you quotes the question and names the canvas; it has no short timer', () => {
    const n = needsYouNotice({
      id: 'n1',
      canvas: '.design/ui/Uniformy-2027.tsx',
      line: 'Replace 4 team photos',
      onOpen: () => {},
    });
    expect(n.title).toBe('AI needs you on Uniformy-2027 — replace 4 team photos?');
    expect(n.action.label).toBe('Open');
    expect(n.duration).toBeGreaterThan(60_000);
    expect(needsYouNotice({ id: 'n2', canvas: null, line: '', onOpen: () => {} }).title).toBe(
      'AI needs you'
    );
  });
  test("Done is the reply's own first sentence — and nothing at all for a turn that said nothing", () => {
    expect(doneLine('Done — Post 1:1 is greener. The logo stays white.')).toBe(
      'Done — Post 1:1 is greener.'
    );
    expect(doneNotice({ id: 'd', text: '   ', onShow: () => {} })).toBeNull();
    expect(doneNotice({ id: 'd', text: 'Done — ok.', onShow: () => {} })?.action.label).toBe(
      'Show'
    );
    expect(canvasTitle('.design/ui/Combine-kampan.tsx')).toBe('Combine-kampan');
  });
});
