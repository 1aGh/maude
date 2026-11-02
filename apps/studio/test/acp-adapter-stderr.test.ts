// The ACP adapter (claude-agent-acp 0.57.0) logs `Unexpected case: {...}` for an
// SDK system message it does not know. A newer installed `claude` emits
// `subtype: "background_tasks_changed"`, which is harmless and would otherwise
// land in the person's Diagnostics log on every turn. That one known line is
// dropped; every other `Unexpected case` (a real protocol surprise) still shows.

import { describe, expect, test } from 'bun:test';

import { relayAdapterStderr } from '../acp/adapter-stderr.ts';

function relay(chunk: string): string[] {
  const out: string[] = [];
  relayAdapterStderr(chunk, (line) => out.push(line));
  return out;
}

describe('adapter stderr relay', () => {
  test('drops the known background_tasks_changed line', () => {
    const line =
      'Unexpected case: {"type":"system","subtype":"background_tasks_changed","tasks":[],"uuid":"u","session_id":"s"}';
    expect(relay(line)).toEqual([]);
    expect(relay(`[2026-10-29T10:00:00.000Z] ${line}\n`)).toEqual([]);
  });

  test('any other Unexpected case still shows', () => {
    const other = 'Unexpected case: {"type":"system","subtype":"something_new"}';
    expect(relay(other)).toEqual([other]);
    const result = 'Unexpected case: {"type":"result","subtype":"background_tasks_changed_v2"}';
    expect(relay(result)).toEqual([result]);
  });

  test('ordinary adapter output is untouched, and a chunk of several lines is filtered per line', () => {
    const chunk = [
      'adapter ready',
      'Unexpected case: {"type":"system","subtype":"background_tasks_changed"}',
      'Unexpected case: {"type":"system","subtype":"brand_new"}',
      '',
    ].join('\n');
    expect(relay(chunk)).toEqual([
      'adapter ready',
      'Unexpected case: {"type":"system","subtype":"brand_new"}',
    ]);
  });

  test('a mention of the subtype outside an Unexpected case line is kept', () => {
    const l = 'debug: saw background_tasks_changed from cli';
    expect(relay(l)).toEqual([l]);
  });
});
