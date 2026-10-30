// S6.3 — the project window takes the intent Home parked for it, once, and does it.
// Pure module + a scripted fetch; happy-dom only so `location` can be asserted (the prompt is never in a URL).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => GlobalRegistrator.register({ url: 'http://localhost:4399/' }));
afterAll(() => GlobalRegistrator.unregister());

const SENTENCE = 'A calm landing page for a Brno architecture studio';
const ROLE = 'You can view this canvas. Ask a project owner for edit access.';

type Call = { url: string; init?: RequestInit };

/** A scripted fetch: POST /_api/canvas → the canvas it names; POST /_api/cloud/move → `move`. */
function fakeFetch(move: { status: number; body: unknown } = { status: 404, body: {} }) {
  const calls: Call[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === '/_api/canvas') {
      return new Response(JSON.stringify({ ok: true, file: '.design/ui/Landing page.tsx' }), {
        status: 200,
      });
    }
    if (url === '/_api/cloud/move') {
      return new Response(JSON.stringify(move.body), { status: move.status });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function deps(over: Record<string, unknown> = {}) {
  const log: string[] = [];
  const toasts: Array<{ m: string; ok?: boolean; action?: { label: string } }> = [];
  const f = fakeFetch();
  const d = {
    canEdit: () => true,
    roleDenial: ROLE,
    toast: (m: string, ok?: boolean, action?: { label: string }) => toasts.push({ m, ok, action }),
    fetchImpl: f.impl,
    open: (file: string) => log.push(`open:${file}`),
    runAction: (id: string) => log.push(`action:${id}`),
    firstDraft: undefined as unknown,
    ...over,
  };
  return { d, log, toasts, f };
}

describe('S6.3 validateIntent — the page re-checks what Rust already refused', () => {
  test('the four kinds pass; anything else is dropped', async () => {
    const { validateIntent } = await import('../client/v2/create/take-intent.js');
    expect(validateIntent({ kind: 'create-canvas', prompt: SENTENCE })).toEqual({
      kind: 'create-canvas',
      prompt: SENTENCE,
      moveToCloud: false,
    });
    expect(validateIntent({ kind: 'create-empty' })).toEqual({
      kind: 'create-empty',
      prompt: '',
      moveToCloud: false,
    });
    expect(validateIntent({ kind: 'import-brand', prompt: 'the spring palette' })).not.toBeNull();
    expect(validateIntent({ kind: 'import-figma' })).not.toBeNull();
    for (const kind of [
      '',
      'Create-Canvas',
      'run-shell',
      'move-to-cloud',
      'import-figma ',
      7,
      null,
    ]) {
      expect(validateIntent({ kind, prompt: 'x' })).toBeNull();
    }
    for (const bad of [null, undefined, 'create-canvas', 4, []]) {
      expect(validateIntent(bad)).toBeNull();
    }
  });

  test('the prompt rules are Rust’s: a sentence for create-canvas, none for create-empty, 4000 at most', async () => {
    const { validateIntent } = await import('../client/v2/create/take-intent.js');
    expect(validateIntent({ kind: 'create-canvas', prompt: '' })).toBeNull();
    expect(validateIntent({ kind: 'create-canvas', prompt: '   ' })).toBeNull();
    expect(validateIntent({ kind: 'create-canvas' })).toBeNull();
    expect(validateIntent({ kind: 'create-empty', prompt: 'start an AI run' })).toBeNull();
    expect(validateIntent({ kind: 'create-canvas', prompt: 'x'.repeat(4000) })).not.toBeNull();
    expect(validateIntent({ kind: 'create-canvas', prompt: 'x'.repeat(4001) })).toBeNull();
    expect(validateIntent({ kind: 'import-brand', prompt: 'x'.repeat(4001) })).toBeNull();
    expect(validateIntent({ kind: 'create-canvas', prompt: 42 })).toBeNull();
  });

  test('moveToCloud rides only as the boolean true', async () => {
    const { validateIntent } = await import('../client/v2/create/take-intent.js');
    expect(validateIntent({ kind: 'create-empty', moveToCloud: true })?.moveToCloud).toBe(true);
    expect(validateIntent({ kind: 'create-empty', moveToCloud: 'yes' })?.moveToCloud).toBe(false);
  });
});

describe('S6.3 runIntent', () => {
  test('create-canvas: the create call carries the sentence, the canvas opens, THEN the sentence goes to a new chat', async () => {
    const { runIntent } = await import('../client/v2/create/take-intent.js');
    const { d, log, f } = deps();
    const sent: unknown[] = [];
    d.firstDraft = undefined;
    const { startFirstDraft } = await import('../client/v2/create/first-draft.js');
    const out = await runIntent(
      { kind: 'create-canvas', prompt: SENTENCE },
      {
        ...d,
        firstDraft: (p: string, dd: Record<string, unknown>) =>
          startFirstDraft(p, {
            ...dd,
            send: (detail: unknown) => {
              log.push('send');
              sent.push(detail);
              return true;
            },
          }),
      }
    );
    expect(out).toEqual({ ok: true, file: '.design/ui/Landing page.tsx' });
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({
      kind: 'blank',
      fromPrompt: SENTENCE,
    });
    expect(log).toEqual(['open:.design/ui/Landing page.tsx', 'send']);
    expect(sent).toEqual([
      { prompt: SENTENCE, scope: { canvas: '.design/ui/Landing page.tsx' }, newChat: true },
    ]);
  });

  test('the sentence is never in a URL: not the fetch URL, not location, not history', async () => {
    const { runIntent } = await import('../client/v2/create/take-intent.js');
    const { d, f } = deps();
    await runIntent({ kind: 'create-canvas', prompt: SENTENCE }, d);
    for (const c of f.calls) expect(c.url).not.toContain(encodeURIComponent(SENTENCE));
    for (const c of f.calls) expect(c.url).not.toContain('Brno');
    expect(location.href).toBe('http://localhost:4399/');
    expect(location.search).toBe('');
    expect(location.hash).toBe('');
    expect(String(history.state ?? '')).not.toContain('Brno');
  });

  test('create-empty: a blank canvas, no sentence, nothing sent to AI', async () => {
    const { runIntent } = await import('../client/v2/create/take-intent.js');
    const { d, log, f } = deps();
    const out = await runIntent({ kind: 'create-empty' }, d);
    expect(out.ok).toBe(true);
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ kind: 'blank' });
    expect(log).toEqual(['open:.design/ui/Landing page.tsx']);
  });

  test('import-brand / import-figma run their registry action and carry no sentence into it', async () => {
    const { runIntent } = await import('../client/v2/create/take-intent.js');
    for (const [kind, id] of [
      ['import-brand', 'import.brand'],
      ['import-figma', 'import.figma'],
    ]) {
      const { d, log, f } = deps();
      const out = await runIntent({ kind, prompt: 'the spring palette' }, d);
      expect(out).toEqual({ ok: true });
      expect(log).toEqual([`action:${id}`]);
      expect(f.calls).toHaveLength(0);
    }
  });

  test('import-figma: a Figma link rides to the sheet once (never a sentence, never a token)', async () => {
    const { runIntent } = await import('../client/v2/create/take-intent.js');
    const { takeFigmaPrefill } = await import('../client/v2/import/figma-prefill.js');
    const { d, log } = deps();
    await runIntent({ kind: 'import-figma', prompt: 'figma.com/design/AbC/Uniformy' }, d);
    expect(log).toEqual(['action:import.figma']);
    expect(takeFigmaPrefill()).toBe('https://figma.com/design/AbC/Uniformy');
    expect(takeFigmaPrefill()).toBe(''); // taken once
    await runIntent({ kind: 'import-figma', prompt: 'the spring palette' }, d);
    expect(takeFigmaPrefill()).toBe('');
    await runIntent({ kind: 'import-figma', prompt: 'https://evil.example/design/x' }, d);
    expect(takeFigmaPrefill()).toBe('');
  });

  test('a Can view / Can comment project refuses with the role line and makes nothing', async () => {
    const { runIntent } = await import('../client/v2/create/take-intent.js');
    for (const kind of ['create-canvas', 'create-empty', 'import-brand', 'import-figma']) {
      const { d, log, toasts, f } = deps({ canEdit: () => false });
      const out = await runIntent(
        { kind, prompt: kind === 'create-empty' ? '' : SENTENCE, moveToCloud: true },
        d
      );
      expect(out).toEqual({ ok: false, reason: 'role' });
      expect(toasts.map((t) => t.m)).toEqual([ROLE]);
      expect(log).toEqual([]);
      expect(f.calls).toEqual([]);
    }
  });

  test('an invalid intent does nothing at all', async () => {
    const { runIntent } = await import('../client/v2/create/take-intent.js');
    const { d, log, toasts, f } = deps();
    expect(await runIntent({ kind: 'run-shell', prompt: 'rm -rf /' }, d)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect([log, toasts, f.calls]).toEqual([[], [], []]);
  });

  test('a failed create sends nothing to AI', async () => {
    const { runIntent } = await import('../client/v2/create/take-intent.js');
    const { startFirstDraft } = await import('../client/v2/create/first-draft.js');
    const { d, log, toasts } = deps({
      fetchImpl: (async () =>
        new Response('{"ok":false}', { status: 500 })) as unknown as typeof fetch,
    });
    let sent = 0;
    const out = await runIntent(
      { kind: 'create-canvas', prompt: SENTENCE },
      {
        ...d,
        firstDraft: (p: string, dd: Record<string, unknown>) =>
          startFirstDraft(p, { ...dd, send: () => ++sent > 0 }),
      }
    );
    expect(out).toEqual({ ok: false, reason: 'create' });
    expect(sent).toBe(0);
    expect(log).toEqual([]);
    expect(toasts.map((t) => t.m)).toEqual([
      'Could not make a canvas. Nothing was changed. Try again.',
    ]);
  });

  test('moveToCloud: the canvas first, then the move; 200 says "<project> is your first project…" with Rename', async () => {
    const { runIntent, firstProjectWords } = await import('../client/v2/create/take-intent.js');
    const f = fakeFetch({
      status: 200,
      body: { ok: true, project: 'Open studio', state: 'provisioning' },
    });
    const { d, toasts } = deps({ fetchImpl: f.impl, onRename: () => {} });
    await runIntent({ kind: 'create-empty', moveToCloud: true }, d);
    await new Promise((r) => setTimeout(r, 5));
    expect(f.calls.map((c) => c.url)).toEqual(['/_api/canvas', '/_api/cloud/move']);
    expect(f.calls[1].init?.method).toBe('POST');
    expect(toasts).toHaveLength(1);
    expect(toasts[0].m).toBe(firstProjectWords('Open studio'));
    expect(toasts[0].m).toBe('Open studio is your first project, on cloud.maude.sh.');
    expect(toasts[0].action?.label).toBe('Rename');
  });

  test('moveToCloud that the route refuses (404, 401, 402, 409, offline) stays local and says nothing', async () => {
    const { runIntent } = await import('../client/v2/create/take-intent.js');
    for (const status of [404, 401, 402, 403, 409, 503]) {
      const f = fakeFetch({ status, body: { ok: false, reason: 'x' } });
      const { d, toasts } = deps({ fetchImpl: f.impl });
      const out = await runIntent({ kind: 'create-empty', moveToCloud: true }, d);
      await new Promise((r) => setTimeout(r, 5));
      expect(out.ok).toBe(true);
      expect(toasts).toEqual([]);
    }
  });

  test('no moveToCloud flag → the move route is never called', async () => {
    const { runIntent } = await import('../client/v2/create/take-intent.js');
    const { d, f } = deps();
    await runIntent({ kind: 'create-empty' }, d);
    await new Promise((r) => setTimeout(r, 5));
    expect(f.calls.map((c) => c.url)).toEqual(['/_api/canvas']);
  });
});

describe('S6.3 startIntentConsumer — taken once', () => {
  /** What Rust does: `take_pending_intent` hands the parked intent over once. */
  function shell(parked: unknown) {
    let slot: unknown = parked;
    const nudges: Array<() => void> = [];
    return {
      invoke: async (cmd: string) => {
        if (cmd !== 'take_pending_intent') throw new Error('unknown command');
        const v = slot;
        slot = null;
        return v;
      },
      listen: async (event: string, h: () => void) => {
        if (event === 'shell://intent') nudges.push(h);
        return () => nudges.splice(nudges.indexOf(h), 1);
      },
      park(v: unknown) {
        slot = v;
        for (const h of [...nudges]) h();
      },
      nudges,
    };
  }
  const settle = () => new Promise((r) => setTimeout(r, 5));

  test('the boot ask and a nudge for the same intent run it once', async () => {
    const { startIntentConsumer } = await import('../client/v2/create/take-intent.js');
    const sh = shell({ kind: 'create-empty' });
    const ran: unknown[] = [];
    const stop = startIntentConsumer({ ...sh, run: (r) => ran.push(r) });
    await settle();
    sh.nudges.forEach((h) => h()); // the nudge for what the boot ask already took
    await settle();
    expect(ran).toEqual([{ kind: 'create-empty' }]);
    stop();
  });

  test('a reload (a second consumer on the same window) finds nothing and runs nothing', async () => {
    const { startIntentConsumer } = await import('../client/v2/create/take-intent.js');
    const sh = shell({ kind: 'create-canvas', prompt: SENTENCE });
    const ran: unknown[] = [];
    const stopFirst = startIntentConsumer({ ...sh, run: (r) => ran.push(r) });
    await settle();
    stopFirst();
    expect(ran).toHaveLength(1);
    startIntentConsumer({ ...sh, run: (r) => ran.push(r) });
    await settle();
    expect(ran).toHaveLength(1);
  });

  test('an intent parked AFTER start is taken on the nudge', async () => {
    const { startIntentConsumer } = await import('../client/v2/create/take-intent.js');
    const sh = shell(null);
    const ran: unknown[] = [];
    startIntentConsumer({ ...sh, run: (r) => ran.push(r) });
    await settle();
    expect(ran).toEqual([]);
    sh.park({ kind: 'import-figma' });
    await settle();
    expect(ran).toEqual([{ kind: 'import-figma' }]);
  });

  test('a shell without the intent lane (invoke rejects) is not an error', async () => {
    const { startIntentConsumer } = await import('../client/v2/create/take-intent.js');
    const ran: unknown[] = [];
    const stop = startIntentConsumer({
      invoke: async () => {
        throw new Error('unknown command');
      },
      listen: async () => () => {},
      run: (r) => ran.push(r),
    });
    await settle();
    expect(ran).toEqual([]);
    stop();
  });

  test('stop() unlistens, and a take that lands after stop() is not run', async () => {
    const { startIntentConsumer } = await import('../client/v2/create/take-intent.js');
    const sh = shell({ kind: 'create-empty' });
    const ran: unknown[] = [];
    const stop = startIntentConsumer({ ...sh, run: (r) => ran.push(r) });
    stop();
    await settle();
    expect(ran).toEqual([]);
    expect(sh.nudges).toHaveLength(0);
  });
});

describe('S10.16c make-ds — Home’s "A design system" starter', () => {
  test('a fifth kind; it carries no sentence into the sheet (an empty prompt, like create-empty)', async () => {
    const { validateIntent, INTENT_KINDS } = await import('../client/v2/create/take-intent.js');
    expect([...INTENT_KINDS]).toContain('make-ds');
    expect(validateIntent({ kind: 'make-ds' })).toEqual({
      kind: 'make-ds',
      prompt: '',
      moveToCloud: false,
    });
    expect(validateIntent({ kind: 'make-ds', prompt: 'a calm studio' })).toBeNull();
    expect(validateIntent({ kind: 'make-ds ', prompt: '' })).toBeNull();
  });

  test('it runs `ds.make` (the three-input sheet) and creates nothing', async () => {
    const { runIntent } = await import('../client/v2/create/take-intent.js');
    const { d, log, f } = deps();
    expect(await runIntent({ kind: 'make-ds' }, d)).toEqual({ ok: true });
    expect(log).toEqual(['action:ds.make']);
    expect(f.calls).toHaveLength(0);
  });

  test('a Can view / Can comment project refuses with the role line and opens no sheet', async () => {
    const { runIntent } = await import('../client/v2/create/take-intent.js');
    const { d, log, toasts } = deps({ canEdit: () => false });
    expect(await runIntent({ kind: 'make-ds' }, d)).toEqual({ ok: false, reason: 'role' });
    expect(toasts.map((t) => t.m)).toEqual([ROLE]);
    expect(log).toEqual([]);
  });
});
