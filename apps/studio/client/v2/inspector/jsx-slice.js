// client/v2/inspector/jsx-slice.js — S11.8: "Copy code". The JSX of one element, cut out of the canvas
// source that `/_api/canvas-source` returned, found by its `data-cd-id`.
//
// Why a scanner and not the server: the route hands over the whole file (and only to a role that may
// download it); the shell slices on that answer, so the canvas origin is never asked for source. This is a
// small JSX-aware scanner — not a full parser: it walks strings, template literals, comments, `{…}`
// expressions and nested elements, which is all a canvas file contains. A file it cannot make sense of
// answers `null` and the row says so; it never copies half an element.

const ID_START = /[A-Za-z_$]/;
const ID_PART = /[\w$.:-]/;

/** True when a `<` at `i` opens JSX (not a comparison or a generic): what precedes it decides. */
function jsxStartsAt(src, i) {
  const next = src[i + 1];
  if (next !== '>' && !(next && ID_START.test(next))) return false;
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0) return true;
  const c = src[j];
  if (/[\w$)\]]/.test(c)) {
    // `return <div/>`, `case <x>`: a keyword before it still means JSX
    const m = /(?:^|[^\w$])(return|yield|case|default|else|do|typeof|void|in|of|await)$/.exec(
      src.slice(Math.max(0, j - 8), j + 1)
    );
    return !!m;
  }
  return true; // `( , ? : & | = { > ; [ !` etc.
}

function skipString(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === '\\') j += 2;
    else if (src[j] === q) return j + 1;
    else j++;
  }
  return -1;
}

function skipTemplate(src, i) {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') j += 2;
    else if (c === '`') return j + 1;
    else if (c === '$' && src[j + 1] === '{') {
      j = skipBraces(src, j + 1, null);
      if (j < 0) return -1;
    } else j++;
  }
  return -1;
}

function skipComment(src, i) {
  if (src[i + 1] === '/') {
    const nl = src.indexOf('\n', i);
    return nl < 0 ? src.length : nl + 1;
  }
  const end = src.indexOf('*/', i + 2);
  return end < 0 ? -1 : end + 2;
}

/**
 * `i` is at a `{`. Returns the index after its matching `}`; elements met inside are recorded in `out`.
 */
function skipBraces(src, i, out) {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'") {
      j = skipString(src, j);
    } else if (c === '`') {
      j = skipTemplate(src, j);
    } else if (c === '/' && (src[j + 1] === '/' || src[j + 1] === '*')) {
      j = skipComment(src, j);
    } else if (c === '<' && jsxStartsAt(src, j)) {
      const el = scanElement(src, j, out);
      j = el ? el.end : -1;
    } else if (c === '{') {
      depth++;
      j++;
    } else if (c === '}') {
      depth--;
      j++;
      if (depth === 0) return j;
    } else {
      j++;
    }
    if (j < 0) return -1;
  }
  return -1;
}

/**
 * `i` is at the `<` of an element (or a fragment `<>`). Returns `{ end }` (index after its last `>`), or
 * null when the text is not well formed. Every element passed (itself included) with a literal
 * `data-cd-id` lands in `out`.
 */
function scanElement(src, i, out) {
  let j = i + 1;
  while (j < src.length && ID_PART.test(src[j])) j++; // the tag name (a fragment has none)
  let cdId = null;
  // attributes
  for (;;) {
    while (j < src.length && /\s/.test(src[j])) j++;
    if (j >= src.length) return null;
    const c = src[j];
    if (c === '/' && src[j + 1] === '>') {
      j += 2;
      if (cdId !== null && out) out.push({ id: cdId, start: i, end: j });
      return { end: j };
    }
    if (c === '>') {
      j++;
      break;
    }
    if (c === '{') {
      // {...spread}
      j = skipBraces(src, j, out);
      if (j < 0) return null;
      continue;
    }
    let attr = '';
    while (j < src.length && /[^\s=/>{]/.test(src[j])) attr += src[j++];
    if (!attr) return null;
    while (j < src.length && /\s/.test(src[j])) j++;
    if (src[j] !== '=') continue; // a boolean attribute
    j++;
    while (j < src.length && /\s/.test(src[j])) j++;
    const v = src[j];
    if (v === '"' || v === "'") {
      const end = skipString(src, j);
      if (end < 0) return null;
      if (attr === 'data-cd-id') cdId = src.slice(j + 1, end - 1);
      j = end;
    } else if (v === '{') {
      const end = skipBraces(src, j, out);
      if (end < 0) return null;
      if (attr === 'data-cd-id') {
        const lit = /^\{\s*(["'`])([^"'`$\\]*)\1\s*\}$/.exec(src.slice(j, end));
        if (lit) cdId = lit[2];
      }
      j = end;
    } else if (v === '<') {
      const el = scanElement(src, j, out);
      if (!el) return null;
      j = el.end;
    } else {
      return null;
    }
  }
  // children, up to the matching `</name>`
  for (;;) {
    if (j >= src.length) return null;
    const c = src[j];
    if (c === '{') {
      j = skipBraces(src, j, out);
      if (j < 0) return null;
    } else if (c === '<') {
      if (src[j + 1] === '/') {
        const close = src.indexOf('>', j);
        if (close < 0) return null;
        j = close + 1;
        if (cdId !== null && out) out.push({ id: cdId, start: i, end: j });
        return { end: j };
      }
      const el = scanElement(src, j, out);
      if (!el) return null;
      j = el.end;
    } else {
      j++; // JSX text: apostrophes and quotes are just letters here
    }
  }
}

/** Every element with a literal `data-cd-id`, in the order its opening tag appears in `src`. */
export function elementsWithId(src) {
  const found = [];
  let j = 0;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'") j = skipString(src, j);
    else if (c === '`') j = skipTemplate(src, j);
    else if (c === '/' && (src[j + 1] === '/' || src[j + 1] === '*')) j = skipComment(src, j);
    else if (c === '<' && jsxStartsAt(src, j)) {
      const el = scanElement(src, j, found);
      j = el ? el.end : j + 1;
    } else j++;
    if (j < 0) break;
  }
  return found.sort((a, b) => a.start - b.start);
}

/** Take away the indentation the element's own first line had. */
function dedent(text, indent) {
  if (!indent) return text;
  return text
    .split('\n')
    .map((line, n) => (n > 0 && line.startsWith(indent) ? line.slice(indent.length) : line))
    .join('\n');
}

/**
 * The JSX of the element whose `data-cd-id` is `id` — the `index`-th one when a `.map` repeats it.
 * @returns {string | null}  null when the source has no such element (or cannot be read)
 */
export function elementJsx(source, id, index = 0) {
  if (typeof source !== 'string' || !id) return null;
  const all = elementsWithId(source).filter((e) => e.id === id);
  const hit = all[Number.isInteger(index) && index >= 0 && index < all.length ? index : 0];
  if (!hit) return null;
  const lineStart = source.lastIndexOf('\n', hit.start - 1) + 1;
  const lead = source.slice(lineStart, hit.start);
  const indent = /^\s*$/.test(lead) ? lead : /^\s*/.exec(lead)[0];
  return dedent(source.slice(hit.start, hit.end), indent);
}
