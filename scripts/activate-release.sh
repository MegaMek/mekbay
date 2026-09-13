#!/usr/bin/env bash
# Server entry point: prepare/activate BASE DAYS RELEASE RUN_NUMBER SHA256
# ARCHIVE_BYTES BUILD_BYTES BUILD_ENTRIES, or cleanup BASE DAYS.
set -euo pipefail
umask 022
operation=${1:?Operation required: prepare, activate or cleanup}
base=${2:?Deployment directory required}
retention_days=${3:?Retention days required}
[[ "$base" =~ ^/[a-zA-Z0-9_/-]+$ && "$base" != / && "$base" != */ ]] || { echo 'Invalid deployment directory' >&2; exit 1; }
[[ "$retention_days" =~ ^[1-9][0-9]{0,2}$ && "$retention_days" -le 365 ]] || { echo 'Invalid retention (expected 1-365 days)' >&2; exit 1; }
case "$operation" in
  prepare|activate)
    [[ $# == 9 ]] || { echo 'Expected release identity and build size arguments' >&2; exit 1; }
    release=$4 run_number=$5 checksum=$6 archive_bytes=$7 build_bytes=$8 build_entries=$9
    [[ "$release" =~ ^[a-f0-9]{40}-[1-9][0-9]{0,14}-[1-9][0-9]{0,8}$ && "$checksum" =~ ^[a-f0-9]{64}$ ]] || { echo 'Invalid release identity' >&2; exit 1; }
    for number in "$run_number" "$archive_bytes" "$build_bytes" "$build_entries"; do
      [[ "$number" =~ ^[1-9][0-9]{0,14}$ ]] || { echo 'Invalid run number or build size' >&2; exit 1; }
    done
    attempt=${release##*-}
    ;;
  cleanup) [[ $# == 3 ]] || { echo 'Usage: cleanup BASE DAYS' >&2; exit 1; } ;;
  *) echo 'Expected prepare, activate or cleanup' >&2; exit 1 ;;
esac
[[ "$(readlink -f -- "$base")" == "$base" ]] || { echo 'Deployment directory must be canonical' >&2; exit 1; }
for directory in incoming releases retained-assets; do
  [[ -d "$base/$directory" && ! -L "$base/$directory" ]] || { echo "Missing or symlinked $directory directory" >&2; exit 1; }
done
# This is a kernel lock, not an existence-based lockfile. Keep the file in place:
# unlinking it could let two processes lock different inodes and deploy together.
# Closing all holders releases the lock even after a crash or SIGKILL.
lock_wait=${DEPLOY_LOCK_WAIT_SECONDS:-60}
[[ "$lock_wait" =~ ^[1-9][0-9]{0,2}$ && "$lock_wait" -le 300 ]] || { echo 'Invalid lock wait (expected 1-300 seconds)' >&2; exit 1; }
exec 9> "$base/.deploy.lock"
if ! flock -x -w "$lock_wait" 9; then
  echo "Could not acquire deployment lock within $lock_wait seconds. Check the active deployment or rollback; do not delete .deploy.lock. Current release is unchanged." >&2
  exit 1
fi

load_selected_releases() {
  [[ -L "$base/current" ]] || { echo 'Initialize current before deploying' >&2; exit 1; }
  current=$(readlink -- "$base/current")
  [[ "$current" =~ ^releases/[a-zA-Z0-9_-]+$ && -s "$base/$current/index.html" && ! -L "$base/$current" ]] || { echo 'Unexpected current release' >&2; exit 1; }
  previous=
  if [[ -e "$base/previous" || -L "$base/previous" ]]; then
    [[ -L "$base/previous" ]] || { echo 'previous must be a symlink or absent' >&2; exit 1; }
    previous=$(readlink -- "$base/previous")
    [[ "$previous" =~ ^releases/[a-zA-Z0-9_-]+$ && -s "$base/$previous/index.html" && ! -L "$base/$previous" ]] || { echo 'Unexpected previous release' >&2; exit 1; }
  fi
}
load_selected_releases

cleanup() {
  local cutoff directory name modified upload file relative
  local removed_releases removed_uploads removed_assets
  # Caller holds descriptor 9; preserve the actual current and previous pointers.
  cutoff=$(( $(date +%s) - retention_days * 86400 ))
  removed_releases=0
  removed_uploads=0
  removed_assets=0
  shopt -s nullglob
  for directory in "$base/releases"/*; do
    [[ -d "$directory" && ! -L "$directory" ]] || continue
    name=${directory##*/}
    [[ "$name" =~ ^([a-f0-9]{40}-[0-9]+-[0-9]+|bootstrap)$ ]] || continue
    [[ "$directory" != "$base/$current" && "$directory" != "$base/$previous" ]] || continue
    modified=$(stat -c %Y -- "$directory")
    (( modified < cutoff )) || continue
    rm -rf --one-file-system -- "$directory"
    removed_releases=$((removed_releases + 1))
  done
  
  # Uploads have server receipt timestamps (scp is invoked without -p). The
  # workflow's 30-minute limit is much shorter than the minimum one-day window.
  for upload in "$base/incoming"/*.tgz; do
    [[ -f "$upload" && ! -L "$upload" ]] || continue
    name=${upload##*/}
    [[ "$name" =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+\.tgz$ ]] || continue
    modified=$(stat -c %Y -- "$upload")
    (( modified < cutoff )) || continue
    rm -f -- "$upload"
    removed_uploads=$((removed_uploads + 1))
  done
  
  # Mark relative paths in EVERY retained release, including current, previous,
  # bootstrap and incomplete attempts. Link counts alone are insufficient: an
  # unchanged asset in two builds can have the same name but different inodes.
  # Scan in memory: cleanup must work even when the disk has no spare blocks.
  # Explicitly wait for find so an incomplete inventory cannot delete live assets.
  local -a files=()
  local -A retained_assets=()
  mapfile -d '' -t files < <(find "$base/releases" -type f -printf '%P\0')
  wait "$!"
  for file in "${files[@]}"; do
    retained_assets["${file#*/}"]=1
  done
  mapfile -d '' -t files < <(find "$base/retained-assets" -type f -printf '%P\0')
  wait "$!"
  for relative in "${files[@]}"; do
    [[ -z "${retained_assets[$relative]+present}" ]] || continue
    rm -f -- "$base/retained-assets/$relative"
    removed_assets=$((removed_assets + 1))
  done
  find "$base/retained-assets" -mindepth 1 -depth -type d -empty -delete
  echo "Cleanup ($retention_days days): removed $removed_releases releases, $removed_uploads uploads and $removed_assets unreferenced assets."
}

if [[ "$operation" == cleanup ]]; then
  cleanup
  exit 0
fi

# One workflow per site: new runs increase run_number; retries increase attempt.
# Keep the latest accepted request outside releases so cleanup and rollback
# cannot lower it. Check under the SAME lock used for the release switch.
latest="$base/.latest-deployment"
saved_run=0 saved_attempt=0 saved_release=
if [[ -e "$latest" || -L "$latest" ]]; then
  [[ -f "$latest" && ! -L "$latest" ]] || { echo 'Invalid deployment ordering state' >&2; exit 1; }
  read -r saved_run saved_attempt saved_release extra < "$latest"
  [[ "$saved_run" =~ ^[1-9][0-9]{0,14}$ && "$saved_attempt" =~ ^[1-9][0-9]{0,8}$ && "$saved_release" =~ ^[a-f0-9]{40}-[1-9][0-9]{0,14}-[1-9][0-9]{0,8}$ && -z "$extra" && "${saved_release##*-}" == "$saved_attempt" ]] || { echo 'Invalid deployment ordering state' >&2; exit 1; }
fi
if (( run_number < saved_run || (run_number == saved_run && attempt < saved_attempt) )); then
  echo "Superseded deployment $release (run $run_number/$attempt); latest accepted run is $saved_run/$saved_attempt."
  exit 42
fi
if (( run_number == saved_run && attempt == saved_attempt )) && [[ "$saved_release" != "$release" ]]; then
  echo 'Deployment sequence belongs to a different release' >&2
  exit 1
fi

check_capacity() {
  local needed_bytes available_bytes available_inodes
  # Allow extraction overhead and leave 256 MiB / 1024 inodes for operations.
  needed_bytes=$((build_bytes + build_bytes / 5 + 268435456))
  [[ "$operation" != prepare ]] || needed_bytes=$((needed_bytes + archive_bytes))
  available_bytes=$(df -B1 --output=avail -- "$base" | tail -n 1)
  available_inodes=$(df --output=iavail -- "$base" | tail -n 1)
  available_bytes=${available_bytes//[[:space:]]/}
  available_inodes=${available_inodes//[[:space:]]/}
  [[ "$available_bytes" =~ ^[0-9]{1,18}$ && "$available_inodes" =~ ^[0-9]{1,18}$ ]] || { echo 'Could not determine free disk space/inodes' >&2; exit 1; }
  if (( available_bytes < needed_bytes || available_inodes < build_entries + 1024 )); then
    echo "Insufficient disk capacity for $operation: need $needed_bytes bytes and $((build_entries + 1024)) inodes; available $available_bytes bytes and $available_inodes inodes. Current/previous and unexpired releases are preserved. Add capacity or review retention." >&2
    exit 1
  fi
}

if [[ "$operation" == prepare ]]; then
  cleanup
  check_capacity
  request_file="$base/.latest-deployment-$release"
  trap 'rm -f -- "$request_file"' EXIT
  printf '%s %s %s\n' "$run_number" "$attempt" "$release" > "$request_file"
  mv -Tf -- "$request_file" "$latest"
  echo "Prepared $release (run $run_number/$attempt)."
  exit 0
fi

[[ "$saved_run" == "$run_number" && "$saved_attempt" == "$attempt" && "$saved_release" == "$release" ]] || { echo 'Deployment must pass prepare before activation' >&2; exit 1; }
# Space can change during upload, including due to deployments of other sites.
check_capacity
archive="$base/incoming/$release.tgz"
[[ -f "$archive" && ! -L "$archive" ]] || { echo 'Missing or symlinked release archive' >&2; exit 1; }
printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status
stage="$base/releases/$release"
[[ ! -e "$stage" && ! -L "$stage" ]] || { echo 'Release already exists; rerun the workflow for a new attempt ID' >&2; exit 1; }
mkdir -- "$stage"
if ! tar -xzf "$archive" -C "$stage" --no-same-owner --no-same-permissions; then
  touch -- "$stage"
  exit 1
fi
# tar restores the source directory's mtime. Retention starts on the server,
# including for incomplete releases that fail the checks below.
touch -- "$stage"
# A static release must not contain links to files outside its directory.
[[ -z "$(find "$stage" -type l -print -quit)" ]] || { echo 'Symlinks are not allowed inside releases' >&2; exit 1; }
for file in index.html search.html forcegenerator.html ngsw.json ngsw-worker.js 3rdpartylicenses.txt; do
  [[ -s "$stage/$file" ]] || { echo "Incomplete release: $file" >&2; exit 1; }
done
[[ "$(cat "$stage/release.txt")" == "${release%%-*}" ]] || { echo 'Release marker mismatch' >&2; exit 1; }

# Match the fingerprinted asset location in both Nginx site configs. Stable
# filenames (including sprite manifests and service workers) stay release-local.
asset_pattern='^([^/]+-[A-Za-z0-9_-]{8,}\.(js|css)|(media|fonts)/[^/]+-[A-Za-z0-9_-]{8,}\.(woff2?|ttf|eot|otf)|sprites/[^/]+\.[0-9]+\.[a-f0-9]{16}\.webp)$'
while IFS= read -r -d '' file; do
  relative=${file#"$stage/"}
  [[ "$relative" =~ $asset_pattern ]] || continue
  destination="$base/retained-assets/$relative"
  mkdir -p -- "$(dirname -- "$destination")"
  if [[ -e "$destination" ]]; then
    cmp -s -- "$file" "$destination" || { echo "Fingerprinted asset collision: $relative" >&2; exit 1; }
  else
    # Publish only complete files; hard links also avoid duplicating asset data.
    ln -- "$file" "$destination"
  fi
done < <(find "$stage" -type f -print0)
chmod -R a+rX "$stage"

current_link="$base/.current-$release"
previous_link="$base/.previous-$release"
trap 'rm -f -- "$current_link" "$previous_link"' EXIT
ln -s -- "$current" "$previous_link"
mv -Tf -- "$previous_link" "$base/previous"
ln -s -- "releases/$release" "$current_link"
# Give the outgoing release a full retention window after it stops serving,
# even when its build or last activation happened months ago.
touch -- "$base/$current"
# Rename the symlink itself in the same directory: readers see old or new.
mv -Tf -- "$current_link" "$base/current"
rm -f -- "$archive"
echo "Activated $release; previous is $current"

load_selected_releases
cleanup
