import { createRoot, type Root } from 'react-dom/client';
import {
  dismissCanvasNotices,
  type NoticeKind,
  NotificationHost,
  notifyCanvasText,
} from './notifications.tsx';

let standalone: { host: HTMLElement; root: Root } | null = null;

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
    const root = createRoot(host);
    root.render(<NotificationHost />);
    standalone = { host, root };
  }
  notifyCanvasText(message, kind);
}

/** Unmount the standalone host and drop its canvas notices. A canvas page keeps its host for its
 *  whole life; this is for a test that renders a standalone CanvasShell, so the host (and its Sonner
 *  subscription) does not outlive the test's DOM and render into the next file's. */
export function disposeCanvasToastHost(): void {
  const s = standalone;
  standalone = null;
  try {
    if (s) {
      s.root.unmount();
      s.host.remove();
    }
  } finally {
    dismissCanvasNotices();
  }
}
