// S12.16 live: the AI chat lane's tools.jsonl carried `input: {}` for every call, because the adapter
// announces a call before its input is known. Every tool-used / no-tool grader read an empty log.
import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error - plain .mjs
import { toolLog } from './lanes/acp.mjs';

const lines = (dir: string) =>
  readFileSync(join(dir, 'tools.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

test('a call is logged once, with the input that arrives in its first update', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maude-tool-log-'));
  const t = toolLog(dir);
  t.see({
    sessionUpdate: 'tool_call',
    toolCallId: 'a',
    rawInput: {},
    _meta: { claudeCode: { toolName: 'Bash' } },
  });
  t.see({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'a',
    rawInput: { command: 'maude design logs' },
  });
  t.see({ sessionUpdate: 'tool_call_update', toolCallId: 'a', status: 'completed' });
  t.flush();
  expect(lines(dir)).toEqual([
    { lane: 'acp', name: 'Bash', input: { command: 'maude design logs' } },
  ]);
});

test('a call that never shows an input is still counted, empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maude-tool-log-'));
  const t = toolLog(dir);
  t.see({
    sessionUpdate: 'tool_call',
    toolCallId: 'b',
    _meta: { claudeCode: { toolName: 'Skill' } },
  });
  t.flush();
  expect(lines(dir)).toEqual([{ lane: 'acp', name: 'Skill', input: {} }]);
});
