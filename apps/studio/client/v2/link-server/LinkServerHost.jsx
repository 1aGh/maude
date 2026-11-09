// client/v2/link-server/LinkServerHost.jsx — 2.1.1 T5: where `account.link-server` lands in a project tab.
//
// The registry row (B1, shell/project-account-bus.js `runLinkServer`) dispatches the cancelable
// `maude:link-server` event, detail `{ intent: 'link' | 'sign-in', url? }`. This host takes it
// (`preventDefault()`, so the row does not fall back to Settings › Connections) and opens the one
// "Link your server" dialog, the address prefilled when the event names one. The avatar menu, Settings,
// ⌘K and Diagnostics › Sync all arrive here.

import { useEffect, useMemo, useState } from 'react';

import { useShellStore } from '../../stores/shell-store.jsx';
import { LINK_SERVER_EVENT } from '../shell/project-account-bus.js';
import { projectLinkApi } from './link-server-api.js';
import { LinkServerDialog } from './LinkServerDialog.jsx';

export default function LinkServerHost() {
  const {
    shellCore: { cfg, project },
  } = useShellStore();
  const [open, setOpen] = useState(null); // { url } while the dialog is up
  const api = useMemo(() => projectLinkApi(), []);
  useEffect(() => {
    const on = (e) => {
      e.preventDefault();
      const url = typeof e.detail?.url === 'string' ? e.detail.url : '';
      setOpen({ url });
    };
    window.addEventListener(LINK_SERVER_EVENT, on);
    return () => window.removeEventListener(LINK_SERVER_EVENT, on);
  }, []);
  if (!open) return null;
  return (
    <LinkServerDialog
      // a new request (another url) starts a fresh dialog
      key={open.url}
      api={api}
      project={cfg?.name || project || null}
      initialUrl={open.url}
      onClose={() => setOpen(null)}
    />
  );
}
