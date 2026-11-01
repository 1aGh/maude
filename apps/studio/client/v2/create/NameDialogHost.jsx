// client/v2/create/NameDialogHost.jsx — R3 (6): the one place "New canvas" and "New brief canvas" ask for a name.
//
// Mounted once in the shell. A door (⌘K, ⌘N, the menu, the Canvases panel's "+", a folder's "+") calls
// `requestNameDialog`; this opens the centered dialog, and only when a name is committed is the file written —
// once, under its final name (a rename afterwards re-keys the slug sidecars, DDR-198). A Can view / Can comment
// session gets the shell's one denial line instead of a dialog.

import { useCallback, useEffect, useState } from 'react';

import { newCanvasDesignSystem } from '../ds/new-canvas-default.js';
import { shellToast } from '../../shell/util.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import { ROLE_DENIAL } from '../shell/use-canvas-mode-lane.js';
import NameDialog from './NameDialog.jsx';
import { NAME_DIALOG_EVENT, NAME_DIALOG_KINDS, takeNameDialogRequest } from './name-dialog-bus.js';
import { createBlankCanvas } from './new-canvas.js';

const GENERIC = /^create failed|network/;
// the server's words for a name in use (api.ts createCanvasNow; S1.23b's near-duplicate says the same)
const TAKEN = /already exists/;

/** The line under the field when the write is refused: the server's reason, else one plain sentence. */
export function nameDialogError(kind, error) {
  if (error && !GENERIC.test(error)) return error;
  return kind === 'brief'
    ? 'Could not make the brief canvas. Nothing was changed.'
    : 'Could not make the canvas. Nothing was changed.';
}

/**
 * @param {{ createBoard: (name: string, opts?: object) => Promise<{ ok: boolean, file?: string, error?: string }>,
 *   moveCanvas?: (file: string, to: string) => Promise<unknown>, dsCfg?: any, viewerMode?: boolean,
 *   denial?: string, toast?: (message: string) => void,
 *   create?: typeof createBlankCanvas }} props
 */
export function NameDialogHost({
  createBoard,
  moveCanvas,
  dsCfg,
  viewerMode = false,
  denial = '',
  toast,
  create = createBlankCanvas,
}) {
  const [req, setReq] = useState(null); // { kind, target } | null
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const take = () => {
      const r = takeNameDialogRequest();
      if (!r) return;
      if (viewerMode) {
        if (denial) toast?.(denial);
        return;
      }
      setError('');
      setBusy(false);
      setReq(r);
    };
    take();
    window.addEventListener(NAME_DIALOG_EVENT, take);
    return () => window.removeEventListener(NAME_DIALOG_EVENT, take);
  }, [viewerMode, denial, toast]);

  const close = useCallback(() => setReq(null), []);

  const submit = useCallback(
    async (name) => {
      if (!req || busy) return;
      setBusy(true);
      setError('');
      const target = req.target ?? null;
      // the untouched default is never a name the person chose: a canvas lets the server pick the free
      // "Untitled canvas N" (C4), a brief (which must be sent a name) takes the next free "Untitled brief N"
      const fallback = NAME_DIALOG_KINDS[req.kind].defaultName;
      const isDefault = name.trim() === fallback;
      let res;
      if (req.kind === 'brief') {
        res = await createBoard(name, {});
        for (let n = 2; isDefault && !res?.ok && TAKEN.test(res?.error ?? '') && n <= 50; n++)
          res = await createBoard(`${fallback} ${n}`, {});
      } else {
        // S10.13 — a canvas made in a folder starts on the system that folder's canvases share
        const designSystem =
          target && (dsCfg?.designSystems?.length ?? 0) > 1
            ? newCanvasDesignSystem({
                folder: target.path,
                canvasDesignSystems: dsCfg.canvasDesignSystems,
                designSystems: dsCfg.designSystems,
                defaultDs: dsCfg.defaultDesignSystem,
                designRel: dsCfg.designRel || '.design',
              })
            : undefined;
        res = await create({ name: isDefault ? undefined : name, sizes: true, designSystem });
        if (res?.ok && target) await moveCanvas?.(res.file, target.path);
      }
      if (res?.ok) {
        setBusy(false);
        setReq(null);
        return;
      }
      setBusy(false);
      setError(nameDialogError(req.kind, res?.error));
    },
    [req, busy, createBoard, moveCanvas, dsCfg, create]
  );

  if (!req) return null;
  const k = NAME_DIALOG_KINDS[req.kind];
  return (
    <NameDialog
      title={k.title}
      label={k.label}
      initial={k.defaultName}
      confirm={k.confirm}
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={close}
    />
  );
}

/** The shell's instance: reads the window's own tree actions, config and role from the store. */
export default function ConnectedNameDialogHost() {
  const {
    shellCore: { cfg, viewerMode },
    tabs: { createBoard, moveCanvasReq },
  } = useShellStore();
  return (
    <NameDialogHost
      createBoard={createBoard}
      moveCanvas={moveCanvasReq}
      dsCfg={cfg}
      viewerMode={!!viewerMode}
      denial={ROLE_DENIAL}
      toast={shellToast}
    />
  );
}
