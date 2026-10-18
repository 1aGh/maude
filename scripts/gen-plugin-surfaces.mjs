#!/usr/bin/env node
// Plugin surfaces generator (S12.2, S12-slices D6) — every plugin copy that restates a command or
// the CONTRACT is GENERATED; nothing here is typed by hand.
//
//   node scripts/gen-plugin-surfaces.mjs           write the outputs
//   node scripts/gen-plugin-surfaces.mjs --check   exit 1 on drift (cli/lib/plugin-surfaces.test.mjs)
//
// 1. apps/studio/client/panels/slash-commands.gen.js — STATIC_COMMANDS, from the design plugin's
//    commands/*.md frontmatter (`name`, `description`, `argument-hint`). The AI chat panel's
//    autocomplete is instant before any `claude` session exists, so the list is baked in.
// 2. plugins/<design|flow>/skills/source-command-<verb>/{SKILL.md,agents/openai.yaml} — the Codex
//    entry points. Each is a thin wrapper that points at the live commands/<verb>.md (the shape
//    a01938288 committed), so a mirror can drift only in its description, name or title, and
//    those are exactly what this renders and checks. An orphan mirror (its command is gone) is
//    drift too. (S12-slices D6 named codex-runtime's renderCommandSkill, which inlines the whole
//    command body: that would copy every v1 step into a second place and break the body's
//    relative links, so the committed wrapper shape is the renderer here. See the S12.2 hand-back.)
// 3. plugins/design/skills/contract-voice/SKILL.md — CONTRACT §3 (Words) and §4 (Voice rules)
//    verbatim between two markers, plus the AI-message rules (S12-slices D13) in this file.
//    CONTRACT.md lives in .design/, which does not ship, so the skill is the shipped copy.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// MAUDE_SURFACES_ROOT points the generator at a scratch tree (the drift test plants stale files there).
export const ROOT = process.env.MAUDE_SURFACES_ROOT
  ? resolve(process.env.MAUDE_SURFACES_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS = ['design', 'flow'];
const CONTRACT = '.design/system/maude-v2/CONTRACT.md';
const SLASH_OUT = 'apps/studio/client/panels/slash-commands.gen.js';
const VOICE_OUT = 'plugins/design/skills/contract-voice/SKILL.md';
const ARG_HINT_MAX = 48;

// ── frontmatter ──────────────────────────────────────────────────────────────────────────────

/** The value of one top-level frontmatter key, unquoted. `"\"x\""` (an escaped, doubled quote)
 *  comes out as `x`, the way the committed mirrors already carry it. */
function fmValue(fm, key) {
  const m = fm.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
  if (!m) return null;
  let v = m[1].trim();
  for (let i = 0; i < 2 && v.length >= 2 && v.startsWith('"') && v.endsWith('"'); i++) {
    try {
      v = JSON.parse(v);
    } catch {
      v = v.slice(1, -1);
    }
  }
  return v;
}

function readCommand(plugin, file) {
  const path = `plugins/${plugin}/commands/${file}`;
  const text = readFileSync(join(ROOT, path), 'utf8');
  const end = text.indexOf('\n---\n', 4);
  if (!text.startsWith('---\n') || end < 0) throw new Error(`${path}: no frontmatter`);
  const fm = text.slice(4, end);
  const verb = file.slice(0, -3);
  const name = fmValue(fm, 'name') ?? verb;
  if (name !== verb) throw new Error(`${path}: frontmatter name "${name}" is not the filename`);
  const description = fmValue(fm, 'description');
  if (!description) throw new Error(`${path}: no description`);
  return { plugin, verb, description, argHint: fmValue(fm, 'argument-hint') ?? '' };
}

function commandsOf(plugin) {
  const dir = join(ROOT, 'plugins', plugin, 'commands');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => readCommand(plugin, f));
}

// ── 1 · slash list ───────────────────────────────────────────────────────────────────────────

