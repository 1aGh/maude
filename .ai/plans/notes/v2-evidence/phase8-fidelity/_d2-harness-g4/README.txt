Stage D2 (final re-shoot on the merged tip) harness, G4 (10 Share, 11 Navigation, 12 Import and Assets).
Start from ../_d-harness-g4 (scripts, fixtures fx/fx2, home seed); paths hard-code worktree agent-a88fc0565d3f0bdf8 (REPO in lib.mjs, finish-d2.mjs).
Order that produced the final frames: chain-all.sh (s10 first, by hand) = s10 s10c s10d s11 s11e s11b s11d s11ds strip-shoot home11 s12 s12b s12e, then the retakes:
- s12f (ia-advanced light), s12g (brand steps in a plain browser), s12h (⌘-click photo inspector/steps, ia-placed longer wait)
- s11r / s11r2 (pn-jump; pn-relaunch waits for the toast), s11k (pn-k-across without the trash toast)
- s11b waits lengthened (version view draws late under load), s11ds waits for "Loading canvases" to go, home11 boot wait 14 s.
Deltas vs _d-harness-g4: lib.mjs openPage honours SHOT_CHANNEL; AGENT_BROWSER_SOCKET_DIR=/tmp/abg4 for any run that imports a logo (throwaway HOME made the session socket path too long); the design copy for pn-ds is refreshed from the current tree's .design (system + ui + config.json) into .scr/design-copy/.design; a click now selects the ARTBOARD, so the photo inspector needs a Meta-click.
Use: node .scr/run.mjs .scr/<scenario>.mjs dark,light ; node .scr/mkpairs.mjs <NN-dir> [ids].
Never run a chain that waits on `pgrep -f run.mjs`: other agents' run.mjs processes match and the chain stalls.
