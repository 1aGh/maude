// hooks/use-web-socket.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useEffect, useRef } from 'react';

export function useWebSocket({ loadAllComments }) {
  useEffect(() => {
    loadAllComments();
  }, [loadAllComments]);

  // ----- WebSocket -----
  const canvasListChangeRef = useRef(() => {});
  return { canvasListChangeRef };
}
