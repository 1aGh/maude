// bash-guard.mjs — the design plugin's Bash rules (contract V2-1.11 §5.4 pre-bash / post-bash,
// narrowed by V2-1.18 §9 Q5). A best-effort POSIX-shell reader, then five deny codes:
//
//   use-trash     rm / unlink / rmdir / git rm / find -delete of a versioned .design/** file
//   use-verb      mv / git mv of a versioned .design/** file
//   not-a-writer  a non-`maude` writer into .design/**: sed -i/-I, perl -i, tee, > / >>, cp / rsync /
//                 install / ditto / ln BY DESTINATION (a hard link's sources too), git checkout /
//                 restore of a path, and node -e / python -c / … only when the script text writes
//                 AND names a .design path
//
// Command names are the PARSED words, basename'd and case-folded (`nameOf`): `r''m`, `r\m`, `RM`
// (APFS) all run rm. Every command is parsed — a text pre-filter can't see those names.
//
//   human-only    a write (POST, a body) to a studio route a person starts in the Maude window —
//                 `/_api/cloud/move` (S6.0c) — by curl, curl-local or a script; a GET passes
//
//   out-of-project  a `maude` command's output redirected (> >> &> 2> >| or a `tee` it feeds) to a
//                 path outside the repo root and the OS temp dir (§9 Q3) — `outOfProject` below;
//                 and (gate-b-sec2) a `maude` command whose `--root` / `--design-root` names another
//                 project, or a call that sets / unsets the session env a maude verb is held by
//
// FAIL-OPEN: a command the reader can't follow (unbalanced quotes, an unterminated `$(`), a word it
// can't see (`$VAR`, `$(…)`, a relative path after `cd $X`) never produces a decision. A read is
// never denied: `maude design read-annotations x | python3 -c "json.load…"`, `cp .design/x /tmp`.
// Runtime paths (a `_*` or hidden first segment under the design root) are free.
//
// A path is judged by the file the kernel opens (Phase 2 gate F2): realpath'd segment by segment,
// so a symlink, a `..` walk or a case alias (`.DESIGN` on case-insensitive APFS) is the design
// root it reaches. RESIDUAL: a node -e / python -c script that reaches the root by another name
// (a symlink, `path.join('.de', 'sign')`) is not seen — the script is text, not a path.
//
// Also: which `maude design` verb a command runs (post-bash binds a write verb's writes to the run)
// and `designWritesSince`, the bounded mtime walk that finds them.
//
// Leaf module: node built-ins only (plus the sibling leaf confine-out.mjs for `realpathDeep`).

import { readdirSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { realpathDeep } from './confine-out.mjs';
import { DESIGN_ROOT_FLAGS, ROOT_FLAGS, SESSION_ENV_KEYS } from './confine-root.mjs';
import { findProjectRoot } from './studio-locate.mjs';

// ── the reader ───────────────────────────────────────────────────────────────────────────────

const OP_CHARS = new Set([';', '&', '|', '<', '>', '(', ')', '\n']);
const ENV_HEADS = new Set(['HOME', 'TMPDIR']);
const WS = new Set([' ', '\t', '\r']);

class Unparseable extends Error {}

const ANSI_C_SIMPLE = {
  a: '\x07',
  b: '\b',
  e: '\x1b',
  E: '\x1b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '\\': '\\',
  "'": "'",
  '"': '"',
  '?': '?',
};
/** The body of a bash ANSI-C `$'…'` string, decoded the way bash decodes it (\xHH, \NNN octal,
 *  \uHHHH, \UHHHHHHHH, \cX, the single-letter escapes); an unknown escape stays as written. */
function decodeAnsiC(body) {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\' || i + 1 >= body.length) {
      out += c;
      continue;
    }
    const n = body[++i];
    if (n in ANSI_C_SIMPLE) out += ANSI_C_SIMPLE[n];
    else if (n === 'x' || n === 'u' || n === 'U') {
      const max = n === 'x' ? 2 : n === 'u' ? 4 : 8;
      const m = new RegExp(`^[0-9a-fA-F]{1,${max}}`).exec(body.slice(i + 1));
      if (!m) out += `\\${n}`;
      else {
        const cp = Number.parseInt(m[0], 16);
        out += cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
        i += m[0].length;
      }
    } else if (n >= '0' && n <= '7') {
      const m = /^[0-7]{1,3}/.exec(body.slice(i));
      out += String.fromCharCode(Number.parseInt(m[0], 8) & 0xff);
      i += m[0].length - 1;
    } else if (n === 'c' && i + 1 < body.length) {
      out += String.fromCharCode(body.charCodeAt(++i) & 0x1f);
    } else out += `\\${n}`;
  }
  return out;
}
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
  // `word.exp` counts the expansions in a word; `word.env` names a $HOME / $TMPDIR (or ${…}) that
  // opens it — the one expansion the out-of-project check resolves (see `outTarget`).
  function expansion(at) {
    word.literal = false;
    word.exp = (word.exp ?? 0) + 1;
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
      const name = src.slice(at + 2, j - 1);
      if (word.text === '' && word.exp === 1 && ENV_HEADS.has(name)) word.env = name;
      if (word.exp === 1 && VAR_NAME.test(name)) word.ref = { name, at: word.text.length };
      return j;
    }
    if (n === "'") {
      // ANSI-C $'…' — a literal string
      word.literal = true;
      word.exp--;
      let j = at + 2;
      while (j < src.length && src[j] !== "'") j += src[j] === '\\' ? 2 : 1;
      if (j >= src.length) fail();
      // bash runs the DECODED word (`$'\x72m'` is `rm`), so the guard judges it decoded too
      word.text += decodeAnsiC(src.slice(at + 2, j));
      word.quoted = true;
      return j + 1;
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*|^[0-9@*#?$!-]/.exec(src.slice(at + 1));
    if (!m) {
      word.literal = true; // a lone `$`
      word.exp--;
      word.text += '$';
      return at + 1;
    }
    if (word.text === '' && word.exp === 1 && ENV_HEADS.has(m[0])) word.env = m[0];
    if (word.exp === 1 && VAR_NAME.test(m[0])) word.ref = { name: m[0], at: word.text.length };
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

const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ASSIGN_RE = /^([A-Za-z_][A-Za-z0-9_]*)(\+?)=/;
const DECLARE = new Set(['export', 'declare', 'typeset', 'local', 'readonly']);

/**
 * V2-8.16 — follow a variable an earlier command in the same script set to a literal
 * (`f="ui/C.tsx" && sed -i … "$f"`): a word whose ONE expansion is `$f` / `${f}` becomes the
 * literal it names. Only a bare assignment (`f=…`, `export f=…`) binds — a prefix one
 * (`f=x cmd "$f"`) is not in effect while `cmd`'s words expand. A loop, `read`, `unset` or a value
 * the reader can't see unbinds; an unquoted value that would split or glob is not substituted.
 * Anything not followed stays unseen (fail open), as before.
 */
function bindVars(c, vars) {
  const fill = (w) => {
    if (!w || w.literal || w.exp !== 1 || !w.ref || !vars.has(w.ref.name)) return;
    const v = vars.get(w.ref.name);
    if (!w.quoted && /[\s*?[]/.test(v)) return;
    w.text = w.text.slice(0, w.ref.at) + v + w.text.slice(w.ref.at);
    w.literal = true;
    w.exp = 0;
    delete w.env;
    delete w.ref;
  };
  const bind = (tk) => {
    const m = ASSIGN_RE.exec(tk.text);
    if (!m) return;
    const [, name, append] = m;
    const v = tk.text.slice(m[0].length);
    if (!tk.literal || (append && !vars.has(name))) vars.delete(name);
    else vars.set(name, append ? vars.get(name) + v : v);
  };
  for (const a of c.assigns) fill(a);
  for (const w of c.words) fill(w);
  for (const r of c.redirs) fill(r.target);
  if (vars.off) return;
  // p8-secfix-hook F1(d) — the head after a reserved word (`while read f`, `if printf -v f …`) and
  // `builtin` / `command`, which run the same builtin
  let h = 0;
  while (
    h < c.words.length &&
    c.words[h].literal &&
    !c.words[h].quoted &&
    (RESERVED_DROP.has(c.words[h].text) || HEAD_WRAPPERS.has(c.words[h].text))
  )
    h++;
  const head = c.words[h]?.literal ? c.words[h].text : null;
  const rest = c.words.slice(h + 1);
  const unbindNames = () => {
    for (const w of rest) {
      // `-v f` / `-vf`: the name after the flag is assigned too
      const name = w.literal ? w.text.replace(/^-[A-Za-z]*v/, '') : '';
      if (VAR_NAME.test(name)) vars.delete(name);
      if (w.literal && VAR_NAME.test(w.text)) vars.delete(w.text);
      const a = w.literal ? ASSIGN_RE.exec(w.text) : null; // `let f=1`
      if (a) vars.delete(a[1]);
    }
  };
  if (!c.words.length) for (const a of c.assigns) bind(a);
  else if (
    head === 'eval' ||
    head === 'source' ||
    head === '.' ||
    (DECLARE.has(head) && rest.some((w) => !w.literal || /^[-+][A-Za-z]*n/.test(w.text)))
  ) {
    // anything may be assigned (eval, a sourced file), or a nameref re-points every later
    // assignment (`declare -n f=g; f=x` sets g): nothing bound so far or from here on is trusted
    vars.clear();
    vars.off = true;
  } else if (DECLARE.has(head)) {
    for (const w of rest) if (!(w.literal && w.text.startsWith('-'))) bind(w);
  } else if (ASSIGNING.has(head)) {
    unbindNames();
    if (head === 'read' && !rest.some((w) => w.literal && VAR_NAME.test(w.text)))
      vars.delete('REPLY');
    if (head === 'mapfile' || head === 'readarray') vars.delete('MAPFILE');
    if (head === 'getopts') for (const n of ['OPTARG', 'OPTIND']) vars.delete(n);
  } else if ((head === 'for' || head === 'select') && rest[0]?.literal) {
    vars.delete(rest[0].text);
  }
}
/** Words that run the next word as the same builtin (`builtin printf -v f …`). */
const HEAD_WRAPPERS = new Set(['builtin', 'command']);
/**
 * Builtins that assign a variable named by an operand (`printf -v f`, `read f`, `mapfile f`,
 * `getopts opts f`, `let f=1`, `wait -p f`): every literal name among their words is unbound — an
 * over-unbind only leaves a word unseen, which is the fail-open default.
 */
const ASSIGNING = new Set([
  'unset',
  'read',
  'printf',
  'mapfile',
  'readarray',
  'getopts',
  'let',
  'wait',
  'coproc',
]);

/** Tokens → simple commands: { assigns, words, redirs }. */
function commandsOf(tokens) {
  const out = [];
  const vars = new Map(); // V2-8.16 — literal values bound so far (bindVars)
  let cur = { assigns: [], words: [], redirs: [], pipeIn: false };
  const end = (piped = false) => {
    const c = cur;
    cur = { assigns: [], words: [], redirs: [], pipeIn: piped };
    bindVars(c, vars);
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
    // a bare assignment is a command too (p8-secfix-hook F1(a): `PATH=/tmp/x; cat f`)
    if (c.words.length || c.redirs.length || c.assigns.length) out.push(c);
  };
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk.t === 'op' && tk.op === '&') {
      // p8-secfix-hook F2 — `a &`, `(a; b) &`, `while …; done &`: a job that outlives the call.
      // The flag rides the last command the `&` ends (a `}` / `done` / `)` is not one of them).
      end();
      const last = out[out.length - 1];
      if (last) last.bg = true;
      else out.push({ assigns: [], words: [], redirs: [], pipeIn: false, bg: true });
      continue;
    }
    if (tk.t === 'op') {
      // `a | b`: b reads a's stdout (pipeIn), which is how `maude … | tee <path>` is seen
      end(tk.op === '|' || tk.op === '|&');
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
/** A wrapper's flags whose operand is the next word (not the command). */
const OPERAND_FLAGS = {
  env: new Set(['-u', '--unset', '-C', '--chdir']),
  sudo: new Set(['-u', '-g', '-C', '-h', '-p', '-U']),
  nice: new Set(['-n']),
  exec: new Set(['-a']),
};
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
  // The route is the studio's own (the one Canvases uses), reached with `curl-local`; the port is in
  // `.design/_server.json`. (These messages once named `maude design trash move` / `canvas move`:
  // neither verb exists, and the agent spent 15+ calls finding this route.)
  'use-trash': (rel) =>
    `use-trash: ${rel} is a versioned design file — Bash never deletes it. Move a canvas to the trash with \`maude design trash move <canvas path>\` (the studio's own Move canvas to trash; \`maude design trash restore <canvas path>\` brings it back — or ask the person to delete it in Canvases); remove one artboard by deleting its DCArtboard block with Edit.`,
  'use-verb': (rel) =>
    `use-verb: ${rel} is a versioned design file — Bash never moves it. Rename or move it with the studio's own route: \`maude design curl-local http://127.0.0.1:<port>/_api/fs-move --method POST --header "Content-Type: application/json" --data '{"file":"<canvas path>","toName":"<new name>"}'\` (add "toDir" to move it to another folder; port: .design/_server.json; or ask the person to move it in Canvases). To the trash: \`maude design trash move <canvas path>\`.`,
  'out-of-project': (path) =>
    `out-of-project: this \`maude\` command's output would be written to ${path}, outside the project. Write inside the project or the temp dir (or drop the redirection and read the output).`,
  'other-project': (what) =>
    `out-of-project: ${what} names a different project. In this session maude verbs work only on this project; to work on another one, the person opens it in Maude or runs the command in their own terminal.`,
  'session-env': (key) =>
    `out-of-project: this command changes ${key}, which this session sets for maude verbs (its project, its chat, the web switch). Run the maude verb without it.`,
  'not-a-writer': (rel) =>
    `not-a-writer: files in .design/ (${rel}) are written with Edit/Write or a \`maude design\` verb, so every change is checked. Edit the file instead.`,
  'human-only': (what, why) =>
    `human-only: ${what} is the person's act in the Maude window (${why}). Tell them to use ${what} in the Share sheet; reading its state with a GET is fine.`,
};

// ── human-only studio routes (S6.0c) ─────────────────────────────────────────────────────────
// A write to one of these is the person's act in the Maude window: the studio refuses it without
// the window's own `Sec-Fetch-Site: same-origin` (routes/cloud-move.ts), so this rule only names
// why before the command runs. Matched on the PARSED word text (quotes removed, `$VAR` dropped),
// so `cl""oud/move` and `127.0.0.1:$PORT/_api/cloud/move` are seen. A GET (status) passes, and so
// does any command that names the route without a write sign (`rg cloud/move`). RESIDUAL: a script
// that builds the path from pieces is not seen — the server's gate is the boundary, not this.
const HUMAN_ONLY_ROUTES = [
  {
    re: /\/_api\/cloud\/move(?![\w-])/i,
    what: 'Move to cloud',
    why: 'it uploads the project to their billed cloud account',
  },
  // V2-8.9 defender M1 (decision maude/v2-8.9-sync-link-confirm-needs-fetch-metadata).
  {
    re: /\/_api\/sync\/link\/confirm(?![\w-])/i,
    what: 'Connect to the hub',
    why: "it sends this Mac's hub credential to the folder's hub",
  },
  // V2-8.9 round 2 R2-M2 — the desktop's share writes run with this Mac's hub credential; the studio
  // answers them 403 window-only without the window's own fetch (routes/share.ts).
  {
    re: /\/_api\/share\/(?:invites|people|links|requests)(?![\w-])/i,
    what: 'Share',
    why: "it invites people, changes their access or makes a link with this Mac's hub credential",
  },
];

// V2-8.9 round 2 R2-L1 — `maude design link|adopt` hands this Mac's hub credential to a hub (and
// adopt rewrites config.json). The dispatcher refuses them in an AI session by env, which the
// agent's own command can change; this hook's verdict cannot be.
const HUMAN_ONLY_VERBS = new Set(['link', 'adopt']);
function humanOnlyVerb(cmds) {
  for (const cmd of cmds) {
    const mw = maudeWords(cmd);
    if (!mw || mw[0]?.text !== 'design' || !HUMAN_ONLY_VERBS.has(mw[1]?.text)) continue;
    return {
      code: 'human-only',
      reason: MESSAGES['human-only'](
        'Connect to a hub',
        `\`maude design ${mw[1].text}\` sends this Mac's hub credential to a hub`
      ),
    };
  }
  return null;
}
const READ_METHODS = new Set(['GET', 'HEAD']);
/** A write sign in a script / non-curl client's words (wget --post-data, fetch {method:'POST'}). */
const SCRIPT_REQUEST_WRITE = /\bpost\b|--post|\bmethod\b|\bdata\s*=|--data|--body/i;

/** curl's words: does this request carry a body or a non-read method? Unknown → a write. */
function curlWrites(args) {
  for (let i = 0; i < args.length; i++) {
    const t = args[i].text ?? '';
    const next = () => (args[i + 1]?.text ?? '').toUpperCase();
    if (/^--(?:data|json|form|upload-file|post)/.test(t)) return true;
    const long = /^--request(?:=(.*))?$/.exec(t);
    if (long) {
      const m = (long[1] ?? next()).toUpperCase();
      if (!READ_METHODS.has(m)) return true;
      continue;
    }
    if (/^-[A-Za-z]/.test(t) && !t.startsWith('--')) {
      const flags = t.slice(1);
      const x = flags.indexOf('X');
      const before = x === -1 ? flags : flags.slice(0, x);
      if (/[dFT]/.test(before)) return true;
      if (x !== -1) {
        const m = (flags.slice(x + 1) || next()).toUpperCase();
        if (!READ_METHODS.has(m)) return true;
      }
    }
  }
  return false;
}

/** `maude design curl-local`'s own small vocabulary (bin/_curl-local.mjs): --method / --data. */
function curlLocalWrites(args) {
  for (let i = 0; i < args.length; i++) {
    const t = args[i].text ?? '';
    if (t === '--data') return true;
    if (t === '--method' && !READ_METHODS.has((args[i + 1]?.text ?? '').toUpperCase())) return true;
  }
  return false;
}

function humanOnlyRoute(cmds) {
  for (const cmd of cmds) {
    const texts = cmd.words.map((w) => w.text ?? '');
    const route = HUMAN_ONLY_ROUTES.find((r) => texts.some((t) => r.re.test(t)));
    if (!route) continue;
    const mw = maudeWords(cmd);
    const e = effective(cmd.words);
    let writes;
    if (mw) {
      const local = mw[0]?.text === 'design' && mw[1]?.text === 'curl-local';
      writes = local
        ? curlLocalWrites(mw.slice(2))
        : texts.some((t) => SCRIPT_REQUEST_WRITE.test(t));
    } else if (e?.name === 'curl') writes = curlWrites(e.args);
    else writes = texts.some((t) => SCRIPT_REQUEST_WRITE.test(t));
    if (writes)
      return { code: 'human-only', reason: MESSAGES['human-only'](route.what, route.why) };
  }
  return null;
}

/**
 * The design-root view of one word: { rel, runtime } when it names a path inside the design root,
 * null when it doesn't (or can't be seen). Judged by the file the kernel opens (Phase 2 gate F2):
 * the word is joined to the cwd unnormalised and realpath'd segment by segment (confine-out
 * `realpathDeep` — symlinks followed, `..` popped after them, the on-disk case), then made
 * relative to the realpath'd design root. `designReal` is that root.
 */
function designPath(word, cwd, designReal) {
  if (!word?.literal || !word.text || word.text.includes('\0')) return null;
  if (!isAbsolute(word.text) && !cwd) return null;
  const abs = realpathDeep(isAbsolute(word.text) ? word.text : `${cwd}${sep}${word.text}`);
  const rel = relative(designReal, abs);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  const posix = rel.split(sep).join('/');
  const first = posix.split('/')[0] ?? '';
  return { rel: posix || '.', runtime: first.startsWith('_') || first.startsWith('.') };
}

/**
 * A command word as the binary that runs (Phase 2 gate round 3): the PARSED word (quotes and
 * backslashes already gone — `r''m`, `r\\m`, `"rm"` are `rm`), basename'd and case-folded, because
 * APFS (case-insensitive by default) runs `/bin/rm` for `RM`. Folding on a case-sensitive file
 * system only judges a name that would not run — harmless.
 */
const nameOf = (text) => basename(text).toLowerCase();

/**
 * The effective command: wrappers (`sudo`, `env A=b`, `command`) stripped. `name` is folded
 * (`nameOf`); `raw` is the word as written — `cd` / `pushd` are shell BUILTINS, matched exactly:
 * `CD x` runs macOS's /usr/bin/cd in a child and leaves this shell where it was.
 */
function effective(words) {
  let k = 0;
  while (k < words.length) {
    const w = words[k];
    if (!w.literal) return null;
    const wrapper = nameOf(w.text);
    if (!WRAPPERS.has(wrapper)) break;
    k++;
    // env's own flags and NAME=value words; a flag that takes an operand skips it too
    // (`env -u NAME maude …`, `env -C dir`, `sudo -u user` — gate-b-sec2: else NAME read as the command)
    const takesArg = OPERAND_FLAGS[wrapper];
    while (
      k < words.length &&
      words[k].literal &&
      (/^-/.test(words[k].text) || /^[A-Za-z_]\w*=/.test(words[k].text))
    ) {
      if (takesArg?.has(words[k].text)) k++;
      k++;
    }
  }
  if (k >= words.length || !words[k].literal) return null;
  return { name: nameOf(words[k].text), raw: words[k].text, args: words.slice(k + 1) };
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

// ── V2-8.16: may this call write at all? ─────────────────────────────────────────────────────

/**
 * Commands that only read: no flag of theirs writes a file (`sort -o`, `uniq a b`, `xxd -r`, `sed`'s
 * `w`, `awk`'s `print >`, `git diff --output` are why those are NOT here). `find` is a reader unless an
 * action that runs or writes follows (FIND_WRITES).
 * p8-secfix-hook (V2-8.9 final delta F1/D2): `rg` (`--pre CMD`, `--hostname-bin CMD` run a program),
 * `tree` (`-o FILE`, `-R` writes 00Tree.html) and `file` (`-C -m M` writes M.mgc) are NOT here either:
 * a flag denylist over tools that add flags per release is the class Claude Code's own read-only
 * check lost to (CVE-2025-64755, CVE-2025-66032); leaving them out costs only a claim window.
 */
const READERS = new Set([
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'grep',
  'egrep',
  'fgrep',
  'pwd',
  'echo',
  'printf',
  'stat',
  'which',
  'type',
  'true',
  'false',
  'test',
  '[',
  'basename',
  'dirname',
  'realpath',
  'readlink',
  'date',
  'sleep',
  'cut',
  'tr',
  'nl',
  'jq',
  'diff',
  'cmp',
  'du',
  'df',
  'cd',
  'pushd',
  'popd',
  'column',
  'shasum',
  'md5',
  'sha256sum',
  'find',
]);
const FIND_WRITES = /^-(?:delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/;

/**
 * V2-8.16 S7 — can `command` write a file? `false` only when it parses and EVERY simple command is a
 * known reader (READERS, or a `maude design` verb whose effect in `verbs` is `none`; an unknown verb
 * the CLI refuses) with no output redirection but a descriptor or a /dev sink. Anything else — an
 * interpreter (`python3 - <<EOF … open(p,'w')`), a word the reader can't see, an unparseable command,
 * any `maude design` verb when `verbs` is null — may write. The caller opens the run's claim-only
 * window for the call's duration: the guard can't read every language, so the run claims what changes
 * while the call runs, and only a provable read keeps a person's save out of it (V2-8.9 A1).
 *
 * @param {unknown} command
 * @param {ReadonlyArray<{ verb: string, effect: string | null }> | null} [verbs]
 * @returns {boolean}
 */
export function bashMayWrite(command, verbs = null) {
  if (typeof command !== 'string' || !command.trim()) return false;
  const cmds = parseBash(command);
  if (!cmds) return true;
  for (const cmd of cmds) {
    for (const r of cmd.redirs) {
      if (!OUT_OPS.has(r.op)) continue;
      const t = r.target;
      if (r.op === '>&' && t?.literal && /^(?:\d+|-)$/.test(t.text)) continue;
      if (t?.literal && DEV_SINKS.has(t.text)) continue;
      return true;
    }
    // p8-secfix-hook F1(a) — any assignment, prefix (`PATH=/tmp/x cat f`, `PERL5OPT=… shasum`) or
    // bare (`PATH=/tmp/x; cat f`: an exported name changes for every child), can pick the program a
    // reader runs or what it loads (PATH, PERL5*, RIPGREP_CONFIG_PATH, BASH_ENV, ENV, DYLD_*, …).
    // The guard can't know which names the inherited environment exports, so none is trusted.
    if (cmd.assigns.length) return true;
    if (!cmd.words.length) continue; // a bare redirection, judged above
    if (maudeWords(cmd)) {
      if (!verbs) return true;
      const v = designVerbOf(cmd, verbs);
      if (!v) return true; // `maude <top-level>`: not judged here
      // effect null = no such verb in the table: the CLI refuses it and writes nothing
      if (v.effect !== 'none' && v.effect !== null) return true;
      continue;
    }
    const e = effective(cmd.words);
    if (!e || !READERS.has(e.name)) return true;
    // F1(a) — a reader is a bare name the shell resolves through PATH: `/tmp/x/cat`, `./cat` only
    // share the basename (nameOf) with it
    if (e.raw.includes('/')) return true;
    if (cmd.words.length !== e.args.length + 1) return true; // a wrapper (`env`, `sudo`) runs it
    if (e.name === 'find' && e.args.some((a) => !a.literal || FIND_WRITES.test(a.text)))
      return true;
  }
  return false;
}

/** Commands whose job is to leave a process running after they return. */
const BG_HEADS = new Set([
  'nohup',
  'disown',
  'setsid',
  'coproc',
  'daemonize',
  'screen',
  'tmux',
  'at',
  'batch',
]);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
/** An interpreter script that starts a process it does not wait for (visible text only). */
const SCRIPT_DETACHES =
  /\b(?:fork|Popen|spawn|detached|unref|setsid|setpgid|start_new_session|daemon\w*|nohup|disown)\b/;

/** The names a command runs as, wrappers first: `sudo nice -n 5 nohup x` → sudo, nice, nohup, x. */
function headNames(words) {
  const out = [];
  let k = 0;
  while (k < words.length && words[k].literal) {
    const n = nameOf(words[k].text);
    out.push(n);
    if (!WRAPPERS.has(n)) break;
    k++;
    const takesArg = OPERAND_FLAGS[n];
    while (
      k < words.length &&
      words[k].literal &&
      (/^-/.test(words[k].text) || /^[A-Za-z_]\w*=/.test(words[k].text))
    ) {
      if (takesArg?.has(words[k].text)) k++;
      k++;
    }
  }
  return out;
}

/**
 * p8-secfix-hook (V2-8.9 final delta F2) — may `command` leave a process writing after the call
 * returns? A `&` job, `nohup` / `setsid` / `disown` / `coproc` / `screen` / `tmux` / `at`, a
 * `sh -c` script that does, or an interpreter script whose visible text forks or detaches. An
 * unparseable command may (fail closed). The caller keeps the call's claim window open until the
 * turn ends instead of the call's return + settle. A script FILE (`python3 w.py`) is not read —
 * the named residual (binding by what changed, not by time, is follow-up F3).
 *
 * @param {unknown} command
 * @returns {boolean}
 */
export function bashBackgrounds(command, depth = 0) {
  if (typeof command !== 'string' || !command.trim()) return false;
  const cmds = parseBash(command);
  if (!cmds) return true;
  for (const cmd of cmds) {
    if (cmd.bg) return true;
    const names = headNames(cmd.words);
    if (names.some((n) => BG_HEADS.has(n))) return true;
    const e = effective(cmd.words);
    if (!e) continue;
    if (SHELLS.has(e.name)) {
      const k = e.args.findIndex((a) => a.literal && /^-[A-Za-z]*c[A-Za-z]*$/.test(a.text));
      const script = k === -1 ? null : e.args[k + 1];
      if (script && !script.literal) return true;
      if (script && depth < 4 && bashBackgrounds(script.text, depth + 1)) return true;
      // `bash <<EOF … EOF`: the script is stdin
      const doc = k === -1 ? cmd.redirs.find((r) => r.op === '<<' || r.op === '<<-') : null;
      if (doc?.body && depth < 4 && bashBackgrounds(doc.body, depth + 1)) return true;
      continue;
    }
    const lang = Object.hasOwn(INTERPRETERS, e.name) ? e.name : null;
    if (lang) {
      const text = scriptText(cmd, e.args, INTERPRETERS[lang], lang);
      if (text && SCRIPT_DETACHES.test(text)) return true;
    }
  }
  return false;
}

/**
 * The pre-bash decision for `command` run in `cwd`: { code, reason } or null (no decision).
 * Every path is realpath'd before it is judged (`designPath`): the design-root rules see the file
 * the kernel opens — through a symlink, a `..` walk or a case alias — and the out-of-project check
 * (given `root`) catches a symlink in the project that points out of it.
 * `guard(rel)` (optional) judges a runtime `_*` path in a write position: `{code, reason}` denies.
 */
export function classifyBash(command, { cwd, designRoot, root, sessionRoot = null, guard = null }) {
  if (typeof command !== 'string' || !command) return null;
  // Always parsed — no text pre-filter (Phase 2 gate round 3): the shell removes quotes and
  // backslashes and APFS folds case, so `r''m`, `r\m` and `RM` run rm with no `rm` in the text,
  // and a symlink / `..` / `.DESIGN` reaches the root with no `.design` in it (F2). The rules judge
  // the parsed, case-folded names (`nameOf`); the lexer is linear and paths are realpath'd only
  // for a judged word, so the cost is the parse (the budget test in bash-guard.test.mjs).
  const cmds = parseBash(command);
  if (!cmds) return null;
  const human = humanOnlyRoute(cmds) ?? humanOnlyVerb(cmds);
  if (human) return human;
  const out = root ? outOfProject(cmds, { cwd, root }) : null;
  if (out) return out;
  const other = root || sessionRoot ? otherProject(cmds, { cwd, root: sessionRoot ?? root }) : null;
  if (other) return other;
  let designReal = null;
  const realRoot = () => {
    designReal ??= realpathDeep(designRoot);
    return designReal;
  };
  let here = cwd;
  const hit = (code, p) => p.guard ?? { code, reason: MESSAGES[code](p.rel) };
  // a versioned path — or a runtime one the caller's `guard(rel)` refuses (its verdict wins)
  const versioned = (w) => {
    const p = designPath(w, here, realRoot());
    if (!p) return null;
    if (!p.runtime) return p;
    const g = guard?.(p.rel);
    return g ? { ...p, guard: g } : null;
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
    const { name, raw, args } = e;
    if (raw === 'cd' || raw === 'pushd') {
      const to = args.find((a) => !isOpt(a));
      // joined, not resolve()d: `link/..` pops from the link's target (realpathDeep, later)
      here = !to
        ? homedir()
        : !to.literal || here === null
          ? null
          : isAbsolute(to.text)
            ? to.text
            : `${here ?? '/'}${sep}${to.text}`;
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
          const d = args[k + 1];
          gitCwd = !d.literal
            ? null
            : isAbsolute(d.text)
              ? d.text
              : here === null
                ? null
                : `${here ?? '/'}${sep}${d.text}`;
          k += 2;
        } else if (args[k].text === '-c') k += 2;
        else k++;
      }
      // folded too: on APFS git finds `git-RM` in its exec-path as git-rm
      const subName = args[k]?.literal ? args[k].text.toLowerCase() : null;
      const after = args.slice(k + 1);
      const srcs =
        subName === 'rm'
          ? operands(after)
          : subName === 'mv'
            ? operands(after).slice(0, -1)
            : subName === 'checkout'
              ? checkoutPaths(after)
              : subName === 'restore'
                ? restorePaths(after)
                : [];
      if (!srcs.length) continue;
      const gitCode =
        subName === 'rm' ? 'use-trash' : subName === 'mv' ? 'use-verb' : 'not-a-writer';
      const saved = here;
      here = gitCwd;
      for (const a of srcs) {
        const p = versioned(a);
        if (p) {
          here = saved;
          return hit(gitCode, p);
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
              ['rm', 'unlink', 'shred'].includes(nameOf(args[j + 1]?.text ?? ''))))
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
    if (name === 'ln') {
      // BY DESTINATION, like cp — and a HARD link's sources too: it gives a design (or guarded
      // run) file's inode a second name realpath can't see through, so editing that name writes
      // the file unjudged. A symlink is followed by realpath: only its destination counts.
      const t = targetDir(args);
      const symbolic = args.some(
        (a) => a.literal && (a.text === '--symbolic' || /^-[a-zA-Z]*s/.test(a.text))
      );
      const srcs = t || ops.length < 2 ? ops : ops.slice(0, -1);
      // `ln x` (one operand) links ./basename(x)
      const dest =
        t ??
        (ops.length >= 2
          ? ops[ops.length - 1]
          : ops[0]?.literal
            ? { ...ops[0], text: basename(ops[0].text) }
            : null);
      for (const a of [dest, ...(symbolic ? [] : srcs)]) {
        const p = versioned(a);
        if (p) return hit('not-a-writer', p);
      }
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
      // BSD sed's -I is in-place too
      args.some((a) => a.literal && (/^-[nrsuzE]*[iI]/.test(a.text) || /^--in-place/.test(a.text)));
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
      // a .design path the script names, runtime (`.design/_…`) ones excepted unless guarded
      // `.design` in any case (a case alias on APFS); a symlink to the root the script reaches
      // by another name is not seen here — residual, the script is text, not a path
      const all = [...text.matchAll(/\.design(?:\/([^\s'"`),;]*))?/gi)].map((m) => m[1] ?? '');
      const runtime = (after) => {
        const first = after.split('/')[0] ?? '';
        return first.startsWith('_') || first.startsWith('.');
      };
      for (const after of all) {
        const g = runtime(after) && guard ? guard(after.replace(/\/+$/, '')) : null;
        if (g) return g;
      }
      const named = all.filter((after) => !runtime(after));
      const lc = text.toLowerCase();
      if (lc.includes(designRoot.toLowerCase()) || lc.includes(realRoot().toLowerCase()))
        named.push('.');
      if (named.length) return hit('not-a-writer', { rel: named[0] || '.' });
    }
  }
  return null;
}

// ── §9 Q3: a `maude` command's redirected output stays in the project or the temp dir ─────────

const OUT_OPS = new Set(['>', '>>', '>|', '&>', '&>>', '<>', '>&']);
const DEV_SINKS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr']);

const within = (child, dir) => {
  const rel = relative(dir, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

/**
 * The absolute path a redirection / `tee` operand names, or null when the reader can't know it:
 * a literal word (`~` already expanded by the lexer; a relative one against the tracked cwd), or
 * one whose ONLY expansion is a leading `$HOME` / `$TMPDIR` / `${HOME}` / `${TMPDIR}`. Anything
 * else — `$OUT`, `"$DIR/x"`, `$(mktemp)`, `${HOME:-/etc}`, a relative path after `cd $X` — fails
 * OPEN like the rest of the guard (decision v2-2.4b-bash-guard-fail-open-reader).
 */
function outTarget(word, here) {
  if (!word?.text) return null;
  let text;
  if (word.literal && !word.exp) text = word.text;
  else if (!word.literal && word.exp === 1 && word.env) {
    const base = word.env === 'HOME' ? homedir() : process.env.TMPDIR || tmpdir();
    text = base + word.text;
  } else return null;
  // not resolve()d: `link/..` pops from the link's target, and realpathDeep follows it first
  if (isAbsolute(text)) return text;
  return here ? `${here}${sep}${text}` : null;
}

/**
 * Q3 (contract V2-1.11 §9, §5.3): `Bash(maude:*)` is auto-approved, so `maude design … > ~/.zshenv`
 * (or `| tee ~/.zshenv`) would write outside the project unprompted — and `confineOut()` only sees
 * the verb's own `--out` flags. Deny `>` `>>` `>|` `&>` `&>>` `<>` `>&file` (any fd) on a `maude`
 * command, and the operands of a `tee` the maude command feeds in the same pipeline, when the path
 * lands outside the repo root and the OS temp dir (`/tmp` too), symlinks resolved. `/dev/null`,
 * `/dev/stdout`, `/dev/stderr` pass. A non-maude writer (`echo x > /etc/foo`, `echo "$X" > out`
 * after `X=$(maude …)`) is Claude Code's own permission business, not this guard's. An invariant
 * guard, not a permission change: helpers never need it.
 */
function outOfProject(cmds, { cwd, root }) {
  let roots = null;
  const outside = (abs) => {
    if (DEV_SINKS.has(abs)) return false; // written exactly so: never a link game
    roots ??= [...new Set([root, tmpdir(), '/tmp'].map((r) => realpathDeep(r)))];
    const real = realpathDeep(abs);
    return !roots.some((r) => within(real, r));
  };
  const hit = (abs) => ({ code: 'out-of-project', reason: MESSAGES['out-of-project'](abs) });
  let here = cwd;
  let fed = false; // a maude command earlier in this pipeline
  for (const cmd of cmds) {
    if (!cmd.pipeIn) fed = false;
    const e = effective(cmd.words);
    if (e && (e.raw === 'cd' || e.raw === 'pushd')) {
      const to = e.args.find((a) => !isOpt(a));
      here = !to ? homedir() : to.literal ? resolve(here ?? '/', to.text) : null;
      continue;
    }
    if (maudeWords(cmd)) {
      fed = true;
      for (const r of cmd.redirs) {
        if (!OUT_OPS.has(r.op)) continue;
        // `2>&1` / `>&2` / `>&-` duplicate a descriptor, they open no file
        if (r.op === '>&' && r.target?.literal && /^(?:\d+|-)$/.test(r.target.text)) continue;
        const abs = outTarget(r.target, here);
        if (abs && outside(abs)) return hit(abs);
      }
      continue;
    }
    if (fed && e?.name === 'tee') {
      for (const a of operands(e.args)) {
        const abs = outTarget(a, here);
        if (abs && outside(abs)) return hit(abs);
      }
    }
  }
  return null;
}

// ── gate-b-sec2 finding 1: a `maude` command stays on the session's project ──────────────────────

const SESSION_ENV = new Set(SESSION_ENV_KEYS);
// V2-8.9 round 2 R2-L1 — and the web switch's carriers: the bridge sets MAUDE_NO_EGRESS for a web-off
// session and the helpers derive AGENT_BROWSER_* from it (bin/_no-egress.sh).
const isGuardedEnv = (k) =>
  SESSION_ENV.has(k) || k === 'MAUDE_NO_EGRESS' || k.startsWith('AGENT_BROWSER_');
const ENV_SETTERS = new Set(['export', 'unset', 'declare', 'typeset', 'local', 'readonly']);
/** The NAME a `NAME=value` / `NAME+=value` / bare `NAME` word sets, when it is a guarded key. */
const sessionKeyOf = (w) => {
  if (!w?.text) return null;
  const k = /^([A-Za-z_]\w*)(?:\+?=|$)/.exec(w.text)?.[1];
  return k && isGuardedEnv(k) ? k : null;
};

/**
 * Defence in depth behind the dispatcher (confine-root.mjs): the verb's `--root` / `--design-root`
 * (literal words, realpath'd; a `$VAR` fails open like the rest of the guard) must name the
 * session's project `root`, and a call that runs a maude verb never sets, exports or unsets the
 * session env (MAUDE_SESSION_ROOT, MAUDE_AGENT_ACTOR, MAUDE_CHAT_ID, MAUDE_HOOK_SESSION,
 * CLAUDE_PROJECT_DIR) — `X=… maude`, `env -u X maude`, `env -i maude`, `export X=…; maude`.
 */
function otherProject(cmds, { cwd, root }) {
  if (!cmds.some((c) => maudeWords(c))) return null;
  let real = null;
  const project = (abs) => {
    const r = realpathDeep(abs);
    const p = findProjectRoot(r);
    return p ? realpathDeep(p) : r;
  };
  const env = (key) => ({ code: 'out-of-project', reason: MESSAGES['session-env'](key) });
  let here = cwd;
  for (const cmd of cmds) {
    for (const a of cmd.assigns) {
      const k = sessionKeyOf(a);
      if (k) return env(k);
    }
    const head = cmd.words[0];
    if (head?.literal && ENV_SETTERS.has(head.text)) {
      for (const w of cmd.words.slice(1)) {
        const k = sessionKeyOf(w);
        if (k) return env(k);
      }
      continue;
    }
    // the wrapper words before the command: `env -i`, `env -u KEY`, `env KEY=…`
    let k = 0;
    while (
      k < cmd.words.length &&
      cmd.words[k].literal &&
      WRAPPERS.has(nameOf(cmd.words[k].text))
    ) {
      const isEnv = nameOf(cmd.words[k].text) === 'env';
      k++;
      while (k < cmd.words.length && cmd.words[k].literal) {
        const t = cmd.words[k].text;
        if (isEnv && (/^-(?:i|-ignore-environment)$/.test(t) || t === '-'))
          return env('the environment');
        // R2-L1 — any `env -u` before a maude verb: what it removes is the session's to say
        if (isEnv && /^-(?:u.*|-unset(?:=.*)?)$/.test(t))
          return env(sessionKeyOf(cmd.words[k + 1]) ?? 'the environment');
        if (/^-/.test(t)) k++;
        else if (/^[A-Za-z_]\w*=/.test(t)) {
          const key = sessionKeyOf(cmd.words[k]);
          if (key) return env(key);
          k++;
        } else break;
      }
    }
    const e = effective(cmd.words);
    if (e && (e.raw === 'cd' || e.raw === 'pushd')) {
      const to = e.args.find((a) => !isOpt(a));
      here = !to ? homedir() : to.literal ? resolve(here ?? '/', to.text) : null;
      continue;
    }
    const mw = maudeWords(cmd);
    if (!mw) continue;
    real ??= realpathDeep(root);
    const flag = (names) => {
      const out = [];
      for (let i = 0; i < mw.length; i++) {
        const w = mw[i];
        if (!w.literal) continue;
        if (w.text === '--') break;
        for (const f of names) {
          if (w.text === f && mw[i + 1]) out.push(mw[i + 1]);
          else if (w.text.startsWith(`${f}=`)) out.push({ ...w, text: w.text.slice(f.length + 1) });
        }
      }
      return out.filter((v) => v.literal && !v.exp && v.text);
    };
    const roots = flag(ROOT_FLAGS);
    for (const r of roots) {
      const abs = isAbsolute(r.text) ? r.text : here ? `${here}${sep}${r.text}` : null;
      if (abs && project(abs) !== real) {
        return { code: 'out-of-project', reason: MESSAGES['other-project'](`--root ${r.text}`) };
      }
    }
    if (!roots.length && here) {
      // `cd <another project> && maude design …`: the verb takes the cwd's project
      const at = findProjectRoot(realpathDeep(here));
      if (at && realpathDeep(at) !== real) {
        return { code: 'out-of-project', reason: MESSAGES['other-project'](`the folder ${here}`) };
      }
    }
    const base = roots.length ? roots[roots.length - 1].text : root;
    for (const d of flag(DESIGN_ROOT_FLAGS)) {
      const b = isAbsolute(base) ? base : here ? `${here}${sep}${base}` : null;
      const abs = isAbsolute(d.text) ? d.text : b ? `${b}${sep}${d.text}` : null;
      if (abs && !within(realpathDeep(abs), real)) {
        return {
          code: 'out-of-project',
          reason: MESSAGES['other-project'](`--design-root ${d.text}`),
        };
      }
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

/** Non-option args where the options in `takesArg` consume the next word (`--` ends options). */
function pathArgs(args, takesArg) {
  const out = [];
  let opts = true;
  for (let j = 0; j < args.length; j++) {
    const a = args[j];
    if (opts && a.literal && a.text === '--') {
      opts = false;
      continue;
    }
    if (opts && isOpt(a)) {
      if (takesArg.has(a.text)) j++;
      continue;
    }
    out.push(a);
  }
  return out;
}

/**
 * The paths `git checkout` overwrites in the work tree: everything after `--`; else the operands
 * minus a leading ref (an operand whose last segment has no `.`: `main`, `HEAD~1`, `origin/x`).
 * A branch switch (`-b` / `-B` / `--orphan`, or a lone ref) names no path. RESIDUAL: a bare
 * directory or extensionless file with no `--` reads as a ref.
 */
function checkoutPaths(args) {
  const dd = args.findIndex((a) => a.literal && a.text === '--');
  if (dd !== -1) return args.slice(dd + 1);
  if (args.some((a) => a.literal && /^(?:-[bB]|--orphan(?:=.*)?)$/.test(a.text))) return [];
  const ops = operands(args);
  const ref = ops[0] && !(ops[0].literal && basename(ops[0].text).includes('.'));
  return ref ? ops.slice(1) : ops;
}

/** The paths `git restore` writes in the work tree — none for `--staged` without `--worktree`. */
function restorePaths(args) {
  const flag = (re) => args.some((a) => a.literal && re.test(a.text));
  if (flag(/^(?:--staged|-[A-Za-z]*S[A-Za-z]*)$/) && !flag(/^(?:--worktree|-[A-Za-z]*W[A-Za-z]*)$/))
    return [];
  return pathArgs(args, new Set(['-s', '--source']));
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
