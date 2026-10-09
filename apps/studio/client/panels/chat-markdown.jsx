// Compact, XSS-safe markdown renderer for the ACP chat feed (and, since
// feature-studio-file-preview, arbitrary repo .md files previewed in the
// Files tree). Builds React nodes directly (never innerHTML) so neither
// agent output nor untrusted file content can inject markup. Covers the
// subset a coding agent actually emits plus GFM pipe tables (common in repo
// docs): fenced code blocks, headings, bullet + numbered lists, pipe tables,
// bold / italic / inline code, and http(s) links. Anything else falls
// through as plain (pre-wrapped) text. No new dependency.

function safeHref(url) {
  // Only allow http(s) — never javascript:/data:/etc.
  return /^https?:\/\//i.test(url) ? url : null;
}

// Inline tokenizer: `code`, **bold**, *italic*, [text](url).
const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))/g;

function inline(text) {
  const out = [];
  let last = 0;
  let key = 0;
  let m;
  INLINE_RE.lastIndex = 0;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      out.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('**')) {
      out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('*')) {
      out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    } else {
      const link = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(tok);
      const href = link && safeHref(link[2]);
      out.push(
        href ? (
          <a key={key++} href={href} target="_blank" rel="noreferrer noopener">
            {link[1]}
          </a>
        ) : link ? (
          link[1]
        ) : (
          tok
        )
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// GFM pipe tables: a header row, a separator row (---/:---/---:/:---:  per
// column), then zero or more data rows — all lines containing at least one
// unescaped `|`.
const TABLE_ROW_RE = /\|/;
const TABLE_SEP_CELL_RE = /^:?-+:?$/;

function splitTableRow(line) {
  let l = line.trim();
  if (l.startsWith('|')) l = l.slice(1);
  if (l.endsWith('|')) l = l.slice(0, -1);
  // Split on `|` not preceded by `\` (an escaped pipe stays literal in a cell).
  return l.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function tableSeparatorAligns(line) {
  const cells = splitTableRow(line);
  if (!cells.length || !cells.every((c) => TABLE_SEP_CELL_RE.test(c))) return null;
  return cells.map((c) => {
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
}

export function Markdown({ text }) {
  const lines = String(text).split('\n');
  const blocks = [];
  let i = 0;
  let key = 0;

  const isList = (l) => /^\s*[-*]\s/.test(l) || /^\s*\d+\.\s/.test(l);

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    if (line.trimStart().startsWith('```')) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push(
        <pre key={key++} className="chat-code">
          <code>{buf.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Heading → a styled paragraph (chat doesn't want giant h1s).
    if (/^#{1,6}\s/.test(line)) {
      blocks.push(
        <p key={key++} className="chat-md-h">
          {inline(line.replace(/^#{1,6}\s/, ''))}
        </p>
      );
      i++;
      continue;
    }

    // List (consecutive list lines).
    if (isList(line)) {
      const ordered = /^\s*\d+\.\s/.test(line);
      const items = [];
      while (i < lines.length && isList(lines[i])) {
        items.push(
          <li key={items.length}>{inline(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s/, ''))}</li>
        );
        i++;
      }
      blocks.push(
        ordered ? (
          <ol key={key++} className="chat-md-list">
            {items}
          </ol>
        ) : (
          <ul key={key++} className="chat-md-list">
            {items}
          </ul>
        )
      );
      continue;
    }

    // GFM pipe table: header row + a valid separator row immediately after.
    if (TABLE_ROW_RE.test(line) && i + 1 < lines.length) {
      const aligns = tableSeparatorAligns(lines[i + 1]);
      if (aligns) {
        const header = splitTableRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() !== '' && TABLE_ROW_RE.test(lines[i])) {
          rows.push(splitTableRow(lines[i]));
          i++;
        }
        blocks.push(
          <div key={key++} className="chat-md-table-wrap">
            <table className="chat-md-table">
              <thead>
                <tr>
                  {header.map((c, ci) => (
                    <th key={ci} style={aligns[ci] ? { textAlign: aligns[ci] } : undefined}>
                      {inline(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri}>
                    {header.map((_, ci) => (
                      <td key={ci} style={aligns[ci] ? { textAlign: aligns[ci] } : undefined}>
                        {r[ci] !== undefined ? inline(r[ci]) : ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    // Blank line → paragraph separator.
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph: gather consecutive non-special lines.
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trimStart().startsWith('```') &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !isList(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="chat-md-p">
        {inline(buf.join('\n'))}
      </p>
    );
  }

  return <>{blocks}</>;
}
