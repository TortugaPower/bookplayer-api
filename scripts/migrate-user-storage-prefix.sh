#!/usr/bin/env bash
#
# migrate-user-storage-prefix.sh
#
# One-off, per-user migration of a user's S3 objects from the legacy
# email/relay prefix to the canonical external_id prefix, ahead of flipping
# their `users.storage_uses_external_id` flag.
#
# It is COPY-ONLY and idempotent: originals are left in place (no deletion),
# and re-running skips objects already present at the destination with a
# matching size.
#
# Usage:
#   ./migrate-user-storage-prefix.sh <SOURCE_PREFIX> <DEST_PREFIX> [--apply]
#
# Example (account dan.naulty@gmail.com, id_user 67662):
#   ./migrate-user-storage-prefix.sh \
#     't2cgjtwncj@privaterelay.appleid.com' \
#     '001776.7fe29c55772a4602b70b18b0a82aee88.2147' --apply
#
# Without --apply it runs a dry run (lists what WOULD be copied + parity check).
#
# After it reports OK, flip the flag (NOT done here — DB is separate):
#   UPDATE users SET storage_uses_external_id = true WHERE id_user = <ID>;
# then invalidate the cached config so it takes effect immediately:
#   valkey-cli DEL "${REDIS_ENV}storage_prefix_cfg_<ID>"
#
set -euo pipefail

PROFILE="${AWS_PROFILE:-bookplayer}"
BUCKET="${BOOKPLAYER_BUCKET:-bookplayer-library}"

SRC="${1:?source prefix (e.g. user email) required}"
DST="${2:?destination prefix (external_id) required}"
APPLY="${3:-}"

if [[ "$DST" == *"/"* ]]; then
  echo "ERROR: destination prefix must not contain '/': $DST" >&2
  exit 1
fi
if [[ "$SRC" == *"/"* || -z "$SRC" ]]; then
  echo "ERROR: source prefix must be non-empty and contain no '/': $SRC" >&2
  exit 1
fi

aws_s3() { aws --profile "$PROFILE" "$@"; }

# Both the audio prefix (<prefix>/) and the thumbnail prefix (<prefix>_thumbnail/).
SUFFIXES=("/" "_thumbnail/")

copy_prefix() {
  local src_prefix="$1" dst_prefix="$2"
  local token=""
  local copied=0 skipped=0

  while :; do
    local args=(s3api list-objects-v2 --bucket "$BUCKET" --prefix "$src_prefix" --max-keys 1000)
    [[ -n "$token" ]] && args+=(--starting-token "$token")
    local page
    page="$(aws_s3 "${args[@]}" --output json)"

    local keys
    keys="$(printf '%s' "$page" | python3 -c 'import sys,json;[print(o["Key"]) for o in (json.load(sys.stdin).get("Contents") or [])]')"

    while IFS= read -r key; do
      [[ -z "$key" ]] && continue
      local rel="${key#"$src_prefix"}"
      local dst_key="${dst_prefix}${rel}"
      # Skip if destination already has an object of the same size.
      local src_size dst_size
      src_size="$(aws_s3 s3api head-object --bucket "$BUCKET" --key "$key" --query 'ContentLength' --output text 2>/dev/null || echo "")"
      dst_size="$(aws_s3 s3api head-object --bucket "$BUCKET" --key "$dst_key" --query 'ContentLength' --output text 2>/dev/null || echo "")"
      if [[ -n "$dst_size" && "$dst_size" == "$src_size" ]]; then
        skipped=$((skipped+1)); continue
      fi
      if [[ "$APPLY" == "--apply" ]]; then
        aws_s3 s3api copy-object --bucket "$BUCKET" \
          --copy-source "$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "${BUCKET}/${key}")" \
          --key "$dst_key" >/dev/null
        copied=$((copied+1))
      else
        echo "WOULD COPY: $key -> $dst_key (${src_size} bytes)"
        copied=$((copied+1))
      fi
    done <<< "$keys"

    token="$(printf '%s' "$page" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("NextToken") or "")')"
    [[ -z "$token" ]] && break
  done
  echo "  prefix '$src_prefix': $copied $([[ "$APPLY" == "--apply" ]] && echo copied || echo to-copy), $skipped already present"
}

parity() {
  local prefix="$1"
  aws_s3 s3api list-objects-v2 --bucket "$BUCKET" --prefix "$prefix" \
    --query '[length(Contents), sum(Contents[].Size)]' --output text 2>/dev/null || echo "0	0"
}

echo "Bucket: $BUCKET   Source: '$SRC'   Dest: '$DST'   Mode: $([[ "$APPLY" == "--apply" ]] && echo APPLY || echo DRY-RUN)"
for suf in "${SUFFIXES[@]}"; do
  copy_prefix "${SRC}${suf}" "${DST}${suf}"
done

echo "--- parity (count  bytes) ---"
mismatch=0
for suf in "${SUFFIXES[@]}"; do
  src_parity="$(parity "${SRC}${suf}")"
  dst_parity="$(parity "${DST}${suf}")"
  printf 'source %s%s : %s\n' "$SRC" "$suf" "$src_parity"
  printf 'dest   %s%s : %s\n' "$DST" "$suf" "$dst_parity"
  [[ "$src_parity" != "$dst_parity" ]] && mismatch=1
done

if [[ "$APPLY" == "--apply" ]]; then
  if [[ "$mismatch" -ne 0 ]]; then
    echo "ERROR: source/dest parity mismatch after copy. Do NOT flip the flag." >&2
    exit 1
  fi
  echo "Parity OK. Safe to flip storage_uses_external_id for this user."
else
  echo "Dry run complete. Re-run with --apply to copy, then verify parity before flipping the flag."
fi
