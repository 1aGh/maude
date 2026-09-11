import type { Notice } from './notifications.tsx';

/** Canvas content can send text, never shell actions or executable markup. */
export function acceptCanvasNotice(
  event: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
  expectedOrigin: string,
  activeWindow: Window | null | undefined
): Notice | null {
  if (!activeWindow || event.origin !== expectedOrigin || event.source !== activeWindow)
    return null;
  const data = event.data;
  if (data?.dgn !== 'canvas-notice' || typeof data.message !== 'string' || !data.message.trim())
    return null;
  if (!['info', 'success', 'error', 'warning', 'undo'].includes(data.kind)) return null;
  return { title: data.message.slice(0, 4000), kind: data.kind, group: 'canvas' };
}