/** Split an argument hint into its top-level groups: a space inside [] or <> or "" does not split. */
function hintGroups(text) {
  const groups = [];
  let depth = 0;
  let quoted = false;
  let cur = '';
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '[' || ch === '<')) depth++;
    else if (!quoted && (ch === ']' || ch === '>')) depth = Math.max(0, depth - 1);
    if (ch === ' ' && depth === 0 && !quoted) {
      if (cur) groups.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) groups.push(cur);
  return groups;
}

/** Keep whole top-level groups inside `max` characters (never half a bracket); the rest of the
 *  hint stays in the command's own file. */
function clip(text, max) {
  if (text.length <= max) return text;
  let out = '';
  for (const g of hintGroups(text)) {
    const next = out ? `${out} ${g}` : g;
    if (next.length > max) break;
    out = next;
  }
  return out ? `${out} …` : ''; // a first group that alone overflows shows no hint at all
}

const jsStr = (s) => `'${s.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

// One object property, wrapped the way biome wraps a string that overruns the 100-column line.
function prop(key, value) {
  const line = `    ${key}: ${jsStr(value)},`;
  return line.length <= 100 ? line : `    ${key}:\n      ${jsStr(value)},`;
}

function renderSlash() {
  const rows = commandsOf('design').map((c) => {
    const lines = [prop('name', `design:${c.verb}`), prop('description', c.description)];
    const hint = clip(c.argHint, ARG_HINT_MAX);
    if (hint) lines.push(prop('argHint', hint));
    return `  {\n${lines.join('\n')}\n  },`;
  });
  return `// GENERATED by scripts/gen-plugin-surfaces.mjs from plugins/design/commands/*.md frontmatter
// — DO NOT EDIT BY HAND. Run: node scripts/gen-plugin-surfaces.mjs
// \`name\` is Claude Code's canonical slash form (\`<plugin>:<verb>\`). \`argHint\` is the command's
// \`argument-hint\`, cut to whole groups within ${ARG_HINT_MAX} characters.

export const STATIC_COMMANDS = [
${rows.join('\n')}
];
`;
}

// ── 2 · source-command mirrors ───────────────────────────────────────────────────────────────

// The Codex short description is the command's, whole when it fits in 64 characters, else the
// longest run of whole words within 60 characters (punctuation kept) and an ellipsis.
function shortDescription(d) {
  if (d.length <= 64) return d;
  let out = '';
  for (const w of d.split(' ')) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > 60) break;
    out = next;
  }
  return `${out}…`;
}

export function renderMirrorSkill(c) {
  return `---
name: source-command-${c.verb}
description: ${JSON.stringify(c.description)}
user-invocable: false
---

# ${c.plugin}:${c.verb}

Read [host conventions](../../HARNESS.md), then follow the shared
[${c.plugin}:${c.verb} procedure](../../commands/${c.verb}.md) with the user's input.
Keep its prerequisites, branches, verification and completion checkpoints.
`;
}

export function renderMirrorYaml(c) {
  return `interface:
  display_name: ${JSON.stringify(`${c.plugin}:${c.verb}`)}
  short_description: ${JSON.stringify(shortDescription(c.description))}
  default_prompt: ${JSON.stringify(`Use $${c.plugin}:source-command-${c.verb} with the task details I provide.`)}
policy:
  allow_implicit_invocation: false
`;
}

// ── 3 · contract-voice ───────────────────────────────────────────────────────────────────────

export const VOICE_BEGIN =
  '<!-- contract:begin §3–§4 (generated from .design/system/maude-v2/CONTRACT.md) -->';
export const VOICE_END = '<!-- contract:end §3–§4 -->';

/** CONTRACT §3 and §4 exactly as written: from the "## 3 ·" heading up to "## 5 ·". */
export function contractSections(contract) {
  const a = contract.indexOf('\n## 3 · ');
  const b = contract.indexOf('\n## 5 · ');
  if (a < 0 || b < a)
    throw new Error(`${CONTRACT}: no §3–§4 span (headings "## 3 · " / "## 5 · ")`);
  return contract.slice(a + 1, b + 1).trimEnd();
}

function renderVoice() {
  const sections = contractSections(readFileSync(join(ROOT, CONTRACT), 'utf8'));
  return `---
