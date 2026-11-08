// client/v2/shell/api-session-boot.js — side-effect module, imported FIRST by app.jsx so the fetch
// wrapper is in place before any other module evaluates (sec-loopback-bearer §7.4). A no-op
// outside a project tab of the desktop app.
import { installApiSession } from './api-session.js';

installApiSession();
