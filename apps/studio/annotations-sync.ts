import type * as Y from 'yjs';

/** Echo identity is transport metadata, never authorization or a durable ACK. */
export const ANNOTATION_WRITE_ID = 'writeId';

export function validAnnotationWriteId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(value);
}

/** Remember authored operations, not previously rendered content (A → B → A). */
export function createAnnotationEchoGuard() {
  const authored = new Map<string, string>();
  return {
    remember(id: string, svg: string) {
      authored.set(id, svg);
      if (authored.size > 64) {
        const oldest = authored.keys().next().value;
        if (oldest !== undefined) authored.delete(oldest);
      }
    },
    forget(id: string) {
      authored.delete(id);
    },
    isOwn(svg: string, id: unknown) {
      return validAnnotationWriteId(id) && authored.get(id) === svg;
    },
  };
}

/** Old clients/importers may change svg without changing its old writeId. */
export function observeAnnotationSnapshots(
  doc: Y.Doc,
  receive: (svg: string, writeId: unknown) => void
): () => void {
  const map = doc.getMap<unknown>('annotations');
  const apply = (event?: Y.YMapEvent<unknown>) => {
    if (event && !event.keysChanged.has('svg') && !event.keysChanged.has(ANNOTATION_WRITE_ID))
      return;
    const svg = map.get('svg');
    if (typeof svg !== 'string' && !event?.keysChanged.has('svg')) return;
    const id =
      !event || event.keysChanged.has(ANNOTATION_WRITE_ID)
        ? map.get(ANNOTATION_WRITE_ID)
        : undefined;
    receive(typeof svg === 'string' ? svg : '', id);
  };
  map.observe(apply);
  apply();
  return () => map.unobserve(apply);
}
