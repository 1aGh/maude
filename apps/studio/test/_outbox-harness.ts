// Shared harness for the outbox tests (V2-1.14 §7): a temp design root, a
// fake clock with a fake timer, open/closed gate facts, a scripted target and
// recording senders. Not a test file itself (leading underscore).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createOutbox,
  type EnqueueInput,
  type GateFacts,
  type IntentKind,
  type IntentRecord,
  type Outbox,
  type Sender,
  type TargetAnswer,
  type TargetFacts,
} from '../outbox/index.ts';

export const OPEN: GateFacts = {
  online: true,
  hubReachable: true,
  signedIn: true,
  aiConnected: true,
  aiReady: true,
  allowanceResetsAt: null,
};

export interface Harness {
  root: string;
  outbox: Outbox;
  clock: { t: number; advance(ms: number): Promise<void> };
  gates: GateFacts;
  facts: TargetFacts;
  /** per-record overrides of the target facts */
  factsFor: Map<string, Partial<TargetFacts>>;
  sent: Array<{ id: string; kind: IntentKind; attempts: number }>;
  /** what the next send of a kind answers (default ok) */
  answers: Partial<Record<IntentKind, TargetAnswer[]>>;
  contentPending: number[];
  dispose(): void;
  reopen(): Outbox;
}

let n = 0;
const seqId = () => `i_${String(++n).padStart(20, '0')}`;

export function harness(over: { root?: string } = {}): Harness {
  const root = over.root ?? mkdtempSync(path.join(tmpdir(), 'outbox-'));
  const timers: Array<{ at: number; fn: () => void; h: number }> = [];
  let hid = 0;
  const h: Harness = {
    root,
    outbox: null as unknown as Outbox,
    clock: {
      t: 1_760_000_000_000,
      async advance(ms: number) {
        h.clock.t += ms;
        for (const tm of [...timers].sort((a, b) => a.at - b.at)) {
          if (tm.at <= h.clock.t) {
            timers.splice(timers.indexOf(tm), 1);
            tm.fn();
          }
        }
        // let the woken pass run
        for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
      },
    },
    gates: { ...OPEN },
    facts: { projectId: 'p1', projectName: 'Alligators brand', role: 'owner' },
    factsFor: new Map(),
    sent: [],
    answers: {},
    contentPending: [],
    dispose() {
      h.outbox.drain.stop();
      rmSync(root, { recursive: true, force: true });
    },
    reopen() {
      h.outbox.drain.stop();
      h.outbox = build();
      h.outbox.store.load();
      return h.outbox;
    },
  };
  const sender: Sender = async (r: IntentRecord) => {
    h.sent.push({ id: r.id, kind: r.kind, attempts: r.attempts });
    const q = h.answers[r.kind];
    return q?.length ? (q.shift() as TargetAnswer) : { ok: true, ref: `ref-${r.id}` };
  };
  const build = () =>
    createOutbox({
      designRoot: root,
      now: () => h.clock.t,
      newId: seqId,
      rand: () => 0.5,
      senders: {
        'ai.prompt': sender,
        'share.invite': sender,
        'share.ask-to-edit': sender,
        'export.cloud': sender,
        'export.handoff': sender,
      },
      gates: () => h.gates,
      target: (r) => ({ ...h.facts, ...(h.factsFor.get(r.id) ?? {}) }),
      contentPending: () => h.contentPending,
      setTimer: (fn, ms) => {
        const t = { at: h.clock.t + ms, fn, h: ++hid };
        timers.push(t);
        return t.h;
      },
      clearTimer: (handle) => {
        const i = timers.findIndex((t) => t.h === handle);
        if (i >= 0) timers.splice(i, 1);
      },
      log: { warn() {} },
    });
  h.outbox = build();
  return h;
}

/** Let any in-flight wake settle. */
export const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

const base = {
  actor: 'michal',
  device: 'mac-1',
  project: { id: 'p1', hub: 'https://hub.example' },
};

export function prompt(
  chatId: string,
  text: string,
  extra: Partial<EnqueueInput> = {}
): EnqueueInput {
  return {
    ...base,
    kind: 'ai.prompt',
    label: 'Three reel covers',
    target: { chatId, canvas: 'ui-reel' },
    payload: {
      kind: 'ai.prompt',
      chatId,
      text,
      scope: null,
      attachments: [],
      presentation: 'sent',
    },
    ...extra,
  };
}

export function invite(
  email: string,
  role: 'view' | 'comment' | 'edit' = 'edit',
  extra: Partial<EnqueueInput> = {}
): EnqueueInput {
  return {
    ...base,
    kind: 'share.invite',
    label: `Invite ${email.split('@')[0]}@… · Can ${role}`,
    payload: { kind: 'share.invite', email, role, scope: 'project', message: 'Come draw with us' },
    ...extra,
  };
}

export function cloudExport(
  spec: Record<string, unknown>,
  extra: Partial<EnqueueInput> = {}
): EnqueueInput {
  return {
    ...base,
    kind: 'export.cloud',
    label: 'Reel · MP4',
    target: { canvas: 'ui-reel' },
    payload: { kind: 'export.cloud', spec, saveTo: '~/Movies' },
    ...extra,
  };
}

export function handoff(
  canvas: string,
  target: string,
  extra: Partial<EnqueueInput> = {}
): EnqueueInput {
  return {
    ...base,
    kind: 'export.handoff',
    label: `Hand off ${canvas}`,
    target: { canvas },
    payload: { kind: 'export.handoff', canvas, target },
    ...extra,
  };
}

export function ask(extra: Partial<EnqueueInput> = {}): EnqueueInput {
  return {
    ...base,
    kind: 'share.ask-to-edit',
    label: 'Ask to edit',
    payload: { kind: 'share.ask-to-edit', scope: 'project', note: 'please' },
    ...extra,
  };
}

/** Enqueue through the store directly (no auto-wake) and return the record. */
export function put(h: Harness, input: EnqueueInput): IntentRecord {
  const r = h.outbox.store.enqueue({ watermark: null, ...input });
  if (!r.ok) throw new Error(`enqueue refused: ${r.code} ${r.errors?.join(',') ?? ''}`);
  return r.record;
}
