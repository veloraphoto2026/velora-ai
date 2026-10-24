#!/usr/bin/env bash
# Velora AI: operator-run PostgreSQL backup. Never runs on deploy.
# Requirements: bash, pg_dump matching PostgreSQL major version, sha256sum or shasum.
# Usage (on a trusted computer, NOT in GitHub Actions):
#   export VELORA_BACKUP_DATABASE_URL='postgresql://...'
#   bash scripts/backup-postgres.sh
# Never paste the URL into chat, shell history, or logs.
set -euo pipefail
umask 077
if [[ -z "${VELORA_BACKUP_DATABASE_URL:-}" ]]; then
  echo "Set VELORA_BACKUP_DATABASE_URL privately before running." >&2
  exit 1
fi
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump is required (prefer PostgreSQL 18 client)." >&2
  exit 1
fi
OUT_DIR="${VELORA_BACKUP_DIR:-$HOME/velora-backups}"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$OUT_DIR/velora-$STAMP.dump"
if [[ -e "$OUT" ]]; then echo "Backup already exists; refusing overwrite." >&2; exit 1; fi
TMP="$(mktemp "$OUT_DIR/.velora-$STAMP.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
# Custom archive supports pg_restore --list and selective restore.
# No restore or write operation is performed against the source database.
pg_dump --dbname="$VELORA_BACKUP_DATABASE_URL" --format=custom --no-owner --no-acl --file="$TMP"
pg_restore --list "$TMP" >/dev/null
mv -n "$TMP" "$OUT"
trap - EXIT
chmod 600 "$OUT"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUT_DIR" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256")
elif command -v shasum >/dev/null 2>&1; then
  (cd "$OUT_DIR" && shasum -a 256 "$(basename "$OUT")" > "$(basename "$OUT").sha256")
fi
echo "Backup archive created: $OUT"
echo "IMPORTANT: This only validates archive readability, NOT a test restore."
echo "Copy it to separate encrypted storage and perform a restore into a NEW isolated database."
