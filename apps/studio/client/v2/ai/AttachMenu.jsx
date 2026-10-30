// client/v2/ai/AttachMenu.jsx — S5.10: the paperclip in the prompt row and its one short menu
// (03 AI Chat `ai-attach-menu`): Attach files… · Choose a folder… · From Assets · Paste a screenshot ⌘V,
// then the disabled reminder "Or drag files here". Attach files… and Choose a folder… open the Mac's
// own picker; From Assets opens the left panel's Assets tab.
//
// Choose a folder… needs the desktop app's picker (a browser can't hand over a folder's path), so in a
// browser tab the row is absent — and the server would refuse a made-up path anyway (rule 12).

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Clip, FileGlyph, FolderGlyph, ImageGlyph } from './AChip.jsx';

/** Asks the shell to open the Assets tab (app.jsx listens; lead patch). */
export const OPEN_ASSETS_EVENT = 'maude:ai-attach-assets';

const Fit = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" />
  </svg>
);
const Insert = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
  </svg>
);

/** The menu's rows for this shell — pure, so the order and the browser rule are testable. */
export function attachMenuItems({ canChooseFolder }) {
  return [
    { id: 'ai.attach-files', label: 'Attach files…', icon: 'file' },
    ...(canChooseFolder
      ? [{ id: 'ai.attach-folder', label: 'Choose a folder…', icon: 'folder' }]
      : []),
    { id: 'ai.attach-assets', label: 'From Assets', icon: 'image' },
    { id: 'ai.attach-screenshot', label: 'Paste a screenshot', icon: 'fit', keys: '⌘V' },
    'sep',
    { id: 'drag', label: 'Or drag files here', icon: 'insert', disabled: true },
  ];
}

const ICONS = { file: FileGlyph, folder: FolderGlyph, image: ImageGlyph, fit: Fit, insert: Insert };

export function AttachMenu({ attach, disabled = false }) {
  const [open, setOpen] = useState(false);
  // `.chat-box` clips its content (overflow: hidden, for the focus ring), so the menu is FIXED and
  // placed from the paperclip's own rect — the same escape ChatFootInfo uses (Composer.jsx).
  const [place, setPlace] = useState(null);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const inputRef = useRef(null);
  const menuId = useId();

  const close = useCallback((refocus) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) close(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    rootRef.current
      ?.querySelector('[role="menuitem"]:not([aria-disabled="true"])')
      ?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);

  const onMenuKey = (e) => {
    const rows = [
      ...(rootRef.current?.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])') ?? []),
    ];
    const at = rows.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      rows[(at + d + rows.length) % rows.length]?.focus();
    }
  };

  const run = (id) => {
    close(false);
    if (id === 'ai.attach-files') inputRef.current?.click();
    else if (id === 'ai.attach-folder') void attach.chooseFolder();
    else if (id === 'ai.attach-assets') window.dispatchEvent(new CustomEvent(OPEN_ASSETS_EVENT));
    else if (id === 'ai.attach-screenshot') void attach.pasteScreenshot();
  };

  const items = attachMenuItems({ canChooseFolder: attach.canChooseFolder });

  return (
    <div ref={rootRef} className="ai-clip-wrap">
      <button
        ref={btnRef}
        type="button"
        className={`icon-btn ai-clip${open ? ' is-pressed' : ''}`}
        title="Attach"
        aria-label="Attach"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => {
          // Anchored to the FIELD (03 draws the menu flush to the composer's left, 8 px over its top), not the
          // paperclip: the clip sits inside the field's padding, which made the menu float detached.
          const r = btnRef.current?.getBoundingClientRect();
          const f = btnRef.current?.closest('.chat-box, .chat-input-wrap')?.getBoundingClientRect();
          const a = f && f.width > 0 ? f : r;
          if (a) setPlace({ left: a.left, bottom: window.innerHeight - a.top + 8 });
          setOpen((v) => !v);
        }}
        data-testid="ai-attach-clip"
      >
        <Clip size={16} />
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept="image/png,image/jpeg,image/gif,image/webp,video/*,audio/*,application/pdf"
        onChange={(e) => {
          attach.addFiles(e.currentTarget.files);
          e.currentTarget.value = '';
        }}
        data-testid="ai-attach-input"
      />
      {open ? (
        <div
          id={menuId}
          className="ai-am-menu"
          style={place ? { position: 'fixed', left: place.left, bottom: place.bottom } : undefined}
          role="menu"
          aria-label="Attach"
          onKeyDown={onMenuKey}
          data-testid="ai-attach-menu"
        >
          {items.map((it, i) => {
            if (it === 'sep') return <hr key={`sep-${i}`} className="ai-scope-sep" />;
            const Ic = ICONS[it.icon];
            return (
              <button
                key={it.id}
                type="button"
                role="menuitem"
                className="ai-scope-item ai-am-item"
                aria-disabled={it.disabled || undefined}
                tabIndex={it.disabled ? -1 : 0}
                onClick={it.disabled ? undefined : () => run(it.id)}
                data-testid={`ai-attach-menu-${it.id.replace(/^ai\.attach-/, '')}`}
              >
                <span className="ai-am-ic">{Ic ? <Ic /> : null}</span>
                <span className="ai-scope-item-text">{it.label}</span>
                {it.keys ? <kbd className="ai-am-keys">{it.keys}</kbd> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
