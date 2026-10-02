// feature-studio-file-preview — inline preview for a non-canvas tree row
// (markdown / text / image / video / audio / font). Reuses the existing
// static byte-serving route (no new server endpoint) and the chat panel's
// hand-rolled Markdown renderer — no new dependency.

import { useEffect, useRef, useState } from 'react';
import { Markdown } from './chat-markdown.jsx';

const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024; // 2 MB — beyond this, just show a size note

function basename(p) {
  return p.split('/').pop() || p;
}

// Bidi-override control chars (U+202A-E, U+2066-9) let a crafted filename
// visually disguise its own name/extension (the classic "invoice‮gnp.exe"
// trick) wherever we render a raw path/name as text — strip them before
// display. Doesn't affect matching (previewKind() regexes run on the
// unstripped name), only what a human/AT reads.
export function sanitizeDisplayText(s) {
  return String(s).replace(/[\u202a-\u202e\u2066-\u2069]/g, '');
}

function useFetchedText(url, enabled) {
  const [state, setState] = useState({ loading: true, error: null, text: '', tooLarge: false });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState({ loading: true, error: null, text: '', tooLarge: false });
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const len = Number(r.headers.get('content-length') || 0);
        if (len > TEXT_PREVIEW_MAX_BYTES) {
          if (!cancelled) setState({ loading: false, error: null, text: '', tooLarge: len });
          return;
        }
        const text = await r.text();
        if (!cancelled) setState({ loading: false, error: null, text, tooLarge: false });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err.message || 'Failed to load', text: '', tooLarge: false });
      });
    return () => {
      cancelled = true;
    };
  }, [url, enabled]);
  return state;
}

function TextPreview({ url, name, as }) {
  const { loading, error, text, tooLarge } = useFetchedText(url, true);
  if (loading) return <div className="st-file-preview-status">Loading {name}…</div>;
  if (error) return <div className="st-file-preview-status st-file-preview-error">Couldn't load {name}: {error}</div>;
  if (tooLarge) {
    return (
      <div className="st-file-preview-status">
        {name} is {Math.round(tooLarge / 1024)} KB — too large to preview inline.
      </div>
    );
  }
  if (as === 'markdown') return <div className="st-file-preview-markdown"><Markdown text={text} /></div>;
  return <pre className="st-file-preview-text">{text}</pre>;
}

// CSS-string-literal escape for a value interpolated inside url("...") —
// filenames can contain arbitrary characters (only "/" and NUL are forbidden
// on disk), so an unescaped `"` or `\` could break out of the string and
// inject arbitrary rules into the live app-shell stylesheet (not just the
// sandboxed canvas iframe). family is already alnum/hyphen-only; this covers
// the url() side of the same interpolation.
function cssStringEscape(s) {
  // CSS input-preprocessing (CSS Syntax Module Level 3 §3.3) normalizes CR,
  // CRLF, AND FORM FEED (\f, U+000C) to a single LF before tokenizing, so an
  // unescaped \f terminates a double-quoted string exactly like \r/\n does —
  // strip all three, not just the two obvious ones.
  return String(s).replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\r\n\f]/g, '');
}

function FontPreview({ url, name }) {
  const family = `st-preview-font-${name.replace(/[^a-z0-9]+/gi, '-')}`;
  return (
    <div className="st-file-preview-font">
      <style>{`@font-face { font-family: "${family}"; src: url("${cssStringEscape(url)}"); }`}</style>
      <div className="st-file-preview-font-specimen" style={{ fontFamily: family }}>
        <div className="st-file-preview-font-lg">The quick brown fox</div>
        <div className="st-file-preview-font-md">jumps over the lazy dog</div>
        <div className="st-file-preview-font-sm">ABCDEFGHIJKLM abcdefghijklm 0123456789</div>
      </div>
    </div>
  );
}

// On a cloud workspace an image the tree lists may not be on the cell's disk
// yet: the first request makes the hub fetch it from storage, and while that
// runs the static route answers 503 (retry shortly). An <img> treats that as
// a final failure and shows nothing — so retry with backoff and say what is
// happening, instead of leaving an empty frame.
const IMAGE_RETRY_DELAYS_MS = [1000, 2000, 3000, 4000, 6000, 8000, 10000];

function ImagePreview({ url, name }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState('loading'); // loading | loaded | error
  const timer = useRef(null);
  useEffect(() => {
    setAttempt(0);
    setState('loading');
    return () => clearTimeout(timer.current);
  }, [url]);
  const src = attempt === 0 ? url : `${url}?retry=${attempt}`;
  const onError = () => {
    if (attempt >= IMAGE_RETRY_DELAYS_MS.length) {
      setState('error');
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAttempt((a) => a + 1), IMAGE_RETRY_DELAYS_MS[attempt]);
  };
  const retry = () => {
    setState('loading');
    setAttempt((a) => a + 1);
  };
  return (
    <div className={'st-file-preview-image-wrap is-' + state} aria-busy={state === 'loading'}>
      {state !== 'error' && (
        <img
          key={src}
          src={src}
          alt={`Preview: ${name}`}
          className="st-file-preview-image"
          decoding="async"
          onLoad={() => setState('loaded')}
          onError={onError}
        />
      )}
      {state === 'loading' && (
        <div className="st-file-preview-loading" role="status" aria-live="polite">
          <span className="st-file-preview-spinner" aria-hidden="true" />
          <span>{attempt === 0 ? `Loading ${name}…` : 'Still fetching the photo — the first open of a large file can take a moment…'}</span>
        </div>
      )}
      {state === 'error' && (
        <div className="st-file-preview-loading st-file-preview-error" role="alert">
          <span>Couldn't load {name}.</span>
          <button type="button" className="btn btn--ghost" onClick={retry}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

// Warm the next photo before it is clicked: hovering a row starts the fetch,
// so by the time the click lands the bytes are on their way (or cached).
// One fetch per URL per session, at most two at once.
const prefetched = new Set();
const prefetchQueue = [];
let prefetchInFlight = 0;
function pumpPrefetch() {
  while (prefetchInFlight < 2 && prefetchQueue.length) {
    const u = prefetchQueue.shift();
    prefetchInFlight++;
    const img = new Image();
    img.decoding = 'async';
    const done = () => {
      prefetchInFlight--;
      // A cloud miss answers 503 while it fills — let a later hover try again.
      if (!img.naturalWidth) prefetched.delete(u);
      pumpPrefetch();
    };
    img.onload = done;
    img.onerror = done;
    img.src = u;
  }
}
export function prefetchPreviewImage(path) {
  const u = `/${path}`;
  if (prefetched.has(u)) return;
  prefetched.add(u);
  prefetchQueue.push(u);
  pumpPrefetch();
}

export function FilePreview({ path, kind }) {
  if (!path || !kind) return null;
  const url = `/${path}`;
  const name = sanitizeDisplayText(basename(path));
  return (
    <div className="st-file-preview" data-kind={kind}>
      <h2 className="st-file-preview-header">{sanitizeDisplayText(path)}</h2>
      <div className="st-file-preview-body">
        {kind === 'markdown' && <TextPreview url={url} name={name} as="markdown" />}
        {kind === 'text' && <TextPreview url={url} name={name} as="text" />}
        {kind === 'image' && <ImagePreview url={url} name={name} />}
        {kind === 'video' && <video key={url} src={url} controls className="st-file-preview-media" />}
        {kind === 'audio' && <audio key={url} src={url} controls className="st-file-preview-audio" />}
        {kind === 'font' && <FontPreview url={url} name={name} />}
      </div>
    </div>
  );
}
