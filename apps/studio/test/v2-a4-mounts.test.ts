// V2-5 A4 — the host mounts the A4 slices handed to the lead (app.jsx and canvas-shell.tsx are shared
// files no slice could edit). The components are tested in their own files; this pins that the shell
// actually wires them, so a later merge that drops a line is a red test, not a silent dead feature.

import { describe, expect, test } from 'bun:test';

const read = (rel: string) => Bun.file(new URL(`../${rel}`, import.meta.url)).text();

describe('A4 host mounts', () => {
  test('S5.11 — the inspector socket’s ai:runs reaches the run store; the canvas draws the rings', async () => {
    const app = await read('client/app.jsx');
    expect(app).toContain("import { noteAiRuns } from './v2/ai/runs-store.js';");
    expect(app).toMatch(/m\.type === 'ai:runs'\) \{(\s*\/\/[^\n]*)*\s*noteAiRuns\(m\.seq\);/);
    const shell = await read('canvas-shell.tsx');
    expect(shell).toContain(
      "import { ArtboardRingsLayer } from './artboard-activity-overlay.tsx';"
    );
    expect(shell).toMatch(/<ArtboardMarqueeOverlay \/>\s*<ArtboardRingsLayer \/>/);
  });

  test('S3.5 — Present ⌄ › Order and notes… opens the sheet on the active canvas', async () => {
    const app = await read('client/app.jsx');
    expect(app).toContain('const [orderNotesOpen, setOrderNotesOpen] = useState(false);');
    expect(app).toMatch(/<OrderNotesMount\s/);
    const mount = await read('client/v2/present/order-notes-mount.jsx');
    expect(mount).toMatch(/<OrderNotesSheet file=\{path\}/);
    const runner = await read('client/v2/shell/menu-runner.js');
    expect(runner).toContain("'present.order-notes': () => d.setOrderNotesOpen(true),");
    const host = await read('client/v2/shell/share-cluster-host.jsx');
    expect(host).toContain("menuRunner.run('present.order-notes')");
  });

  test('S3.7a — a follow link renders the follower page before the embed check', async () => {
    const app = await read('client/app.jsx');
    expect(app).toContain("import FollowView from './v2/present/follow-view.jsx';");
    expect(app).toContain("import { isFollowLocation } from './v2/present/follow-location.js';");
    expect(app).toMatch(
      /if \(isFollowLocation\(location\)\) root\.render\(<FollowView \/>\);\s*else if \(isEmbedLocation\(location\)\)/
    );
  });

  test('S5.12 — the AI chat gets the role (read-only) and the project name', async () => {
    const app = await read('client/app.jsx');
    const assistant = app.slice(app.indexOf('const renderAssistant = () => ('));
    const panel = assistant.slice(0, assistant.indexOf('/>'));
    expect(panel).toContain('<ChatPanel');
    expect(panel).toContain('readOnly={viewerMode}');
    expect(panel).toMatch(/projectName=\{/);
  });
});
