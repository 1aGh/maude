// client/v2/ai/DropOverlay.jsx — S5.10: drag files straight onto the AI chat panel (03 AI Chat
// `ai-attach`). Mounted once inside the panel; it listens on its parent element, so the whole panel is
// the target, and paints "Drop to attach · AI can use it in this chat" only while files are over it.
//
// A dropped FOLDER can't be attached this way — a drop hands over files, never a folder's path — so
// it says to use Choose a folder… instead of guessing.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ImageGlyph } from './AChip.jsx';

const hasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/** Split a drop into files and folders (folders are named, not attached). Pure over a DataTransfer. */
export function splitDrop(dt) {
  const files = [];
  const folders = [];
  const items = Array.from(dt?.items ?? []);
  if (items.length) {
    for (const it of items) {
      if (it.kind !== 'file') continue;
      const entry = typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null;
      if (entry?.isDirectory) {
        folders.push(entry.name);
        continue;
      }
      const f = it.getAsFile();
      if (f) files.push(f);
    }
    return { files, folders };
  }
  return { files: Array.from(dt?.files ?? []), folders };
}

export function DropOverlay({ attach, disabled = false }) {
  const anchor = useRef(null);
  const [over, setOver] = useState(false);
  // 03 `ai-attach`: the veil covers the thread only — the composer and the chips under it stay visible
  const [foot, setFoot] = useState(0);
  const attachRef = useRef(attach);
  attachRef.current = attach;

  useLayoutEffect(() => {
    if (!over) return;
    const host = anchor.current?.parentElement;
    const composer = host?.querySelector('[data-testid="chat-composer"]');
    if (!host || !composer) return setFoot(0);
    setFoot(
      Math.max(
        0,
        Math.round(host.getBoundingClientRect().bottom - composer.getBoundingClientRect().top)
      )
    );
  }, [over]);

  useEffect(() => {
    const host = anchor.current?.parentElement;
    if (!host || disabled) return undefined;
    let depth = 0;
    const enter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setOver(true);
    };
    const overFn = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const { files, folders } = splitDrop(e.dataTransfer);
      if (files.length) attachRef.current?.addFiles(files);
      if (folders.length) attachRef.current?.dropFolderHint?.(folders[0]);
    };
    host.addEventListener('dragenter', enter);
    host.addEventListener('dragover', overFn);
    host.addEventListener('dragleave', leave);
    host.addEventListener('drop', drop);
    return () => {
      host.removeEventListener('dragenter', enter);
      host.removeEventListener('dragover', overFn);
      host.removeEventListener('dragleave', leave);
      host.removeEventListener('drop', drop);
    };
  }, [disabled]);

  return (
    <>
      <span ref={anchor} hidden />
      {over ? (
        <span
          className="ai-drop"
          data-testid="ai-attach-drop"
          aria-hidden="true"
          style={foot ? { bottom: foot + 8 } : undefined}
        >
          <ImageGlyph />
          <strong>Drop to attach</strong>
          <span>AI can use it in this chat</span>
        </span>
      ) : null}
    </>
  );
}
