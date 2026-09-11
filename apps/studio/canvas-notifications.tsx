import { createRoot } from 'react-dom/client';
import { type NoticeKind, NotificationHost, notifyCanvasText } from './notifications.tsx';

/** Embedded canvases use the shell's stack. Standalone canvases own one host. */
export function showCanvasToast(message: string, kind: NoticeKind = 'info'): void {
  if (typeof document === 'undefined') return;
  if (window.parent !== window) {
    window.parent.postMessage({ dgn: 'canvas-notice', message, kind }, '*');
    return;
  }
  let host = document.getElementById('maude-canvas-notifications');
  if (!host) {
    host = document.createElement('div');
    host.id = 'maude-canvas-notifications';
    document.body.appendChild(host);
    createRoot(host).render(<NotificationHost />);
  }
  notifyCanvasText(message, kind);
}
