// E2E finding (scripts/acp-e2e-local.ts, 2026-11-12) — a chat that runs another agent (Codex,
// opencode) was held by the CLAUDE sign-in gate: on a Mac where Claude is not signed in, a connected
// Codex chat's prompt was queued forever with "Connect your Claude account to let AI draft this."
// The plan's Decision 1 says a person without Claude can use another agent (Settings › AI agents).
// The `ai-connected` fact is Claude's; another agent's connection is checked at attach
// (`agent-not-connected`), so its prompt is not held by Claude's gate — at the send AND at release.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAskQueue } from '../acp/ask-queue.ts';
import { closedGates, createOutbox, type GateFacts } from '../outbox/index.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const signedOut: GateFacts = {
  online: true,
  hubReachable: true,
  signedIn: true,
  aiConnected: false,
  aiReady: true,
  allowanceResetsAt: null,
};
const project = { id: null, hub: null };

describe('closedGates — the Claude sign-in gate holds Claude chats only', () => {
  const rec = (agent?: string) => ({
    kind: 'ai.prompt' as const,
    project,
    watermark: null,
    payload: {
      kind: 'ai.prompt' as const,
      chatId: 'c',
      text: 't',
      scope: null,
      attachments: [],
      presentation: 'sent' as const,
      ...(agent ? { agent } : {}),
    },
  });
  test('a Claude chat (no agent named, or claude) waits for Claude', () => {
    expect(closedGates(rec(), signedOut, [], 0)).toContain('ai-connected');
    expect(closedGates(rec('claude'), signedOut, [], 0)).toContain('ai-connected');
  });
  test('a Codex chat does not', () => {
    expect(closedGates(rec('codex'), signedOut, [], 0)).not.toContain('ai-connected');
  });
  test('the other gates still hold it', () => {
    expect(closedGates(rec('codex'), { ...signedOut, online: false }, [], 0)).toContain('online');
  });
});

describe('the ask queue — a Codex chat on a Mac without Claude sends now', () => {
  function queue() {
    const root = mkdtempSync(join(tmpdir(), 'maude-agent-gate-'));
    dirs.push(root);
    const designRoot = join(root, '.design');
    mkdirSync(designRoot, { recursive: true });
    const outbox = createOutbox({
      designRoot,
      senders: {},
      gates: () => signedOut,
      target: () => ({ projectId: null, projectName: 'p', role: 'owner' as const }),
    });
    return { outbox, q: createAskQueue({ outbox, gates: () => signedOut, runs: () => null }) };
  }
  test('Claude chat: queued behind ai-connected', () => {
    const { q } = queue();
    const r = q.maybeQueue({ chatId: 'c1', text: 'hi', scope: null });
    expect(r && 'gates' in r ? r.gates : null).toEqual(['ai-connected']);
  });
  test('Codex chat: sent now, nothing queued', () => {
    const { q, outbox } = queue();
    expect(q.maybeQueue({ chatId: 'c2', text: 'hi', scope: null, agent: 'codex' })).toBeNull();
    expect(outbox.store.list()).toHaveLength(0);
  });
  test('a Codex prompt queued for another gate records its agent, so release ignores Claude', () => {
    const root = mkdtempSync(join(tmpdir(), 'maude-agent-gate-'));
    dirs.push(root);
    const offline = { ...signedOut, online: false };
    const outbox = createOutbox({
      designRoot: root,
      senders: {},
      gates: () => offline,
      target: () => ({ projectId: null, projectName: 'p', role: 'owner' as const }),
    });
    const q = createAskQueue({ outbox, gates: () => offline, runs: () => null });
    const r = q.maybeQueue({ chatId: 'c3', text: 'hi', scope: null, agent: 'codex' });
    expect(r && 'gates' in r ? r.gates : null).toEqual(['online']);
    const [record] = outbox.store.list();
    expect((record.payload as { agent?: string }).agent).toBe('codex');
    // back online, Claude still signed out: nothing holds it
    expect(closedGates(record, signedOut, [], 0)).toEqual([]);
  });
});
