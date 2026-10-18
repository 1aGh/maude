// v2/ai/paste-chips.jsx — pasted path / URL / image → inline chip token helpers (moved from ChatPanel.jsx,
// S5.8; unchanged). S5.10 builds the paperclip and drop on top of these.

// ── pasted-path / URL → inline chip (Claude-Code-style attachment badge) ──
// When the whole clipboard is a single path or URL, we collapse it to a short
// literal token ([image-1] / [file-1] / [link-1]) in the textarea and stash the
// real value in a per-chat map. The token is the actual text the caret sees, so
// the mirror can style it as a chip WITHOUT desyncing (chip text === token text),
// and the adapter expands it back to the real path before sending to Claude.
export const CHIP_RE = /\[(?:image|file|link)-\d+\]/g;
export const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|heic|heif|ico|tiff?)$/i;

// Classify a raw clipboard string. Returns { kind, value } only when the trimmed
// paste is a SINGLE path/URL token (no internal whitespace) — pasting prose that
// merely contains a link is left as a normal paste. Paths with spaces fall through
// (kept as plain text) in this first cut.
export function classifyPaste(raw) {
  const s = (raw || '').trim();
  if (!s || /\s/.test(s)) return null;
  const isUrl = /^(?:https?|ftp):\/\/[^\s]+$/i.test(s);
  const isWinPath = /^[a-zA-Z]:\\[^\s]+$/.test(s);
  const isAnchoredPath = /^(?:~|\.{0,2})\/[^\s]+$/.test(s); // /a, ~/a, ./a, ../a
  const looksLikeFile = s.includes('/') && /\.[a-z0-9]{1,8}$/i.test(s); // folder/file.ext
  if (!isUrl && !isWinPath && !isAnchoredPath && !looksLikeFile) return null;
  const bare = s.split(/[?#]/)[0]; // strip URL query/hash before the extension test
  const kind = IMAGE_EXT_RE.test(bare) ? 'image' : isUrl ? 'link' : 'file';
  return { kind, value: s };
}

// Next free index for a chip kind, scanning existing tokens so deletes renumber
// back down (paste after clearing → [image-1] again, not [image-3]).
export function nextChipIndex(text, kind) {
  const re = new RegExp(`\\[${kind}-(\\d+)\\]`, 'g');
  let max = 0;
  let m;
  while ((m = re.exec(text || ''))) max = Math.max(max, parseInt(m[1], 10));
  return max + 1;
}

// Tokenize a string, wrapping [image|file|link-N] tokens in chip spans. Preserves
// every character verbatim (used both in the mirror overlay and the sent-message
// bubble), so it is safe over the caret-critical mirror.
export function chipNodes(text, keyPrefix = 'chip') {
  const nodes = [];
  let last = 0;
  let m;
  let k = 0;
  CHIP_RE.lastIndex = 0;
  while ((m = CHIP_RE.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(
      <span className="chat-paste-chip" key={`${keyPrefix}-${k++}`}>
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// First image File on the clipboard — a raw screenshot / copied image arrives as
// bytes with no path (files, or items via getAsFile on some engines).
export function clipboardImageFile(cd) {
  const files = cd?.files ? Array.from(cd.files) : [];
  const fromFiles = files.find((f) => f.type && f.type.startsWith('image/'));
  if (fromFiles) return fromFiles;
  const items = cd?.items ? Array.from(cd.items) : [];
  for (const it of items) {
    if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

// Insert `chip` at the textarea caret, keeping the undo stack + assistant-ui's
// controlled value in sync. execCommand is a real user-edit (caret follows); the
// manual splice is the fallback where execCommand('insertText') is unavailable.
export function insertChipAtCaret(ta, chip) {
  if (document.execCommand && document.execCommand('insertText', false, chip)) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? start;
  const next = ta.value.slice(0, start) + chip + ta.value.slice(end);
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  )?.set;
  setter?.call(ta, next);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  const pos = start + chip.length;
  ta.setSelectionRange(pos, pos);
}

// POST raw image bytes to the dev-server, which writes them under the runtime
// _chat/attachments/ and returns the absolute path Claude will Read on send.
export async function uploadChatImage(file) {
  const buf = await file.arrayBuffer();
  const res = await fetch('/_api/acp/attachment', {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: buf,
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return (data && data.path) || null;
}
