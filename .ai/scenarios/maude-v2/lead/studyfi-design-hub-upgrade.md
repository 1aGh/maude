# design.studyfi.com: manual upgrade to Maude 2.0.0

> Written for 2.0.0; the same steps apply to any later 2.0.x stable tag. Use the newest one (2.0.3 once it is out).
`design.studyfi.com` is a self-hosted workspace hub on AWS (`/opt/maude-hub`, image 1.10.0). It does **not** upgrade by itself, and the 2.0.0 release does not touch it. These are the steps for Michal, run on the host. Nobody else runs them.

## What happens on the first 2.0.0 start
- The hub converts its project to Maude 2 by itself, the first time it starts on the stable 2.0.0 image: format 2, and saving moves to accepted revisions. Nobody presses "Update project".
- **It makes a backup first:** a full generation (documents, project store, checkout) goes to the configured backup target under `v2-convert/`. With no target it goes to `<data dir>/v2-convert/`. The regular schedule never prunes it. If there is nowhere durable to put it, the project is **not** converted, and `/health` says `failed=1, no-durable-backup`.
- **Only once:** a second start converts nothing. An rc or 1.x image never converts.
- **Kill switch:** `CELL_V2_CONVERT=0` in `.env` holds it back. Any value other than `1` or unset also holds it back.
- **2.0 desktops:** until the hub runs 2.0.0, a 2.0 desktop keeps the 2.0-only files (transcripts, DS tokens/components) on the Mac and says so in Sync details, because a 1.x hub refuses them. After the upgrade the hub advertises `file-classes-v2` and those files go up.

## Steps
```bash
ssh <the design.studyfi.com host>
cd /opt/maude-hub

# 0. Look before you change anything
docker compose ps
curl -s https://design.studyfi.com/health | jq '{version, formatVersion, v2Convert}'
grep -E '^(MAUDE_IMAGE_TAG|MAUDE_BACKUP_TARGET|MAUDE_S3_|MAUDE_BACKUP_PREFIX|CELL_V2_CONVERT)' .env

# 1. Prove a backup exists and restores — before the image changes
maude hub backup-owners        # this hub owns its keyspace (no identity conflict)
maude hub restore-drill        # a restore from the newest generation reads back
# and/or a host-level copy of the data volume, e.g. an EBS snapshot of the volume behind /opt/maude-hub

# 2. (optional, recommended) start 2.0.0 with conversion held back first
echo 'CELL_V2_CONVERT=0' >> .env

# 3. Pin the image tag (never `latest`) and restart on 2.0.0
sed -i 's/^MAUDE_IMAGE_TAG=.*/MAUDE_IMAGE_TAG=v2.0.0/' .env   # add the line if it is not there
docker compose pull
docker compose up -d
curl -s https://design.studyfi.com/health | jq '{version, v2Convert}'
# expect version 2.0.0 and v2Convert {"state":"disabled","by":"CELL_V2_CONVERT=0"}
# open the project in Maude 2.0 (desktop and browser) and check it works as before

# 4. Let it convert
sed -i '/^CELL_V2_CONVERT=/d' .env
docker compose up -d --force-recreate hub
docker compose logs hub | grep v2-convert       # [v2-convert] converted=1 skipped=0 failed=0
curl -s https://design.studyfi.com/health | jq .v2Convert
# {"state":"done","converted":1,"skipped":0,"failed":0,...}; after the next restart: skipped=1
```

## If something is wrong
- **`failed=1`:** the project was left exactly as it was. The log line before it names the reason (`no-durable-backup`, `backup: …`, `store-unreadable`). Fix the cause and restart. The next start converts it; a converted project is never touched twice.
- **Hold everything:** put `CELL_V2_CONVERT=0` back, then `docker compose up -d --force-recreate hub`.
- **Back to 1.10.0 before conversion:** set `MAUDE_IMAGE_TAG=v1.10.0`, then `docker compose up -d`. A 1.x hub honours `formatVersion: 2` read-only, so it serves a converted project view-only.
- **Undo a conversion:**
  1. Restore the `v2-convert/backups/<stamp>/` generation (the hub restores generations the way a cold start does).
  2. Set the store back:

     ```bash
     curl -X POST /api/project-format -d '{"formatVersion":1}'
     curl -X POST /api/projects/current/v1/mode -d '{"mode":"legacy"}'
     ```

     Both calls need the admin secret.
  3. Run the hub on v1.10.0.

  See `.ai/release-guide.md` § "Verify the cloud converted every project", which describes the same mechanism for Maude Cloud.
