#!/bin/bash
# D5 probe: does the runner have bun/node/playwright chromium, and do the harness modules load?
cd "$(dirname "$0")/../../../../../.." || exit 1
ROOT=$PWD
H=$ROOT/.ai/plans/notes/v2-evidence/phase8-fidelity/_d5-harness-g4
echo "pwd $ROOT"; which bun node; node -v; bun -v
cd "$H" || exit 1
node -e "
import('./lib.mjs').then(async (m) => {
  console.log('REPO', m.REPO, typeof m.stubClaudeEnv);
  const b = await m.playwright.chromium.launch();
  console.log('chromium', b.version());
  await b.close();
}).catch((e) => { console.log('PROBE FAIL', e.message.split('\n')[0]); process.exit(1); });
"
node -e "
import('./img.mjs').then(async (m) => { await m.makeImages([{ path: '$ROOT/.scr/probe.jpg', w: 640, h: 480, kind: 'plasma', seed: 3 }]); console.log('img ok'); });
"
ls -la "$ROOT/.scr/probe.jpg"
