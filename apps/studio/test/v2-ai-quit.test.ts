// S5.14 — the quit dialog's words and payload, the "Stopped" divider + Keep going (03 ai-quit,
// V2-1.15 §5.8–§5.9, R10/R11). The round trip itself is quit.rs (cargo test quit::); the
// desktop e2e `ai-quit.e2e.ts` drives it end to end.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseQuitAsk,
  quitDialogText,
  stoppedLine,
  stoppedRunFor,
  stoppedTime,
} from '../client/v2/ai/stopped.js';

const STUDIO = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(STUDIO, rel), 'utf8');

// 6 Oct 2026, 18:12 local
const AT = new Date(2026, 9, 6, 18, 12).getTime();
const run = (over: Record<string, unknown>) => ({
  runId: 'r_aaaaaa1',
  chatId: 'c1',
  state: 'ended',
  outcome: 'stopped',
  stoppedBy: 'quit',
  createdAt: AT - 60_000,
  endedAt: AT,
  ...over,
});

describe('the quit dialog (ai-quit)', () => {
  test('counts chats in the contract words', () => {
    expect(quitDialogText(2)).toEqual({
      title: 'Quit while AI is working?',
      body: '2 chats stop where they are. Everything AI finished so far is kept as a version, and each chat can carry on next time.',
      primary: 'Quit',
      secondary: 'Cancel',
    });
    expect(quitDialogText(1).body.startsWith('1 chat stops where')).toBe(true);
  });

  test('the same words as the native fallback in quit.rs', () => {
    const rs = readFileSync(join(STUDIO, '../desktop/src-tauri/src/quit.rs'), 'utf8');
    expect(rs).toContain('"Quit while AI is working?"');
    expect(rs).toContain(
      'where they are. Everything AI finished so far is kept as a version, and each chat can carry on next time.'
    );
  });

  test('accepts only a well-formed ask', () => {
    expect(parseQuitAsk({ nonce: 3, chats: 2 })).toEqual({ nonce: 3, chats: 2 });
    for (const bad of [
      null,
      {},
      { nonce: 0, chats: 2 },
      { nonce: 1, chats: 0 },
      { nonce: '1', chats: 2 },
      { nonce: 1.5, chats: 2 },
      { nonce: 1, chats: 10_000 },
    ]) {
      expect(parseQuitAsk(bad)).toBeNull();
    }
  });

  test('answers the shell only with shown / quit / cancel for its round, through quit_answer', () => {
    const src = read('client/v2/ai/QuitDialog.jsx');
    expect(src).toContain("invoke('quit_answer', { nonce, answer: kind })");
    for (const a of ["'shown'", "'quit'", "'cancel'"]) expect(src).toContain(a);
    expect(src).toContain("listen('quit://ask'");
    // It stops nothing itself and names no project: the shell does both.
    expect(src).not.toContain('/_api/ai/runs');
    expect(src).not.toContain('emit(');
  });

  test('is mounted once by the shell host, the divider by every chat thread', () => {
    expect(read('client/app.jsx')).toContain('<QuitDialog />');
    expect(read('client/panels/ChatPanel.jsx')).toContain(
      '<StoppedDivider chatId={chatId} hidden={hidden} />'
    );
    expect(read('client/styles/_index.css')).toContain('../v2/ai/quit.css');
  });
});

describe('the Stopped divider + Keep going', () => {
  test('words per reason, with the time', () => {
    expect(stoppedTime(AT)).toBe('6 Oct, 18:12');
    expect(stoppedLine(run({}))).toBe('Stopped when the app quit · 6 Oct, 18:12');
    expect(stoppedLine(run({ stoppedBy: 'you' }))).toBe('Stopped · 6 Oct, 18:12');
    expect(stoppedLine(run({ stoppedBy: 'close-tab' }))).toBe(
      'Stopped when the tab closed · 6 Oct, 18:12'
    );
    expect(stoppedLine(run({ outcome: 'interrupted', stoppedBy: 'crash' }))).toBe(
      'Stopped when Maude quit unexpectedly · 6 Oct, 18:12'
    );
    expect(stoppedLine(run({ outcome: 'done' }))).toBeNull();
    expect(stoppedLine(run({ outcome: 'failed' }))).toBeNull();
    expect(stoppedLine(null)).toBeNull();
  });

  test("shows for the chat's LATEST run only, and never while one is live", () => {
    const stopped = run({});
    expect(stoppedRunFor([stopped], 'c1')).toBe(stopped);
    expect(stoppedRunFor([stopped], 'c2')).toBeNull();
    // R10: the waiting ask of the same chat stopped unstarted (state ended) after the running one.
    const waiting = run({ runId: 'r_aaaaaa2', createdAt: AT - 30_000 });
    expect(stoppedRunFor([stopped, waiting], 'c1')?.runId).toBe('r_aaaaaa2');
    // Keep going started a new run (resumeOf): the divider goes.
    const resumed = run({
      runId: 'r_aaaaaa3',
      state: 'waiting',
      outcome: undefined,
      resumeOf: 'r_aaaaaa1',
      createdAt: AT + 1000,
    });
    expect(stoppedRunFor([stopped, resumed], 'c1')).toBeNull();
    // A later run that finished: nothing to carry on.
    const done = run({ runId: 'r_aaaaaa4', outcome: 'done', createdAt: AT + 2000 });
    expect(stoppedRunFor([stopped, done], 'c1')).toBeNull();
    expect(stoppedRunFor(null as unknown as [], 'c1')).toBeNull();
  });

  test('Keep going posts the run-scoped route and never sends the prompt', () => {
    const src = read('client/v2/ai/StoppedDivider.jsx');
    expect(src).toContain('/_api/ai/runs/${encodeURIComponent(run.runId)}/keep-going');
    expect(src).toContain('data-testid="ai-keep-going"');
    expect(src).toContain('data-testid="ai-stopped-divider"');
    expect(src).not.toMatch(/\bprompt\b/);
  });
});

describe('testids are an API', () => {
  test('the new hooks are registered', () => {
    const hooks = new Set(
      (JSON.parse(read('client/testids.json')) as { hook: string }[]).map((h) => h.hook)
    );
    for (const id of [
      'ai-quit-dialog',
      'ai-quit-confirm',
      'ai-quit-cancel',
      'ai-stopped-divider',
      'ai-keep-going',
    ]) {
      expect(hooks.has(id), id).toBe(true);
      expect(read('client/TESTIDS.md')).toContain(`| \`${id}\` |`);
    }
  });
});
