// use-tree-drag.js — feature-file-tree-drag-drop-folders (Task 8).
//
// Drag source/target bookkeeping for the file tree's HTML5 drag & drop layer:
// which canvas row is being dragged, which folder row is currently hovered
// (for the highlight + spring-load-open), and a small timer for the
// spring-load itself. Kept out of Tree/DirRow/CanvasRow so those components
// stay about rendering, not drag bookkeeping.
//
// Payload MIME is a custom `application/x-maude-canvas` (not `text/plain` or
// `Files`) so an OS file drag can't be mistaken for a tree-row drag, and the
// existing canvas-side media-drop path (use-canvas-media-drop.tsx) — which
// only reacts to real `DataTransfer.files` — stays unaffected.

import { useCallback, useMemo, useRef, useState } from 'react';

export const TREE_DRAG_MIME = 'application/x-maude-canvas';
const SPRING_LOAD_MS = 600;

/**
 * `onMove(fromPath, toDir)` — async, called on a valid drop. The caller owns
 * the actual fetch + tree refresh; this hook only tracks UI state and decides
 * when a drop is valid.
 */
export function useTreeDrag(onMove) {
  const [draggedPath, setDraggedPath] = useState(null);
  const [overDir, setOverDir] = useState(null);
  const [busyPath, setBusyPath] = useState(null);
  const springTimer = useRef(null);

  const clearSpring = useCallback(() => {
    if (springTimer.current) {
      clearTimeout(springTimer.current);
      springTimer.current = null;
    }
  }, []);

  const dragProps = useMemo(
    () => (path, draggable) => {
      if (!draggable) return {};
      return {
        draggable: true,
        onDragStart: (e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData(TREE_DRAG_MIME, path);
          // A lightweight ghost — the browser default drag image for a
          // <button> row is poor (grabs the whole row incl. badges).
          const ghost = document.createElement('div');
          ghost.textContent = path.split('/').pop();
          ghost.style.cssText =
            'position:fixed;top:-1000px;left:-1000px;padding:4px 10px;' +
            'background:var(--bg-2);color:var(--fg-1);border-radius:6px;' +
            'font:12px system-ui;pointer-events:none;';
          document.body.appendChild(ghost);
          e.dataTransfer.setDragImage(ghost, 8, 8);
          setTimeout(() => ghost.remove(), 0);
          setDraggedPath(path);
        },
        onDragEnd: () => {
          setDraggedPath(null);
          setOverDir(null);
          clearSpring();
        },
      };
    },
    [clearSpring]
  );

  /** `dirPath` is the drop target's full path; `openIfClosed` spring-loads it
   *  open after hovering. `valid` gates whether this target accepts drops at
   *  all (e.g. false for the design-system group). */
  const dropProps = useMemo(
    () => (dirPath, valid, openIfClosed) => {
      if (!valid) return {};
      return {
        onDragOver: (e) => {
          if (!e.dataTransfer.types.includes(TREE_DRAG_MIME)) return;
          // Only preventDefault on a valid target — the cursor itself then
          // communicates validity (no-drop glyph elsewhere).
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (overDir !== dirPath) {
            setOverDir(dirPath);
            clearSpring();
            if (openIfClosed) {
              springTimer.current = setTimeout(() => {
                openIfClosed();
                springTimer.current = null;
              }, SPRING_LOAD_MS);
            }
          }
        },
        onDragLeave: (e) => {
          // Ignore bubbled leave events from child elements re-entering.
          if (e.currentTarget.contains(e.relatedTarget)) return;
          if (overDir === dirPath) setOverDir(null);
          clearSpring();
        },
        onDrop: async (e) => {
          e.preventDefault();
          clearSpring();
          setOverDir(null);
          const fromPath = e.dataTransfer.getData(TREE_DRAG_MIME);
          setDraggedPath(null);
          if (!fromPath || fromPath === dirPath) return;
          // S1.2 — dropped on the folder it already sits in: nothing to move (the server would refuse it)
          if (fromPath.slice(0, fromPath.lastIndexOf('/')) === dirPath) return;
          setBusyPath(fromPath);
          try {
            await onMove(fromPath, dirPath);
          } finally {
            setBusyPath(null);
          }
        },
      };
    },
    [overDir, clearSpring, onMove]
  );

  // `move` — the raw callback, for the Task 9 keyboard path ("Move to…"),
  // which doesn't go through a drop event at all.
  return { draggedPath, overDir, busyPath, dragProps, dropProps, move: onMove };
}
