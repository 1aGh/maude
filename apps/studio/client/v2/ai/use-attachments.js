// client/v2/ai/use-attachments.js — S5.10: one chat's attachment chips (drop · paste · paperclip),
// the folder consent card, and the hand-off to the send.
//
// The send reads `attachmentsRef.current.chips` (the live list) after awaiting `pending` (uploads in
// flight), appends `attachmentBlock(...)`, then calls `attachmentsRef.current.onSent()` — the chips
// left the composer with that message. The ref is ChatPanel's existing paste-chip ref, so one
// object carries every attachment the send needs.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ATTACH_LIMIT_WORDS,
  canPickFolder,
  detachFolder,
  fileKind,
  mediaDuration,
  pickFolder,
  postFolder,
  uploadAttachment,
} from './attach.js';

let seq = 0;
const nextId = () => `att-${Date.now().toString(36)}-${++seq}`;

/** The folder answer → the chip's fields. */
function folderFields(b) {
  return {
    name: b.name,
    root: b.root,
    count: b.count,
    countCapped: !!b.countCapped,
    outsideProject: !!b.outsideProject,
  };
}

export function useAttachments({ chatId, attachmentsRef, fetchImpl }) {
  const [chips, setChips] = useState([]);
  /** The folder waiting on Let AI read / Not now: { chipId, path, root, name, count, outsideProject }. */
  const [consent, setConsent] = useState(null);
  const [notice, setNotice] = useState('');
  const chipsRef = useRef(chips);
  chipsRef.current = chips;
  const doFetch = fetchImpl ?? ((...a) => fetch(...a));

  const patch = useCallback((id, fields) => {
    setChips((list) => list.map((c) => (c.id === id ? { ...c, ...fields } : c)));
  }, []);
  const drop = useCallback((id) => {
    setChips((list) => {
      const gone = list.find((c) => c.id === id);
      if (gone?.thumb) URL.revokeObjectURL(gone.thumb);
      return list.filter((c) => c.id !== id);
    });
  }, []);

  // The send's view of this chat's chips.
  useEffect(() => {
    const ref = attachmentsRef?.current;
    if (!ref) return undefined;
    ref.chips = chipsRef;
    ref.onSent = () => {
      setChips((list) => list.filter((c) => c.state !== 'ready'));
    };
    return () => {
      if (ref.chips === chipsRef) {
        ref.chips = undefined;
        ref.onSent = undefined;
      }
    };
  }, [attachmentsRef]);

  const addFiles = useCallback(
    (files) => {
      const list = Array.from(files || []);
      const refused = [];
      for (const file of list) {
        const kind = fileKind(file);
        if (!kind) {
          refused.push(file.name || 'That file');
          continue;
        }
        const id = nextId();
        const thumb =
          kind === 'image' && typeof URL?.createObjectURL === 'function'
            ? URL.createObjectURL(file)
            : undefined;
        setChips((cur) => [
          ...cur,
          { id, kind, name: file.name || 'Screenshot', state: 'uploading', thumb },
        ]);
        const job = (async () => {
          const [up, duration] = await Promise.all([
            uploadAttachment(file, doFetch),
            kind === 'video' || kind === 'audio' ? mediaDuration(file) : Promise.resolve(0),
          ]);
          if (!up.ok || typeof up.body?.path !== 'string') {
            patch(id, { state: 'error', error: up.body?.message || ATTACH_LIMIT_WORDS });
            return;
          }
          patch(id, {
            state: 'ready',
            kind: up.body.kind || kind,
            type: up.body.type,
            name: up.body.name || file.name,
            path: up.body.path,
            asset: up.body.asset,
            pages: up.body.pages,
            duration: duration || undefined,
          });
        })().catch(() => patch(id, { state: 'error', error: 'That didn’t attach. Try again.' }));
        const pending = attachmentsRef?.current?.pending;
        if (pending) {
          pending.add(job);
          job.finally(() => pending.delete(job));
        }
      }
      setNotice(refused.length ? `${refused[0]}: ${ATTACH_LIMIT_WORDS}` : '');
    },
    [attachmentsRef, doFetch, patch]
  );

  const attachFolderPath = useCallback(
    async (path) => {
      const r = await postFolder(path, chatId, false, doFetch);
      if (!r.ok) {
        setNotice(r.body?.message || 'That folder can’t be attached.');
        return;
      }
      const id = nextId();
      if (r.body.granted) {
        setChips((cur) => [
          ...cur.filter((c) => !(c.kind === 'folder' && c.root === r.body.root)),
          { id, kind: 'folder', state: 'ready', path: r.body.root, ...folderFields(r.body) },
        ]);
        return;
      }
      setChips((cur) => [
        ...cur.filter((c) => !(c.kind === 'folder' && c.root === r.body.root)),
        { id, kind: 'folder', state: 'wait', ...folderFields(r.body) },
      ]);
      setConsent({ chipId: id, path, ...folderFields(r.body) });
    },
    [chatId, doFetch]
  );

  /** Choose a folder… — the Mac's own picker, then the server's verdict. */
  const chooseFolder = useCallback(async () => {
    setNotice('');
    const path = await pickFolder().catch(() => null);
    if (path) await attachFolderPath(path);
  }, [attachFolderPath]);

  /** Let AI read — the only place `consent: true` is sent. */
  const allowFolder = useCallback(async () => {
    const c = consent;
    if (!c) return;
    const r = await postFolder(c.path, chatId, true, doFetch);
    setConsent(null);
    if (!r.ok || !r.body?.granted) {
      setNotice(r.body?.message || 'That folder can’t be attached.');
      return;
    }
    patch(c.chipId, { state: 'ready', path: r.body.root, ...folderFields(r.body) });
  }, [consent, chatId, doFetch, patch]);

  /** A folder dropped on the panel: a drop carries files, never a folder's path. */
  const dropFolderHint = useCallback((name) => {
    setNotice(
      canPickFolder()
        ? `To attach the folder “${name}”, use Choose a folder… in the paperclip menu.`
        : `Folders attach in the Maude app. Drop the files from “${name}” instead.`
    );
  }, []);

  /** Not now — the chip stays, marked, and the ask goes without it. */
  const notNow = useCallback(() => setConsent(null), []);

  const remove = useCallback(
    (id) => {
      const chip = chipsRef.current.find((c) => c.id === id);
      if (chip?.kind === 'folder' && chip.state === 'ready' && chip.root)
        void detachFolder(chip.root, chatId, doFetch).catch(() => {});
      if (consent?.chipId === id) setConsent(null);
      drop(id);
    },
    [chatId, consent, doFetch, drop]
  );

  /** Paste a screenshot (the menu row): the clipboard's first image, through the same door. */
  const pasteScreenshot = useCallback(async () => {
    // p8-sweep-leftovers — a second pick with the same clipboard said nothing (the same line was already up):
    // take the line down first, so the answer is drawn and announced again on every pick
    setNotice('');
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => /^image\/(?:png|jpe?g|gif|webp)$/.test(t));
        if (!type) continue;
        const blob = await it.getType(type);
        const ext = type.split('/')[1] === 'jpeg' ? 'jpg' : type.split('/')[1];
        addFiles([new File([blob], `Screenshot.${ext}`, { type })]);
        return;
      }
      setNotice('There’s no picture on the clipboard. Copy a screenshot, then paste.');
    } catch {
      setNotice('Press ⌘V in the field to paste a screenshot.');
    }
  }, [addFiles]);

  return useMemo(
    () => ({
      chips,
      consent,
      notice,
      canChooseFolder: canPickFolder(),
      addFiles,
      chooseFolder,
      attachFolderPath,
      allowFolder,
      notNow,
      remove,
      pasteScreenshot,
      dropFolderHint,
      dismissNotice: () => setNotice(''),
    }),
    [
      chips,
      consent,
      notice,
      addFiles,
      chooseFolder,
      attachFolderPath,
      allowFolder,
      notNow,
      remove,
      pasteScreenshot,
      dropFolderHint,
    ]
  );
}
