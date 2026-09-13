## Two traps worth knowing

1. **kgai is append-only — there is no `remove_link`.** A wrong edge cannot be retracted; the only way to drop one is to rebuild the store from scratch. Get the classification right before a bulk run.
2. **A clean re-import rebuilds from FILES, so anything recorded graph-native is lost.** Decisions ingested directly (no `.md` behind them) do not survive a wipe-and-reimport — measured: two such records vanished in a rebuild, leaving exactly `DDRs + logs`. If a decision is worth keeping, give it a `.md`; treat graph-native records as ephemeral.
