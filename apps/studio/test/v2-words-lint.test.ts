// S11.18 (S11-slices Q15) — the words rules nobody else closes: `no-we-no-i`,
// `one-verb-per-dialog-one-action-per-toast`. A lint over every string a person can read in client/v2/**.
// Zero hits, with a short allowlist; every entry names the canvas or the contract line that keeps it, and an entry
// that no longer matches anything fails (the list cannot rot into a blanket pass).

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dialogVerbMismatches,
  type Hit,
  readableStrings,
  scanWords,
  secondActions,
} from './_v2-words-scan.ts';

const V2 = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'v2');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(?:jsx?|tsx?)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

/** A hit that stays: where, which rule, which text — and why. */
const ALLOW: readonly { file: string; rule: string; text: RegExp; why: string }[] = [
  {
    file: 'present/',
    rule: 'screen',
    text: /audience screen/i,
    why: '04 Modes draws "the audience screen": the second display, not an artboard',
  },
  {
    file: 'present/presenter-view.jsx',
    rule: 'screen',
    text: /only you see this screen/,
    why: 'presenter view: this display, not an artboard',
  },
  {
    file: 'export/export-copy.js',
    rule: 'screen',
    text: /Retina screens/,
    why: 'hardware: pixel density of a display',
  },
  {
    file: 'search/search-keywords.js',
    rule: 'screen',
    text: /.*/,
    why: 'synonyms a person may TYPE to find an artboard; never drawn',
  },
  {
    file: 'search/search-keywords.js',
    rule: 'board',
    text: /^board$/,
    why: 'synonym a person may type to find a canvas; never drawn',
  },
  {
    file: 'comments/comments-panel.jsx',
    rule: 'delete',
    text: /^Delete comment$/,
    why: 'CONTRACT §6: "Delete comment" on your own comments (comments have no trash)',
  },
  {
    file: 'timeline/Timeline.jsx',
    rule: 'delete',
    text: /^Delete comment$/,
    why: 'CONTRACT §6: "Delete comment" on your own comment pinned to a time (comments have no trash)',
  },
  {
    file: 'settings/account.jsx',
    rule: 'delete',
    text: /^Delete the account$/,
    why: '02 Onboarding draws "Delete the account" (an account has no trash)',
  },
  {
    file: 'ai/needs-you.js',
    rule: 'delete',
    text: /^Delete$/,
    why: 'the verb of an ACP delete tool call the AI asks to run, not a trash move',
  },
  {
    file: 'ai/ConnectSheet.jsx',
    rule: 'pro',
    text: /Claude Pro or Max/,
    why: "Anthropic's plan names",
  },
  {
    file: 'onboarding/onboarding-model.js',
    rule: 'pro',
    text: /Claude Pro or Max/,
    why: "Anthropic's plan names",
  },
  {
    file: 'left-panel/left-panel-model.js',
    rule: 'board',
    text: /^New blank brief board$/,
    why: 'a record of the v1 control: tree.jsx keeps this aria-label as an e2e hook (cloud-entry, selfhost-entry)',
  },
  {
    file: 'import/figma-model.js',
    rule: 'board',
    text: /^(board|A board from FigJam works too — it comes in as annotations\.)$/,
    why: "S8.17: Figma's own URL segment (figma.com/board/…, never drawn) and 12 ia-figma-sheets' exact line: FigJam's word for its file",
  },
];

const allowed = (file: string, h: Hit) =>
  ALLOW.some((a) => file.startsWith(a.file) && a.rule === h.rule && a.text.test(h.text));

describe('the scanner reads only what a person reads', () => {
  test('banned words in a string, a template and JSX text are hits', () => {
    const src = [
      "const a = 'We saved it';",
      'const b = `Oops, ${x} failed`;',
      "const c = 'I couldn’t open it';",
      'const d = <p>Done!</p>;',
      "const e = 'Open the screen list';",
      "const f = 'Collapse the sidebar';",
      "const g = 'Upgrade to Pro';",
      "const h = 'Debug';",
      "const i = 'Delete canvas';",
      "const j = 'New board';",
    ].join('\n');
    const rules = scanWords(src, 'x.jsx').map((h) => h.rule);
    expect(rules).toEqual([
      'we',
      'oops',
      'i',
      'bang',
      'screen',
      'sidebar',
      'pro',
      'debug',
      'delete',
      'board',
    ]);
  });

  test('comments, identifiers, internal tags and hooks are not copy', () => {
    const src = [
      '// We saved the board on the screen',
      "if (row.type === 'board') go();",
      "switch (k) { case 'screen': break; }",
      "const sel = '[data-dc-screen]';",
      "const url = '/_api/ds/board?ds=';",
      "const cls = 'vote-board';",
      "const was = { was: 'Rail › Expand sidebar' };",
      "const key = 'Image I';",
      "const v = 'screen reader';",
    ].join('\n');
    expect(scanWords(src, 'x.js')).toEqual([]);
  });

  test('"I" the key and "!" in code are not the pronoun or an exclamation', () => {
    expect(scanWords("const k = ['Image I', 'Component ⇧I', 'a !== b'];", 'x.js')).toEqual([]);
  });

  test('a dialog whose title and primary button use different verbs is flagged', () => {
    const bad = "const d = { title: 'Remove “x” from the project?', primary: 'Delete' };";
    const ok = "const d = { title: 'Move “x” to the trash?', confirm: 'Move to trash' };";
    expect(dialogVerbMismatches(bad, 'x.js')).toHaveLength(1);
    expect(dialogVerbMismatches(ok, 'x.js')).toEqual([]);
  });

  test('a toast with two actions is flagged', () => {
    expect(secondActions("n({ title: 'x', action: a, secondary: b });", 'x.js')).toHaveLength(1);
    expect(secondActions("n({ title: 'x', action: a });", 'x.js')).toEqual([]);
  });

  test('readableStrings keeps the line number', () => {
    expect(readableStrings("\n\nconst a = 'Hello there';", 'x.js')).toEqual([
      { line: 3, text: 'Hello there' },
    ]);
  });
});

describe('client/v2 says the contract words', () => {
  const files = walk(V2);

  test('no banned word in anything a person can read, outside the allowlist', () => {
    const bad: string[] = [];
    for (const f of files) {
      const rel = relative(V2, f);
      for (const h of scanWords(readFileSync(f, 'utf8'), f)) {
        if (!allowed(rel, h)) bad.push(`${rel}:${h.line} [${h.rule}] ${h.text.slice(0, 100)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('every allowlist entry still matches something', () => {
    const live = new Set<number>();
    for (const f of files) {
      const rel = relative(V2, f);
      for (const h of scanWords(readFileSync(f, 'utf8'), f)) {
        ALLOW.forEach((a, i) => {
          if (rel.startsWith(a.file) && a.rule === h.rule && a.text.test(h.text)) live.add(i);
        });
      }
    }
    expect(ALLOW.filter((_, i) => !live.has(i)).map((a) => `${a.file} ${a.rule}`)).toEqual([]);
  });

  test('a dialog’s title verb is its primary button’s verb', () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const h of dialogVerbMismatches(readFileSync(f, 'utf8'), f))
        bad.push(`${relative(V2, f)}:${h.line} ${h.text}`);
    }
    expect(bad).toEqual([]);
  });

  test('a toast or callout carries one action at most', () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const h of secondActions(readFileSync(f, 'utf8'), f))
        bad.push(`${relative(V2, f)}:${h.line} ${h.text}`);
    }
    expect(bad).toEqual([]);
  });
});
