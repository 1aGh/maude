import { execFileSync } from 'node:child_process';
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// No relative imports: scripts/test/e2e-dist-fresh.test.mjs and share-roles/stand-up.mjs load this under plain node.

const isWord = (c: string | undefined) => !!c && /[A-Za-z0-9_$]/.test(c);

/** React's JSX text rule (cleanJSXElementLiteralChild): the string a run of JSX text renders as. */
function jsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  const out: string[] = [];
  lines.forEach((line, k) => {
    let t = line.replace(/\t/g, ' ');
    if (k > 0) t = t.replace(/^ +/, '');
    if (k < lines.length - 1) t = t.replace(/ +$/, '');
    if (t) out.push(t);
  });
  return out.join(' ');
}

/**
 * A client source as a token stream, for "did this commit change anything but formatting?". Whitespace between code
 * tokens is dropped (kept as one space only between two word tokens, or `+ +` / `- -`); whitespace a reader can see is
 * kept: string, template and regex literals verbatim, comments collapsed to single spaces, JSX text as React renders it.
 * Fail-closed: a region the scan takes for a literal that is not one only makes two equal files compare unequal
 * (the time rule then decides); a literal taken for code is the one thing to avoid, so a quote ends at its line, a
 * template runs to its closing backtick, and a `>` that is not `=>`/`>=`/`>>` opens a JSX text candidate.
 */
export function normalizeClientSource(src: string): string {
  const out: string[] = [];
  const n = src.length;
  let i = 0;
  let ws = false;
  let prev = ''; // last emitted token
  const emit = (tok: string) => {
    const a = prev[prev.length - 1];
    const b = tok[0];
    if (ws && ((isWord(a) && isWord(b)) || ((a === '+' || a === '-') && a === b))) out.push(' ');
    out.push(tok);
    prev = tok;
    ws = false;
  };
  const eol = (from: number) => {
    const k = src.indexOf('\n', from);
    return k < 0 ? n : k;
  };
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) {
      ws = true;
      i++;
    } else if (c === '/' && src[i + 1] === '/') {
      const j = eol(i);
      emit(src.slice(i, j).replace(/\s+/g, ' ').trimEnd());
      out.push('\n');
      prev = '\n';
      i = j;
    } else if (c === '/' && src[i + 1] === '*') {
      const k = src.indexOf('*/', i + 2);
      const j = k < 0 ? n : k + 2;
      emit(src.slice(i, j).replace(/\s+/g, ' '));
      i = j;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      j = Math.min(j + 1, n);
      emit(src.slice(i, j));
      i = j;
    } else if (c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== '`') j += src[j] === '\\' ? 2 : 1;
      j = Math.min(j + 1, n);
      emit(src.slice(i, j));
      i = j;
    } else if (
      c === '/' &&
      (prev === '' || '(,=:[!&|?{};\n'.includes(prev) || /^(return|typeof|case|in|of)$/.test(prev))
    ) {
      let j = i + 1;
      let cls = false;
      while (j < n && src[j] !== '\n' && (cls || src[j] !== '/')) {
        if (src[j] === '\\') j++;
        else if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        j++;
      }
      if (j < n && src[j] === '/') {
        emit(src.slice(i, j + 1));
        i = j + 1;
      } else {
        emit('/');
        i++;
      }
    } else if (
      c === '>' &&
      !'=->'.includes(src[i - 1] ?? '=') &&
      !'=>'.includes(src[i + 1] ?? '')
    ) {
      emit('>');
      i++;
      let j = i;
      while (j < n && src[j] !== '<' && src[j] !== '{') j++;
      const region = src.slice(i, j);
      if (/\S/.test(region) || (region !== '' && !region.includes('\n'))) {
        const t = jsxText(region);
        if (t) emit(t);
      }
      i = j;
      ws = false;
    } else if (isWord(c)) {
      let j = i + 1;
      while (j < n && isWord(src[j])) j++;
      emit(src.slice(i, j));
      i = j;
    } else {
      emit(c);
      i++;
    }
  }
  return out.join('');
}

/**
 * p8-e2e-fix-r12 — a studio the lane starts from the worktree serves `apps/studio/dist/client.bundle.js`. The
 * committed copy can be older than the client source (the test-lane wrapper puts dist back to it after every run),
 * and then the studio shows the old UI: share-roles read "Can comment" for a Can view grant for a whole round.
 *
 * Freshness per file: its last commit time when the working tree holds the committed bytes, its mtime when it has
 * uncommitted changes. mtime alone lies after a checkout (git stamps every file with the checkout time).
 * Returns why the bundle is stale, or null.
 */
