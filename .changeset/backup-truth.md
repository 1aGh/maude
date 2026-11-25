---
"@1agh/maude": patch
---

Team server Overview tells the truth about backups. It read the backup state only from memory since the last start, so a server that had backed up to S3 for weeks said "No backup yet" until six hours after every restart. The last backup time, how many are kept and a failing state with its reason now survive a restart and are read from the backup target itself; every backup attempt is a row in Activity.
