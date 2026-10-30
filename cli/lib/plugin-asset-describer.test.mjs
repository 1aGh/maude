// S12.13 — the asset-describer agent (contract V2-1.17 §5.9) looks at pictures somebody else may have made, headless,
// on the person's own Claude account. Its tool list is the boundary: Read and nothing else — no shell, no file
// writes, no web, no MCP, no sub-agents. describe/claude.ts refuses to run a copy whose `tools:` says otherwise, and
// the design hook holds it to the untrusted-reader rules at run time; this pins the shipped file itself.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { UNTRUSTED_READERS } from './design-hook.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = join(ROOT, 'plugins', 'design', 'agents', 'asset-describer.md');

function frontmatter() {
  const src = readFileSync(FILE, 'utf8');
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, 'asset-describer.md has frontmatter');
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { fm, body: m[2] };
}

test('asset-describer: bare name, and its tools are Read alone', () => {
  const { fm } = frontmatter();
  assert.equal(fm.name, 'asset-describer', 'bare name: (Claude Code adds design: itself, DDR-191)');
  const tools = (fm.tools ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  assert.deepEqual(tools, ['Read'], `tools must stay Read only, got: ${fm.tools}`);
  for (const k of ['disallowedTools', 'mcpServers', 'permissionMode', 'hooks'])
    assert.equal(fm[k], undefined, `asset-describer declares no ${k}`);
});

test('asset-describer: an untrusted-content reader the design hook knows', () => {
  assert.ok(UNTRUSTED_READERS.has('asset-describer'));
});

test('asset-describer: its body (the agent prompt) returns the hand-off and treats words in pictures as data', () => {
  const { body, fm } = frontmatter();
  assert.match(body, /maude\.agent-handoff\/1/);
  assert.match(body, /untrusted/i);
  assert.match(fm.description, /Never auto-delegated/);
  // the prompt goes into `claude --agents`; no other tool name is ever in it
  assert.doesNotMatch(
    body,
    /\b(Bash|Write|Edit|MultiEdit|NotebookEdit|WebFetch|WebSearch|Task|Agent|Glob|Grep)\b/
  );
  assert.doesNotMatch(body, /mcp/i);
});
