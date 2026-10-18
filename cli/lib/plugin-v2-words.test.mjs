// S12.1 — the v2 words ratchet (S12-slices D7).
//
// Counts the banned v1 strings (CONTRACT §3 "Not" column where it means UI, plus
// the stale shell/tooling words the S12 inventory found) per file under
// plugins/design/**, and compares them with plugins/design/v2-words.ratchet.json.
//
//   - a file's count going UP fails;
//   - a file with hits that is not in the ratchet fails (a new file, or a copied one);
//   - counts may only go DOWN. A file that went down is not an error, but the
//     committed number must follow it (`MAUDE_RATCHET_WRITE=1` lowers; it never raises).
//
// All counts reach 0 at S12.16. Changing the PATTERNS list shifts every count, so the
// ratchet carries a hash of it and refuses a mismatch; re-baseline deliberately with
// `MAUDE_RATCHET_REBASE=1 node --test cli/lib/plugin-v2-words.test.mjs`.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DESIGN = join(ROOT, 'plugins', 'design');
const RATCHET = join(DESIGN, 'v2-words.ratchet.json');

// Each pattern: id, regex (global), optional `window` (lines after the match line the
// regex may also look at — multi-line shell commands). Case-sensitive unless it says `i`.
export const PATTERNS = [
  // CONTRACT §3 "Not" column, where the word means UI.
  { id: 'board', re: /\bboard\b/gi },
  { id: 'assistant', re: /\bAssistant\b|\bthe assistant\b/g },
  { id: 'ai-panel', re: /\bAI panel\b/g },
  { id: 'command-palette', re: /\bcommand palette\b|\bquick find\b|⌘K menu/gi },
  { id: 'sidebar', re: /\bsidebar\b/gi },
  { id: 'history-log', re: /\bhistory log\b/gi },
  { id: 'stamps-tool', re: /\bStamps\b/g },
  { id: 'new-canvas-1', re: /\bNew canvas 1\b/g },
  // Stale shell words and shortcuts.
  { id: 'status-bar', re: /\bstatus bar\b/gi },
  { id: 'assistant-shortcut', re: /⌘⇧A/g },
  { id: 'cmd-click', re: /\bCmd[+-]click\b|⌘-click/gi },
  { id: 'view-timeline', re: /View\s*(?:→|->)\s*Timeline/g },
  { id: 'cmd-e-export', re: /⌘E\b/g },
  // Tooling the verbs replaced.
  { id: 'history-dir', re: /_history\//g, skipLine: /pre-v2|legacy/i },
  { id: 'ai-start-route', re: /\/_api\/ai\/start/g },
  // A raw curl at a studio route (the line, or the next two for a continued command).
  { id: 'raw-curl', re: /\bcurl\b(?!-local)/g, window: { after: 2, must: /\/_api\// } },
];

// Names that stay (S12-slices D4): the command is still called board.
const ALLOWED_TOKENS = /\/?design:board|source-command-board|\bboard\.md|--board\b/g;

const TEXT_EXT = new Set(['.md', '.mjs', '.json']);
const SKIP_DIRS = new Set(['node_modules', 'templates', '.git']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    // *.test.mjs hold old strings on purpose (hook fixtures); they are not plugin copy.
    else if (
      TEXT_EXT.has(name.slice(name.lastIndexOf('.'))) &&
      !name.endsWith('.test.mjs') &&
      p !== RATCHET
    ) {
      out.push(p);
    }
  }
  return out;
}

export function countFile(text) {
  const lines = text.split('\n');
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(ALLOWED_TOKENS, ' ');
    for (const p of PATTERNS) {
      if (p.skipLine?.test(lines[i])) continue;
      p.re.lastIndex = 0;
      const hits = line.match(p.re);
      if (!hits) continue;
      if (p.window) {
        const span = lines.slice(i, i + 1 + p.window.after).join('\n');
        if (!p.window.must.test(span)) continue;
      }
      total += hits.length;
    }
  }
  return total;
}

function measure() {
  const counts = {};
  for (const abs of walk(DESIGN)) {
    const n = countFile(readFileSync(abs, 'utf8'));
    if (n > 0) counts[relative(DESIGN, abs).split(sep).join('/')] = n;
  }
  return counts;
}

const patternsHash = () =>
  createHash('sha256')
    .update(
      PATTERNS.map((p) => `${p.id}:${p.re.source}:${p.re.flags}:${p.window?.after ?? ''}`).join(
        '\n'
      )
    )
    .digest('hex')
    .slice(0, 12);

function writeRatchet(files) {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  const total = Object.values(sorted).reduce((a, b) => a + b, 0);
  const doc = {
    $comment:
      'Per-file counts of banned v1 strings under plugins/design (cli/lib/plugin-v2-words.test.mjs). Counts may only go down; they reach 0 at S12.16. Lower with MAUDE_RATCHET_WRITE=1.',
    patternsHash: patternsHash(),
    total,
    files: sorted,
  };
  writeFileSync(RATCHET, `${JSON.stringify(doc, null, 2)}\n`);
}

if (process.env.MAUDE_RATCHET_REBASE === '1') writeRatchet(measure());

const committed = JSON.parse(readFileSync(RATCHET, 'utf8'));

test('the ratchet was measured with the current pattern list', () => {
  assert.equal(
    committed.patternsHash,
    patternsHash(),
    'PATTERNS changed: re-baseline on purpose with MAUDE_RATCHET_REBASE=1 and say why in the commit'
  );
});

test('no file under plugins/design has more banned v1 strings than the ratchet allows', () => {
  const now = measure();
  const raised = [];
  for (const [file, n] of Object.entries(now)) {
    const allowed = committed.files[file] ?? 0;
    if (n > allowed) {
      raised.push(`${file}: ${n} (allowed ${allowed}${allowed === 0 ? ', new hits' : ''})`);
    }
  }
  assert.deepEqual(
    raised,
    [],
    `Banned v1 strings went up. Use the v2 words (CONTRACT §3–§4):\n  ${raised.join('\n  ')}`
  );

  // Counts only go down: a lowered file must be written back, and a deleted/clean file dropped.
  const lowered = Object.entries(committed.files)
    .filter(([file, allowed]) => (now[file] ?? 0) < allowed)
    .map(([file, allowed]) => `${file}: ${allowed} -> ${now[file] ?? 0}`);
  if (process.env.MAUDE_RATCHET_WRITE === '1' && lowered.length) {
    const next = { ...committed.files };
    for (const [file] of Object.entries(committed.files)) {
      if ((now[file] ?? 0) === 0) delete next[file];
      else next[file] = Math.min(next[file], now[file]);
    }
    writeRatchet(next);
  } else {
    assert.deepEqual(
      lowered,
      [],
      `Good: these files improved. Write the lower counts back with MAUDE_RATCHET_WRITE=1 so they cannot creep up again:\n  ${lowered.join('\n  ')}`
    );
  }
});

test('the ratchet total matches its files', () => {
  const sum = Object.values(committed.files).reduce((a, b) => a + b, 0);
  assert.equal(committed.total, sum);
});