export function staleClientDist(studioDir: string): string | null {
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: studioDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  let top: string;
  try {
    // both sides real paths: git answers /private/var/… for a /var/… temp dir
    top = realpathSync(git('rev-parse', '--show-toplevel').trim());
    studioDir = realpathSync(studioDir);
  } catch {
    return null; // not a checkout (an installed package): nothing to compare against
  }
  const dirty = new Set(
    git('status', '--porcelain', '--untracked-files=all', '--', 'client', 'dist/client.bundle.js')
      .split('\n')
      .filter(Boolean)
      .map((l) => l.slice(3).trim())
  );
  const rel = (abs: string) => relative(top, abs).split('\\').join('/');
  const committedAt = (abs: string, ...exclude: string[]) => {
    const t = Number(git('log', '-1', '--format=%ct', '--', abs, ...exclude).trim());
    return Number.isFinite(t) && t > 0 ? t * 1000 : 0;
  };
  const bundle = join(studioDir, 'dist', 'client.bundle.js');
  let bundleAt: number;
  try {
    bundleAt = dirty.has(rel(bundle)) ? statSync(bundle).mtimeMs : committedAt(bundle);
  } catch {
    return 'there is no dist/client.bundle.js';
  }
  // CSS is not an input of client.bundle.js: it is the separate styles.css bundle (build.ts, client/styles/_index.css).
  // A CSS-only commit after the build (1b798abf4's token re-format, 2026-10-28) must not refuse a byte-identical bundle.
  // Markdown under client/ (the v2 contracts) is not an input either (5e836e3af, a contract edit, 2026-10-30).
  let newest = committedAt(
    join(studioDir, 'client'),
    ':(exclude,glob)**/*.css',
    ':(exclude,glob)**/*.md'
  );
  let newestWhat = `the last client commit (${new Date(newest).toISOString()})`;
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') walk(p);
      } else if (dirty.has(rel(p)) && !e.name.endsWith('.css') && !e.name.endsWith('.md')) {
        const m = statSync(p).mtimeMs;
        if (m > newest) {
          newest = m;
          newestWhat = `${rel(p)} (uncommitted, ${new Date(m).toISOString()})`;
        }
      }
    }
  };
  walk(join(studioDir, 'client'));
  if (bundleAt >= newest) return null;
  // A whitespace-only client commit after the bundle's (a biome re-format that re-wraps lines, 5f88d88e5 2026-10-30)
  // rebuilds to the same bytes, so the bundle can never be re-committed after it. Committed client files changed
  // since the bundle's commit whose token streams are equal (normalizeClientSource: whitespace a reader can see —
  // inside string/template/regex literals, comments and JSX text — still counts) do not count; an uncommitted newer
  // client file still does (walk above).
  if (!dirty.has(rel(bundle)) && !newestWhat.includes('uncommitted')) {
    try {
      const since = git('log', '-1', '--format=%H', '--', bundle).trim();
      const changed = git(
        'diff',
        '--name-only',
        since,
        'HEAD',
        '--',
        join(studioDir, 'client'),
        ':(exclude,glob)**/*.css',
        ':(exclude,glob)**/*.md'
      )
        .split('\n')
        .filter(Boolean);
      const squash = (rev: string, file: string) => {
        try {
          return normalizeClientSource(git('show', `${rev}:${file}`));
        } catch {
          return null; // added or deleted on one side
        }
      };
      if (
        changed.every((f) => {
          const a = squash(since, f);
          return a !== null && a === squash('HEAD', f);
        })
      )
        return null;
    } catch {
      // no history to compare against: keep the time rule
    }
  }
  return `dist/client.bundle.js (${new Date(bundleAt).toISOString()}) is older than ${newestWhat}`;
}

/** Refuse to boot a studio from `studioDir` on a stale client bundle — loud, with the fix. */
export function assertFreshClientDist(studioDir: string): void {
  const why = staleClientDist(studioDir);
  if (!why) return;
  throw new Error(
    `[e2e] the client bundle is older than the client source: ${why}.\n` +
      `  A studio started from this tree would serve the old UI. Build it first:\n` +
      `  cd ${studioDir} && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release`
  );
}
