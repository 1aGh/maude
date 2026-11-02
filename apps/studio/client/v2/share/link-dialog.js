// client/v2/share/link-dialog.js — S9.19: the two helpers the retired `client/share-dialog.jsx`
// lent to its neighbours (the file deep-link dialog, the source-conflict panel, ⌘K "Copy share
// link"), moved verbatim when the Share sheet replaced that dialog.

import { useEffect, useRef } from 'react';

import { notify } from '../../../notifications.tsx';
import { restoreFocus, trapTab } from '../shell/modal-focus.js';

/** Modal keyboard handling shared by the share and file-link decisions. */
export function useLinkDialogFocus(onClose) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const el = ref.current;
    const controls = () => [
      ...el.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled)'),
    ];
    controls()[0]?.focus();
    const key = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      } else {
        trapTab(event, el); // the shell's one trap (v2/shell/modal-focus.js)
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      restoreFocus(previous); // the opener, or the shell's landmark when it is gone — never BODY
    };
  }, []);
  return ref;
}

export async function copyShareLink(value) {
  try {
    await navigator.clipboard.writeText(value);
    notify({ title: 'Link copied', kind: 'success' });
    return true;
  } catch {
    notify({
      title: 'Could not copy link',
      description: 'Select the address and copy it manually.',
      kind: 'error',
    });
    return false;
  }
}