name: contract-voice
description: "Maude's product voice for the words the AI writes in the AI chat panel and into Maude's own fields: chat replies, run results, comment text, version names, chat titles. Load before writing any of them."
---

# contract-voice

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Maude has one voice. This skill is that voice for text **you** write into the product: your messages in the AI chat panel, and text you put into a Maude field (comment text, version names, chat titles, run results). It does not apply to the user's own canvases: their words are theirs, and a project keeps its own design-system voice. The \`copy-critic\` loads this skill only for a canvas whose design system is \`maude-v2\`.

The two tables below are the contract, verbatim. Say the left column; the middle column is what not to say.

${VOICE_BEGIN}

${sections}

${VOICE_END}

## Your own messages

- **Describe the result, not yourself.** "Done. Three hero variants are on the canvas. Pick one." Never "I made…", never "we". The AI is a name, with no article: "AI is drawing the footer".
- **Result first, then what is safe, then one verb.** A failure says what happened, what is safe (the canvas is unchanged, the earlier version is kept), and the one thing to do. No exclamation marks, no "Oops", no apology.
- **Name things by the words in the table.** A canvas holds artboards; a frame is a box inside an artboard. A deletion is "moved to the trash". Saved versions are "Version history", and a version name says what changed ("Pricing: three plans"), not who or when.
- **Short.** One or two sentences for a result. Counts read for one and for many: "1 artboard", "5 artboards", never "artboard(s)".
- **Do not call the AI chat panel an assistant, and never refer to your own tools** (verbs, routes, run ids) in the text the user reads. The result is what the user needs.
`;
}

// ── plan, write, check ───────────────────────────────────────────────────────────────────────

/** @returns {Map<string,string>} repo-relative path -> expected content */
export function plan() {
  const out = new Map();
  out.set(SLASH_OUT, renderSlash());
  for (const plugin of PLUGINS) {
    for (const c of commandsOf(plugin)) {
      const dir = `plugins/${plugin}/skills/source-command-${c.verb}`;
      out.set(`${dir}/SKILL.md`, renderMirrorSkill(c));
      out.set(`${dir}/agents/openai.yaml`, renderMirrorYaml(c));
    }
  }
  out.set(VOICE_OUT, renderVoice());
  return out;
}

/** Mirror directories whose command no longer exists. */
export function orphans(expected) {
  const found = [];
  for (const plugin of PLUGINS) {
    const skills = join(ROOT, 'plugins', plugin, 'skills');
    for (const d of readdirSync(skills)) {
      if (!d.startsWith('source-command-')) continue;
      const rel = `plugins/${plugin}/skills/${d}`;
      if (!expected.has(`${rel}/SKILL.md`)) found.push(rel);
    }
  }
  return found;
}

function main() {
  const check = process.argv.includes('--check');
  const expected = plan();
  const stale = [];
  for (const [rel, content] of expected) {
    const abs = join(ROOT, rel);
    const have = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (have === content) continue;
    stale.push(rel);
    if (!check) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
  }
  const gone = orphans(expected);
  if (!check) for (const rel of gone) rmSync(join(ROOT, rel), { recursive: true });
  if (check && (stale.length || gone.length)) {
    for (const rel of stale) console.error(`stale: ${rel}`);
    for (const rel of gone) console.error(`orphan (its command is gone): ${rel}`);
    console.error('Run: node scripts/gen-plugin-surfaces.mjs');
    process.exit(1);
  }
  console.log(
    check
      ? `plugin surfaces: ${expected.size} files in sync`
      : `plugin surfaces: wrote ${stale.length}, removed ${gone.length}, ${expected.size} total`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
