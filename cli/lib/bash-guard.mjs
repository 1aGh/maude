// bash-guard.mjs — the design plugin's Bash rules (contract V2-1.11 §5.4 pre-bash / post-bash,
// narrowed by V2-1.18 §9 Q5). A best-effort POSIX-shell reader, then three deny codes:
//
//   use-trash     rm / unlink / rmdir / git rm / find -delete of a versioned .design/** file
//   use-verb      mv / git mv of a versioned .design/** file
//   not-a-writer  a non-`maude` writer into .design/**: sed -i, perl -i, tee, > / >>, cp / rsync /
//                 install / ditto BY DESTINATION, and node -e / python -c / … only when the script
//                 text writes AND names a .design path
//
// FAIL-OPEN: a command the reader can't follow (unbalanced quotes, an unterminated `$(`), a word it
// can't see (`$VAR`, `$(…)`, a relative path after `cd $X`) never produces a decision. A read is
// never denied: `maude design read-annotations x | python3 -c "json.load…"`, `cp .design/x /tmp`.
// Runtime paths (a `_*` or hidden first segment under the design root) are free.
//
// Also: which `maude design` verb a command runs (post-bash binds a write verb's writes to the run)
// and `designWritesSince`, the bounded mtime walk that finds them.
//
// Leaf module: node built-ins only.

import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

// ── the reader ───────────────────────────────────────────────────────────────────────────────

const OP_CHARS = new Set([';', '&', '|', '<', '>', '(', ')', '\n']);
const WS = new Set([' ', '\t', '\r']);

class Unparseable extends Error {}
const fail = () => {
  throw new Unparseable();
};

/**
 * Read `src` into tokens. `stop` = the closing char of a nested `$(` / `` ` `` (null at top
 * level). Nested substitutions' commands go to `nested`. Returns { tokens, end }.
 */
