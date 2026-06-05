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
  local copied=0 skipped=0

  # The AWS CLI auto-paginates list-objects-v2 across ALL objects when --max-keys
  # is omitted, so we get the complete listing (not just the first 1000). Pull the
  # size straight from the listing to avoid a head-object on every source key.
  # `--output text` is TAB-separated, so spaces in keys are preserved.
  local listing
  listing="$(aws_s3 s3api list-objects-v2 --bucket "$BUCKET" --prefix "$src_prefix" \
    --query 'Contents[].[Key,Size]' --output text 2>/dev/null || true)"

  if [[ -z "$listing" || "$listing" == "None" ]]; then
    echo "  prefix '$src_prefix': nothing to copy"
    return
  fi

  while IFS=$'\t' read -r key src_size; do
    [[ -z "$key" ]] && continue
    local rel="${key#"$src_prefix"}"
    local dst_key="${dst_prefix}${rel}"
    # Idempotent: skip if destination already has an object of the same size.
    local dst_size
    dst_size="$(aws_s3 s3api head-object --bucket "$BUCKET" --key "$dst_key" --query 'ContentLength' --output text 2>/dev/null || echo "")"
    if [[ -n "$dst_size" && "$dst_size" == "$src_size" ]]; then
      skipped=$((skipped+1)); continue
    fi
    if [[ "$APPLY" == "--apply" ]]; then
      # Use the high-level `s3 cp` between two s3:// URIs: it still performs a
      # server-side copy (no download), but lets the SDK encode the object keys.
      # Manual copy-source URL-encoding does not round-trip for keys with
      # combining/mojibake characters and yields NoSuchKey.
      aws_s3 s3 cp "s3://${BUCKET}/${key}" "s3://${BUCKET}/${dst_key}" --only-show-errors
      copied=$((copied+1))
    else
      echo "WOULD COPY: $key -> $dst_key (${src_size} bytes)"
      copied=$((copied+1))
    fi
  done <<< "$listing"

  echo "  prefix '$src_prefix': $copied $([[ "$APPLY" == "--apply" ]] && echo copied || echo to-copy), $skipped already present"
}

parity() {
  local prefix="$1"
  # Aggregate over the FLATTENED projection, not via JMESPath length()/sum():
  # the CLI auto-paginates and applies aggregate functions per page, so
  # length()/sum() would emit one partial total per 1000 objects. A [Key,Size]
  # projection streams every object, which awk then counts/sums to a true total.
  aws_s3 s3api list-objects-v2 --bucket "$BUCKET" --prefix "$prefix" \
    --query 'Contents[].[Key,Size]' --output text 2>/dev/null \
    | awk -F'\t' 'NF>=2 { c++; s += $2 } END { printf "%d\t%d\n", c + 0, s + 0 }'
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
