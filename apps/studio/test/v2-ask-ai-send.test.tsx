// S10.16c — askAI(text, { send, origin }): the DS hosts' own gesture starts the run, nothing else does.
// ⌘K and every other caller still only fill the composer (test/v2-search.test.ts, v2-ai-host.test.ts); a
// listed origin (ds-make · ds-upgrade · ds-restyle · ds-review) with send:true also sends — through every
// gate a typed send meets (not connected · a run in progress · the viewer role · a chat that is not in front).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

let registeredHere = false;
beforeAll(async () => {
  if (typeof document === 'undefined') {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    GlobalRegistrator.register();
    registeredHere = true;
  }
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (registeredHere && GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { canSendAskAI, useAskAI } from '../client/v2/ai/use-ask-ai.js';
import {
  ASK_AI_EVENT,
  ASK_AI_PENDING_KEY,
  ASK_AI_SEND_ORIGINS,
  askAIOpts,
  sendToAskAI,
  subscribeAskAI,
} from '../client/v2/search/search-env.js';

type Target = EventTarget & Record<string, unknown>;
const fresh = () => new EventTarget() as Target;

describe('askAIOpts — only the DS origins may send', () => {
  test('the four origins, exactly', () => {
    expect([...ASK_AI_SEND_ORIGINS]).toEqual(['ds-make', 'ds-upgrade', 'ds-restyle', 'ds-review']);
  });
  test('send:true on a listed origin is kept; every other shape only fills', () => {
    for (const origin of ASK_AI_SEND_ORIGINS)
      expect(askAIOpts({ send: true, origin })).toEqual({ send: true, origin });
    expect(askAIOpts({ send: true, origin: 'templates' })).toEqual({
      send: false,
      origin: 'templates',
    });
    expect(askAIOpts({ send: true }).send).toBe(false);
    expect(askAIOpts({ send: 'yes', origin: 'ds-make' }).send).toBe(false);
    expect(askAIOpts({ origin: 'ds-make' }).send).toBe(false);
    expect(askAIOpts(undefined)).toEqual({ send: false, origin: null });
    expect(askAIOpts({ send: true, origin: { x: 1 } }).send).toBe(false);
  });
});

describe('sendToAskAI / subscribeAskAI carry the opts', () => {
  test('the event detail and the parked value carry { send, origin }; a plain call stays {text}', () => {
    const target = fresh();
    const seen: unknown[] = [];
    target.addEventListener(ASK_AI_EVENT, (e) => seen.push((e as CustomEvent).detail));
    sendToAskAI('plain', target);
    sendToAskAI('make it', target, { send: true, origin: 'ds-make' });
    sendToAskAI('sneaky', target, { send: true, origin: 'palette' });
    expect(seen).toEqual([
      { text: 'plain' },
      { text: 'make it', send: true, origin: 'ds-make' },
      { text: 'sneaky', origin: 'palette' },
    ]);
    expect(target[ASK_AI_PENDING_KEY]).toEqual({ text: 'sneaky', origin: 'palette' });
  });

  test('a panel that mounts after the event takes the parked opts once', () => {
    const target = fresh();
    sendToAskAI('brief', target, { send: true, origin: 'ds-restyle' });
    const got: Array<[string, unknown]> = [];
    const off = subscribeAskAI((t: string, o: unknown) => got.push([t, o]), target);
    expect(got).toEqual([['brief', { send: true, origin: 'ds-restyle' }]]);
    expect(target[ASK_AI_PENDING_KEY]).toBeUndefined();
    off();
  });

  test('a forged detail on the event cannot send: the subscriber re-checks the origin', () => {
    const target = fresh();
    const got: Array<[string, { send: boolean }]> = [];
    const off = subscribeAskAI((t: string, o: { send: boolean }) => got.push([t, o]), target);
    target.dispatchEvent(
      new CustomEvent(ASK_AI_EVENT, { detail: { text: 'forged', send: true, origin: 'anything' } })
    );
    target.dispatchEvent(
      new CustomEvent(ASK_AI_EVENT, { detail: { text: 'forged2', send: true } })
    );
    expect(got.map(([, o]) => o.send)).toEqual([false, false]);
    off();
  });

  test('a subscriber that is not in front ignores the ask and leaves it parked for the one that is', () => {
    const target = fresh();
    sendToAskAI('brief', target, { send: true, origin: 'ds-make' });
    const hidden: string[] = [];
    const front: string[] = [];
    const offH = subscribeAskAI((t: string) => hidden.push(t), target, { accepts: () => false });
    expect(hidden).toEqual([]);
    expect(target[ASK_AI_PENDING_KEY]).toBeTruthy();
    const offF = subscribeAskAI((t: string) => front.push(t), target, { accepts: () => true });
    expect(front).toEqual(['brief']);
    offH();
    offF();
  });
});

describe('canSendAskAI — the composer gates', () => {
  const ok = { active: true, unavailable: false, viewer: false, running: false };
  test('open when nothing blocks', () => expect(canSendAskAI(ok)).toBe(true));
  test.each([
    ['not connected', { unavailable: true }],
    ['a run in progress', { running: true }],
    ['the viewer role', { viewer: true }],
    ['a chat that is not in front', { active: false }],
  ])('%s → no send', (_n, over) => expect(canSendAskAI({ ...ok, ...over })).toBe(false));
});

function Probe({
  runtime,
  gates,
}: {
  runtime: { setText(t: string): void; send(): void };
  gates: { active: boolean; unavailable: boolean; viewer: boolean; running: boolean };
}) {
  useAskAI({ composerRuntime: runtime, ...gates });
  return null;
}

async function mount(gates: Parameters<typeof Probe>[0]['gates']) {
  const calls: string[] = [];
  const runtime = {
    setText: (t: string) => calls.push(`text:${t}`),
    send: () => calls.push('send'),
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<Probe runtime={runtime} gates={gates} />);
  });
  return {
    calls,
    ask: (text: string, opts?: { send?: boolean; origin?: string }) =>
      act(async () => {
        sendToAskAI(text, globalThis as unknown as Target, opts);
      }),
    done: () =>
      act(async () => {
        root.unmount();
        (globalThis as Target)[ASK_AI_PENDING_KEY] = undefined;
      }),
  };
}

const OPEN = { active: true, unavailable: false, viewer: false, running: false };

describe('useAskAI — fills, and sends only for a DS origin through the gates', () => {
  test('⌘K / palette / unlisted origin: text only, never sent', async () => {
    const m = await mount(OPEN);
    await m.ask('make the hero calmer');
    await m.ask('x', { send: true, origin: 'templates' });
    expect(m.calls).toEqual(['text:make the hero calmer', 'text:x']);
    await m.done();
  });

  test('a DS origin with send:true fills, then sends once', async () => {
    const m = await mount(OPEN);
    await m.ask('Make a design system…', { send: true, origin: 'ds-make' });
    expect(m.calls).toEqual(['text:Make a design system…', 'send']);
    await m.done();
  });

  test.each([
    ['not connected', { ...OPEN, unavailable: true }],
    ['a run in progress', { ...OPEN, running: true }],
    ['the viewer role', { ...OPEN, viewer: true }],
  ])('%s: the text stays in the composer and nothing is sent', async (_n, gates) => {
    const m = await mount(gates);
    await m.ask('brief', { send: true, origin: 'ds-restyle' });
    expect(m.calls).toEqual(['text:brief']);
    await m.done();
  });

  test('a chat that is not in front neither fills nor sends', async () => {
    const m = await mount({ ...OPEN, active: false });
    await m.ask('brief', { send: true, origin: 'ds-make' });
    expect(m.calls).toEqual([]);
    await m.done();
  });
});
