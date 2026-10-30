// The "Annotations hidden. Press ⇧P to bring them back." toast (15 an-visibility). It is true only while the layer
// is hidden: whichever path shows the layer again (⇧P, the Show button, the ⌘K row, the canvas's own ⇧P) takes it down.
import { ANNOTATIONS_HIDDEN_TOAST } from '../../annotations/ui/visibility.ts';
import { dismissNotice, notify } from '../../notifications.tsx';

const ID = 'annotations-hidden';

/** "Annotations hidden. Press ⇧P to bring them back." + Show — one toast, whichever path hid them. */
export function notifyAnnotationsHidden(onShow) {
  notify({
    id: ID,
    title: ANNOTATIONS_HIDDEN_TOAST.title,
    action: { label: ANNOTATIONS_HIDDEN_TOAST.action, onClick: onShow },
  });
}

/** The layer became hidden (toast) or visible (toast gone). */
export function syncAnnotationsHiddenToast(visible, onShow) {
  if (visible) dismissNotice(ID);
  else notifyAnnotationsHidden(onShow);
}