function lex(src, start, stop, nested) {
  const tokens = [];
  const heredocs = []; // pending { delim, strip, redir } until the next newline
  let i = start;
  let word = null; // { text, literal, glob, quoted }
  let depth = 0; // ( … ) subshells inside a $( … )
  const begin = () => {
    if (!word) word = { text: '', literal: true, glob: false, quoted: false };
  };
  const flush = () => {
    if (word) tokens.push({ t: 'word', ...word });
    word = null;
  };
  // A nested command list: lex it, collect its commands, return the index after its closer.
  const sub = (from, closer) => {
    const r = lex(src, from, closer, nested);
    nested.push(...commandsOf(r.tokens));
    return r.end;
  };
  const readHeredocBodies = () => {
    // i is just past a newline: each pending heredoc body runs to its delimiter line (or EOF)
    for (const h of heredocs) {
      const lines = [];
      for (;;) {
        if (i >= src.length) break;
        let nl = src.indexOf('\n', i);
        if (nl === -1) nl = src.length;
        let line = src.slice(i, nl);
        i = Math.min(nl + 1, src.length);
        if (h.strip) line = line.replace(/^\t+/, '');
        if (line === h.delim) break;
        lines.push(line);
      }
      h.redir.body = lines.join('\n');
    }
    heredocs.length = 0;
  };

  while (i < src.length) {
    const c = src[i];
    if (stop === '`' && c === '`') {
      flush();
      return { tokens, end: i + 1 };
    }
    if (stop === ')' && c === ')' && depth === 0) {
      flush();
      return { tokens, end: i + 1 };
    }
    if (WS.has(c)) {
      flush();
      i++;
      continue;
    }
    if (c === '\\') {
      if (src[i + 1] === '\n') {
        i += 2; // line continuation
        continue;
      }
      begin();
      word.text += src[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (c === '#' && !word) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === "'") {
      begin();
      word.quoted = true;
      const close = src.indexOf("'", i + 1);
      if (close === -1) fail();
      word.text += src.slice(i + 1, close);
      i = close + 1;
      continue;
    }
    if (c === '"') {
      begin();
      word.quoted = true;
      i++;
      for (;;) {
        if (i >= src.length) fail();
        const d = src[i];
        if (d === '"') {
          i++;
          break;
        }
        if (d === '\\') {
          const n = src[i + 1];
          if (n === '\n') i += 2;
          else if (n === '"' || n === '\\' || n === '$' || n === '`') {
            word.text += n;
            i += 2;
          } else {
            word.text += d;
            i++;
          }
          continue;
        }
        if (d === '$' || d === '`') {
          i = expansion(i);
          continue;
        }
        word.text += d;
        i++;
      }
      continue;
    }
    if (c === '$' || c === '`') {
      begin();
      i = expansion(i);
      continue;
    }
    if (OP_CHARS.has(c)) {
      // a word of digits glued to < or > is the redirect's fd
      let fd = null;
      if ((c === '<' || c === '>') && word && !word.quoted && /^\d+$/.test(word.text)) {
        fd = word.text;
        word = null;
      }
      flush();
      // process substitution <( … ) / >( … ): a word nobody can see
      if ((c === '<' || c === '>') && src[i + 1] === '(') {
        i = sub(i + 2, ')');
        tokens.push({ t: 'word', text: '', literal: false, glob: false, quoted: false });
        continue;
      }
      const two = src.slice(i, i + 2);
      const three = src.slice(i, i + 3);
      let op;
      if (three === '<<-' || three === '<<<' || three === '&>>') op = three;
      else if (['&&', '||', ';;', '|&', '>>', '>|', '<<', '<>', '>&', '<&', '&>'].includes(two))
        op = two;
      else op = c;
      // (( arithmetic )) at a command start: skip it whole
      if (op === '(' && src[i + 1] === '(') {
        const close = src.indexOf('))', i + 2);
        if (close === -1) fail();
        i = close + 2;
        continue;
      }
      i += op.length;
      if (op === '(') depth++;
      if (op === ')') depth = Math.max(0, depth - 1);
      if (op === '\n') {
        tokens.push({ t: 'op', op: ';' });
        if (heredocs.length) readHeredocBodies();
        continue;
      }
      if (['>', '>>', '>|', '<', '<>', '&>', '&>>', '<<<', '<<', '<<-', '>&', '<&'].includes(op)) {
        const redir = { t: 'redir', op, fd };
        tokens.push(redir);
        if (op === '<<' || op === '<<-') {
          // the delimiter word (quotes stripped)
          while (WS.has(src[i])) i++;
          const m = /^(['"]?)([^\s'";&|<>()]+)\1/.exec(src.slice(i));
          if (!m) fail();
          i += m[0].length;
          heredocs.push({ delim: m[2], strip: op === '<<-', redir });
        }
        continue;
      }
      tokens.push({ t: 'op', op });
      continue;
    }
    // plain character
    begin();
    if (c === '*' || c === '?' || c === '[') word.glob = true;
    if (
      c === '~' &&
      word.text === '' &&
      !word.quoted &&
      (src[i + 1] === '/' || i + 1 >= src.length || WS.has(src[i + 1]) || OP_CHARS.has(src[i + 1]))
    ) {
      word.text += homedir();
      i++;
      continue;
    }
    word.text += c;
    i++;
  }
  if (stop) fail(); // an unterminated $( or `
  flush();
  return { tokens, end: i };

  // `$…` / `` `…` `` at src[at]: marks the word non-literal, recurses into substitutions.
  function expansion(at) {
    word.literal = false;
    if (src[at] === '`') return sub(at + 1, '`');
    const n = src[at + 1];
    if (n === '(') {
      if (src[at + 2] === '(') {
        const close = src.indexOf('))', at + 3);
        if (close === -1) fail();
        return close + 2;
      }
      return sub(at + 2, ')');
    }
    if (n === '{') {
      let depth = 1;
      let j = at + 2;
      while (j < src.length && depth) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        j++;
      }
      if (depth) fail();
      return j;
    }
    if (n === "'") {
      // ANSI-C $'…' — a literal string
      word.literal = true;
      let j = at + 2;
      while (j < src.length && src[j] !== "'") j += src[j] === '\\' ? 2 : 1;
      if (j >= src.length) fail();
      word.text += src.slice(at + 2, j);
      word.quoted = true;
      return j + 1;
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*|^[0-9@*#?$!-]/.exec(src.slice(at + 1));
    if (!m) {
      word.literal = true; // a lone `$`
      word.text += '$';
      return at + 1;
    }
    return at + 1 + m[0].length;
  }
}

const RESERVED_DROP = new Set([
  'if',
  'then',
  'else',
  'elif',
  'do',
  'while',
  'until',
  '!',
  '{',
  'time',
]);
const RESERVED_SKIP = new Set([
  'fi',
  'done',
  'esac',
  '}',
  'for',
  'case',
  'select',
  'function',
  'in',
]);

/** Tokens → simple commands: { assigns, words, redirs }. */
function commandsOf(tokens) {
  const out = [];
  let cur = { assigns: [], words: [], redirs: [] };
  const end = () => {
    const c = cur;
    cur = { assigns: [], words: [], redirs: [] };
    // reserved words at the front
    while (
      c.words.length &&
      c.words[0].literal &&
      !c.words[0].quoted &&
      RESERVED_DROP.has(c.words[0].text)
    )
      c.words.shift();
    if (c.words.length && c.words[0].literal && RESERVED_SKIP.has(c.words[0].text)) return;
    if (c.words.length && c.words[0].text === '[[') return; // a test: its < > are comparisons
    if (c.words.length || c.redirs.length) out.push(c);
  };
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk.t === 'op') {
      end();
      continue;
    }
    if (tk.t === 'redir') {
      // a heredoc's body was read at its line's end (lex), before this runs
      const r = { op: tk.op, fd: tk.fd, target: null, body: tk.body };
      cur.redirs.push(r);
      if (tk.op === '<<' || tk.op === '<<-') continue;
      const nx = tokens[k + 1];
      if (nx?.t === 'word') {
        r.target = nx;
        k++;
      }
      continue;
    }
    if (!cur.words.length && /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(tk.text)) {
      cur.assigns.push(tk);
      continue;
    }
    cur.words.push(tk);
  }
  end();
  return out;
}

/** Every simple command in `src` (substitutions included), or null when it can't be followed. */
export function parseBash(src) {
  if (typeof src !== 'string') return null;
  try {
    const nested = [];
    const { tokens } = lex(src, 0, null, nested);
    return [...commandsOf(tokens), ...nested];
  } catch (e) {
    if (e instanceof Unparseable) return null;
    return null;
  }
}

// ── classification ───────────────────────────────────────────────────────────────────────────

const CANVAS_RE = /\.(?:tsx|jsx)$/;
const WRAPPERS = new Set(['sudo', 'command', 'builtin', 'exec', 'nohup', 'nice', 'time', 'env']);
const INTERPRETERS = {
  node: ['-e', '--eval', '-p', '--print'],
  bun: ['-e', '--eval', '-p', '--print'],
  deno: ['eval'],
  python: ['-c'],
  python3: ['-c'],
  ruby: ['-e'],
  perl: ['-e', '-E'],
};
const SCRIPT_WRITES =
  /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|rmSync|unlink(?:Sync)?|rename(?:Sync)?|copyFile(?:Sync)?|cpSync|truncate(?:Sync)?|Bun\.write|write_text|write_bytes|os\.remove|os\.replace|os\.rename|shutil\.\w+|File\.write|FileUtils)\b|\bopen\s*\([^)]*['"][wax+]b?['"]|\bmode\s*=\s*['"][wax+]|\bopen\s*\([^)]*['"]\+?>{1,2}/;

const MESSAGES = {
  'use-trash': (rel) =>
    `use-trash: ${rel} is a versioned design file — Bash never deletes it. Move a canvas to the trash: \`maude design trash move "<canvas path>"\` (or ask the person to delete it in Canvases); remove one artboard by deleting its DCArtboard block with Edit.`,
  'use-verb': (rel) =>
    `use-verb: ${rel} is a versioned design file — Bash never moves it. Rename with \`maude design canvas move …\` (or ask the person to move it in Canvases).`,
  'not-a-writer': (rel) =>
    `not-a-writer: files in .design/ (${rel}) are written with Edit/Write or a \`maude design\` verb, so every change is checked. Edit the file instead.`,
};

/**
 * The design-root view of one word: { rel, runtime } when it names a path inside the design root,
 * null when it doesn't (or can't be seen).
 */
function designPath(word, cwd, designRoot) {
  if (!word?.literal || !word.text) return null;
  if (!isAbsolute(word.text) && !cwd) return null;
  const abs = resolve(cwd ?? '/', word.text);
  const rel = relative(designRoot, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  const posix = rel.split(sep).join('/');
  const first = posix.split('/')[0] ?? '';
  return { rel: posix || '.', runtime: first.startsWith('_') || first.startsWith('.') };
}

/** The effective command: wrappers (`sudo`, `env A=b`, `command`) stripped. */
function effective(words) {
  let k = 0;
  while (k < words.length) {
    const w = words[k];
    if (!w.literal) return null;
    const name = basename(w.text);
    if (!WRAPPERS.has(name)) break;
    k++;
    // env's own flags and NAME=value words
    while (
      k < words.length &&
      words[k].literal &&
      (/^-/.test(words[k].text) || /^[A-Za-z_]\w*=/.test(words[k].text))
    )
      k++;
  }
  if (k >= words.length || !words[k].literal) return null;
  return { name: basename(words[k].text), args: words.slice(k + 1) };
}

const isOpt = (w) => w.literal && /^-/.test(w.text) && w.text !== '-';
/** Non-option args (everything after a bare `--` is an arg). */
function operands(args) {
  const out = [];
  let opts = true;
  for (const a of args) {
    if (opts && a.literal && a.text === '--') {
      opts = false;
      continue;
    }
    if (opts && isOpt(a)) continue;
    out.push(a);
  }
  return out;
}

/** Is `cmd` (a parsed simple command) a `maude …` invocation? → the words after `maude`, or null. */
export function maudeWords(cmd) {
  const e = effective(cmd.words);
  if (!e) return null;
  if (e.name === 'maude' || e.name === 'mdcc' || e.name === 'maude.mjs') return e.args;
  if (
    (e.name === 'node' || e.name === 'bun') &&
    e.args[0]?.literal &&
    /maude\.mjs$/.test(e.args[0].text)
  )
    return e.args.slice(1);
  if (e.name === 'npx' || e.name === 'bunx') {
    const k = e.args.findIndex((a) => a.literal && /^(?:@1agh\/)?maude(?:@.*)?$/.test(a.text));
    if (k !== -1) return e.args.slice(k + 1);
  }
  return null;
}

/** `{ verb, effect }` of a `maude design <verb> [sub]` command, from the manifest's verb table. */
export function designVerbOf(cmd, verbs) {
  const w = maudeWords(cmd);
  if (!w?.[0]?.literal || w[0].text !== 'design' || !w[1]?.literal) return null;
  const one = `design ${w[1].text}`;
  const two = w[2]?.literal ? `${one} ${w[2].text}` : null;
  const row =
    (two && verbs?.find((v) => v.verb === two)) || verbs?.find((v) => v.verb === one) || null;
  return { verb: w[1].text, effect: row?.effect ?? null };
}

/**
 * The pre-bash decision for `command` run in `cwd`: { code, reason } or null (no decision).
 * Pure apart from reading nothing: the paths are judged by name, never stat'ed.
 */
export function classifyBash(command, { cwd, designRoot }) {
  if (typeof command !== 'string' || !command) return null;
  const inDesign = (() => {
    const r = relative(designRoot, resolve(cwd ?? '/'));
    return !(r.startsWith('..') || isAbsolute(r));
  })();
  // fast path: nothing here can name the design root
  if (!inDesign && !command.includes('.design') && !command.includes(designRoot)) return null;
  const cmds = parseBash(command);
  if (!cmds) return null;
  let here = cwd;
  const hit = (code, p) => ({ code, reason: MESSAGES[code](p.rel) });
  const versioned = (w) => {
    const p = designPath(w, here, designRoot);
    return p && !p.runtime ? p : null;
  };
  for (const cmd of cmds) {
    // redirections into the design root, whoever produces the bytes
    for (const r of cmd.redirs) {
      if (!['>', '>>', '>|', '&>', '&>>', '<>'].includes(r.op)) continue;
      const p = versioned(r.target);
      if (p) return hit('not-a-writer', p);
    }
    const e = effective(cmd.words);
    if (!e) continue;
    const { name, args } = e;
    if (name === 'cd' || name === 'pushd') {
      const to = args.find((a) => !isOpt(a));
      here = !to ? homedir() : to.literal ? resolve(here ?? '/', to.text) : null;
      continue;
    }
    if (maudeWords(cmd)) continue; // a maude verb is the checked writer
    const ops = operands(args);
    if (['rm', 'unlink', 'rmdir', 'shred', 'trash'].includes(name)) {
      for (const a of ops) {
        const p = versioned(a);
        if (p) return hit('use-trash', p);
      }
      continue;
    }
    if (name === 'git') {
      // git [-C dir] [-c k=v] <sub> …
      let k = 0;
      let gitCwd = here;
      while (k < args.length && isOpt(args[k])) {
        if (args[k].text === '-C' && args[k + 1]) {
          gitCwd = args[k + 1].literal ? resolve(here ?? '/', args[k + 1].text) : null;
          k += 2;
        } else if (args[k].text === '-c') k += 2;
        else k++;
      }
      const subName = args[k]?.literal ? args[k].text : null;
      if (subName !== 'rm' && subName !== 'mv') continue;
      const saved = here;
      here = gitCwd;
      const rest = operands(args.slice(k + 1));
      const srcs = subName === 'mv' ? rest.slice(0, -1) : rest;
      for (const a of srcs) {
        const p = versioned(a);
        if (p) {
          here = saved;
          return hit(subName === 'rm' ? 'use-trash' : 'use-verb', p);
        }
      }
      here = saved;
      continue;
    }
    if (name === 'find') {
      const deletes = args.some(
        (a, j) =>
          a.literal &&
          (a.text === '-delete' ||
            ((a.text === '-exec' || a.text === '-execdir') &&
              ['rm', 'unlink', 'shred'].includes(basename(args[j + 1]?.text ?? ''))))
      );
      if (!deletes) continue;
      for (const a of args) {
        if (a.literal && /^[-(!]/.test(a.text)) break; // the expression starts
        const p = versioned(a);
        if (p) return hit('use-trash', p);
      }
      continue;
    }
    if (name === 'mv') {
      const t = targetDir(args);
      const srcs = t ? ops : ops.slice(0, -1);
      for (const a of srcs) {
        const p = versioned(a);
        if (p) return hit('use-verb', p);
      }
      const dest = t ?? (ops.length >= 2 ? ops[ops.length - 1] : null);
      const p = versioned(dest);
      if (p) return hit('not-a-writer', p);
      continue;
    }
    if (['cp', 'rsync', 'install', 'ditto'].includes(name)) {
      // by DESTINATION only (V2-1.18 Q5): `cp .design/x /tmp` is a read
      const t = targetDir(args);
      const dest = t ?? (ops.length >= 2 ? ops[ops.length - 1] : null);
      const p = versioned(dest);
      if (p) return hit('not-a-writer', p);
      continue;
    }
    if (name === 'tee') {
      for (const a of ops) {
        const p = versioned(a);
        if (p) return hit('not-a-writer', p);
      }
      continue;
    }
    const sedInPlace =
      (name === 'sed' || name === 'gsed') &&
      args.some((a) => a.literal && (/^-[nrsuzE]*i/.test(a.text) || /^--in-place/.test(a.text)));
    const perlInPlace =
      name === 'perl' && args.some((a) => a.literal && /^-[pnlawsTtWXcU0-9]*i/.test(a.text));
    if (sedInPlace || perlInPlace) {
      // the script is not a file: -e/-f (perl -e/-E) take the next arg; without one, the first
      // operand is the script
      const takesScript = sedInPlace ? /^-[nrsuzE]*[ef]$/ : /^-[A-Za-z0-9.]*[eE]$/;
      const files = [];
      let sawScript = args.some((a) => a.literal && takesScript.test(a.text));
      for (let j = 0; j < args.length; j++) {
        const a = args[j];
        if (isOpt(a)) {
          if (takesScript.test(a.text)) j++;
          continue;
        }
        if (!sawScript) {
          sawScript = true;
          continue;
        }
        files.push(a);
      }
      for (const a of files) {
        const p = versioned(a);
        if (p) return hit('not-a-writer', p);
      }
      continue;
    }
    const lang = /^python3/.test(name) ? 'python3' : /^python/.test(name) ? 'python' : name;
    const flags = INTERPRETERS[lang];
    if (flags) {
      const text = scriptText(cmd, args, flags, lang);
      if (text === null || !SCRIPT_WRITES.test(text)) continue;
      // a .design path the script names, runtime (`.design/_…`) ones excepted
      const named = [...text.matchAll(/\.design(?:\/([^\s'"`),;]*))?/g)]
        .map((m) => m[1] ?? '')
        .filter((after) => {
          const first = after.split('/')[0] ?? '';
          return !(first.startsWith('_') || first.startsWith('.'));
        });
      if (text.includes(designRoot)) named.push('.');
      if (named.length) return hit('not-a-writer', { rel: named[0] || '.' });
    }
  }
  return null;
}

/** The script an interpreter runs: its -e/-c argument, else a heredoc / here-string on stdin. */
function scriptText(cmd, args, flags, lang) {
  for (let j = 0; j < args.length; j++) {
    const a = args[j];
    if (!a.literal) continue;
    if (flags.includes(a.text) || (lang.startsWith('python') && /^-[A-Za-z]*c$/.test(a.text))) {
      const s = args[j + 1];
      return s?.literal ? s.text : null;
    }
  }
  // `python3 - <<'EOF'` / `node <<EOF`: no script file, the program is stdin
  const first = operands(args)[0];
  if (first && !(first.literal && first.text === '-')) return null;
  const doc = cmd.redirs.find((r) => r.op === '<<' || r.op === '<<-' || r.op === '<<<');
  if (!doc) return null;
  if (doc.op === '<<<') return doc.target?.literal ? doc.target.text : null;
  return doc.body ?? null;
}

/** `-t DIR` / `--target-directory=DIR` → the DIR word. */
function targetDir(args) {
  for (let j = 0; j < args.length; j++) {
    const a = args[j];
    if (!a.literal) continue;
    if (a.text === '-t' && args[j + 1]) return args[j + 1];
    const m = /^--target-directory=(.+)$/.exec(a.text);
    if (m) return { ...a, text: m[1] };
  }
  return null;
}

// ── which files a verb wrote ─────────────────────────────────────────────────────────────────

/**
 * Versioned design-root files (POSIX, designRoot-relative) whose mtime is ≥ `since`. Skips
 * runtime `_*` / hidden entries and node_modules. Bounded: stops after `maxEntries` entries walked
 * and returns at most `max` files.
 */
export function designWritesSince(designRoot, since, { max = 64, maxEntries = 20000 } = {}) {
  const out = [];
  let seen = 0;
  const walk = (dir, relDir) => {
    let names;
    try {
      names = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of names) {
      if (out.length >= max || ++seen > maxEntries) return;
      if (d.name.startsWith('_') || d.name.startsWith('.') || d.name === 'node_modules') continue;
      const abs = join(dir, d.name);
      const rel = relDir ? `${relDir}/${d.name}` : d.name;
      if (d.isDirectory()) walk(abs, rel);
      else if (d.isFile()) {
        try {
          if (statSync(abs).mtimeMs >= since) out.push(rel);
        } catch {
          /* gone */
        }
      }
    }
  };
  walk(designRoot, '');
  return out.sort();
}

export { CANVAS_RE };
