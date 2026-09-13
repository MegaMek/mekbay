#!/usr/bin/env bash
# Integration tests use real Linux files, archives, locks and symlink renames.
set -euo pipefail
timeout_command=
for candidate in timeout gnutimeout; do
  if "$candidate" --version 2>/dev/null | grep -q 'GNU coreutils'; then
    timeout_command=$candidate
    break
  fi
done
[[ -n "$timeout_command" ]] || { echo 'Tests require GNU timeout (GNU coreutils or Ubuntu gnu-coreutils).' >&2; exit 1; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
work=$(mktemp -d /tmp/mekbay-release-XXXXXXXX)
trap 'if [[ -n "${holder_pid:-}" ]]; then kill -TERM "$holder_pid" 2>/dev/null || true; wait "$holder_pid" 2>/dev/null || true; fi; rm -rf -- "$work"' EXIT
base="$work/site"
mkdir -p "$base/incoming" "$base/releases/bootstrap" "$base/retained-assets" "$work/build/sprites"
printf 'bootstrap\n' > "$base/releases/bootstrap/index.html"
ln -s releases/bootstrap "$base/current"
# A leftover lock file is harmless; only a live kernel lock can block us.
printf 'leftover file from an earlier run\n' > "$base/.deploy.lock"
lock_inode=$(stat -c %i "$base/.deploy.lock")
sha=1111111111111111111111111111111111111111
retention_days=1
for file in index.html search.html forcegenerator.html ngsw.json ngsw-worker.js 3rdpartylicenses.txt; do
  printf 'fixture %s\n' "$file" > "$work/build/$file"
done
printf '%s\n' "$sha" > "$work/build/release.txt"
printf 'old chunk\n' > "$work/build/chunk-AAAAAAAA.js"
printf 'sprite\n' > "$work/build/sprites/battle armor.1.0123456789abcdef.webp"
printf 'manifest\n' > "$work/build/sprites/unit-icons.json"

pack() {
  release="$sha-$1-${2:-1}"
  run_number=$1
  tar -czf "$base/incoming/$release.tgz" -C "$work/build" .
  checksum=$(sha256sum "$base/incoming/$release.tgz")
  checksum=${checksum%% *}
  archive_bytes=$(stat -c %s "$base/incoming/$release.tgz")
  build_bytes=$(du -s -B1 "$work/build")
  build_bytes=${build_bytes%%[[:space:]]*}
  build_entries=$(find "$work/build" -printf '.\n' | wc -l)
  build_entries=${build_entries//[[:space:]]/}
}
run_server() { bash "$script_dir/activate-release.sh" "$1" "$base" "$retention_days" "$release" "$run_number" "$checksum" "$archive_bytes" "$build_bytes" "$build_entries"; }
prepare() { run_server prepare; }
activate_prepared() { run_server activate; }
activate() { prepare && activate_prepared; }
cleanup() { bash "$script_dir/activate-release.sh" cleanup "$base" "$retention_days"; }
expect_failure() {
  local before previous_before
  before=$(readlink "$base/current")
  previous_before=$(readlink "$base/previous")
  if activate > "$work/failure.log" 2>&1; then
    echo 'Expected activation to fail' >&2
    exit 1
  fi
  [[ "$(readlink "$base/current")" == "$before" ]]
  [[ "$(readlink "$base/previous")" == "$previous_before" ]]
}

pack 1
activate
first="releases/$release"
[[ "$(readlink "$base/current")" == "$first" ]]
[[ "$(readlink "$base/previous")" == releases/bootstrap ]]
[[ -s "$base/retained-assets/chunk-AAAAAAAA.js" ]]
[[ -s "$base/retained-assets/sprites/battle armor.1.0123456789abcdef.webp" ]]
[[ ! -e "$base/retained-assets/index.html" && ! -e "$base/retained-assets/ngsw.json" && ! -e "$base/retained-assets/sprites/unit-icons.json" ]]

mv "$work/build/chunk-AAAAAAAA.js" "$work/build/chunk-BBBBBBBB.js"
printf 'new index\n' > "$work/build/index.html"
pack 2
activate
second="releases/$release"
[[ "$(readlink "$base/current")" == "$second" ]]
[[ "$(readlink "$base/previous")" == "$first" ]]
[[ -s "$base/retained-assets/chunk-AAAAAAAA.js" && -s "$base/retained-assets/chunk-BBBBBBBB.js" ]]
[[ ! -e "$base/current/chunk-AAAAAAAA.js" ]]

# Corrupt transport and incomplete builds must not switch either pointer.
pack 3
printf 'corruption' >> "$base/incoming/$release.tgz"
expect_failure
mv "$work/build/ngsw.json" "$work/ngsw.json"
pack 4
expect_failure
mv "$work/ngsw.json" "$work/build/ngsw.json"

# A hash-named file may never replace different bytes from an older release.
printf 'collision\n' > "$work/build/chunk-BBBBBBBB.js"
pack 5
expect_failure
[[ "$(cat "$base/retained-assets/chunk-BBBBBBBB.js")" == 'old chunk' ]]
printf 'old chunk\n' > "$work/build/chunk-BBBBBBBB.js"

# A valid archive with the wrong commit marker is also rejected.
printf 'wrong commit\n' > "$work/build/release.txt"
pack 6
expect_failure
printf '%s\n' "$sha" > "$work/build/release.txt"

# Server-side locking prevents activation while another operator holds the lock.
pack 7
exec 8> "$base/.deploy.lock"
flock -x 8
activate 8>&- > "$work/locked.log" 2>&1 &
activation_pid=$!
sleep 0.2
kill -0 "$activation_pid"
[[ "$(readlink "$base/current")" == "$second" ]]
flock -u 8
exec 8>&-
wait "$activation_pid"
[[ "$(readlink "$base/current")" == "releases/$release" ]]

# The operator's rollback subshell must not leave the terminal holding a lock.
(
exec 9> "$base/.deploy.lock"
flock -x -w 1 9
ln -s -- "$(readlink "$base/previous")" "$base/.rollback-current"
touch -- "$base/$(readlink "$base/current")"
mv -Tf -- "$base/.rollback-current" "$base/current"
)
flock -n "$base/.deploy.lock" true
[[ "$(readlink "$base/current")" == "$second" ]]
[[ "$(cat "$base/current/index.html")" == 'new index' ]]

# A live holder causes a bounded failure, without bypassing its lock or switching.
pack 8
exec 8> "$base/.deploy.lock"
flock -x 8
started=$SECONDS
DEPLOY_LOCK_WAIT_SECONDS=1 expect_failure
[[ $((SECONDS - started)) -le 5 ]]
grep -Fq 'Could not acquire deployment lock within 1 seconds' "$work/failure.log"
if flock -n "$base/.deploy.lock" true; then
  echo 'Busy lock was bypassed' >&2
  exit 1
fi
flock -u 8
exec 8>&-
activate

wait_for_holder() {
  for attempt in {1..100}; do
    [[ ! -f "$work/holder-ready" ]] || return 0
    sleep 0.02
  done
  echo 'Lock holder did not become ready' >&2
  return 1
}

# Abrupt termination cannot leave an existence-based stale lock behind. The
# holder uses exec so the signaled PID owns the descriptor without a child.
for signal in TERM KILL; do
  rm -f "$work/holder-ready"
  bash -c 'exec 9> "$1"; flock -x 9; touch "$2"; exec sleep 30' bash "$base/.deploy.lock" "$work/holder-ready" &
  holder_pid=$!
  wait_for_holder
  kill -"$signal" "$holder_pid"
  wait "$holder_pid" 2>/dev/null || true
  holder_pid=
  [[ -f "$base/.deploy.lock" ]]
  flock -n "$base/.deploy.lock" true
done

# The remote deadline must terminate descendants too: they inherit descriptor 9.
# Use a short deadline and TERM-resistant shell/child to exercise forced cleanup.
rm -f "$work/holder-ready"
"$timeout_command" --signal=TERM --kill-after=1s 1s bash -c 'exec 9> "$1"; flock -x 9; trap "" TERM; touch "$2"; sleep 30 & wait' bash "$base/.deploy.lock" "$work/holder-ready" > "$work/timeout.log" 2>&1 &
holder_pid=$!
wait_for_holder
status=0
wait "$holder_pid" 2>/dev/null || status=$?
holder_pid=
[[ "$status" == 137 ]]
flock -w 1 "$base/.deploy.lock" true
[[ "$(stat -c %i "$base/.deploy.lock")" == "$lock_inode" ]]
pack 9
activate
[[ "$(readlink "$base/current")" == "releases/$release" ]]

# Retention uses server-side release ages, never the source files' mtimes.
# Exercise both policies, distinct inodes for identical retained assets, and
# failures/abandoned uploads alongside current and rollback protection.
for retention_days in 1 30; do
  base="$work/retention-$retention_days"
  recent="$sha-100-1"
  expired="$sha-101-1"
  ten_days_old="$sha-102-1"
  mkdir -p "$base/incoming" "$base/retained-assets/sprites" "$base/releases/bootstrap" \
    "$base/releases/$recent" "$base/releases/$expired" "$base/releases/$ten_days_old"
  printf 'long-running live site\n' > "$base/releases/bootstrap/index.html"
  printf 'protected chunk\n' > "$base/releases/bootstrap/chunk-PROTECT1.js"
  cp "$base/releases/bootstrap/chunk-PROTECT1.js" "$base/retained-assets/chunk-PROTECT1.js"
  touch -d '90 days ago' "$base/releases/bootstrap" "$base/retained-assets/chunk-PROTECT1.js"
  ln -s releases/bootstrap "$base/current"

  printf 'recent release\n' > "$base/releases/$recent/index.html"
  printf 'same chunk\n' > "$base/releases/$recent/chunk-RETAIN01.js"
  printf 'same chunk\n' > "$base/releases/$expired/chunk-RETAIN01.js"
  ln "$base/releases/$expired/chunk-RETAIN01.js" "$base/retained-assets/chunk-RETAIN01.js"
  [[ "$(stat -c %i "$base/releases/$recent/chunk-RETAIN01.js")" != "$(stat -c %i "$base/retained-assets/chunk-RETAIN01.js")" ]]
  printf 'expired chunk\n' > "$base/releases/$expired/chunk-EXPIRED1.js"
  ln "$base/releases/$expired/chunk-EXPIRED1.js" "$base/retained-assets/chunk-EXPIRED1.js"
  printf 'ten-day-old release\n' > "$base/releases/$ten_days_old/index.html"
  printf 'ten-day-old chunk\n' > "$base/releases/$ten_days_old/chunk-TENDAYS1.js"
  ln "$base/releases/$ten_days_old/chunk-TENDAYS1.js" "$base/retained-assets/chunk-TENDAYS1.js"
  printf 'orphan sprite\n' > "$base/retained-assets/sprites/old unit.1.0123456789abcdef.webp"
  touch -d '90 days ago' "$base/releases/$recent/chunk-RETAIN01.js" "$base/retained-assets/chunk-RETAIN01.js"
  touch -d "$((retention_days - 1)) days ago" "$base/releases/$recent"
  touch -d "$((retention_days + 1)) days ago" "$base/releases/$expired"
  touch -d '10 days ago' "$base/releases/$ten_days_old"

  old_upload="$base/incoming/$sha-200-1.tgz"
  fresh_upload="$base/incoming/$sha-201-1.tgz"
  printf 'abandoned upload\n' > "$old_upload"
  printf 'recent upload\n' > "$fresh_upload"
  printf 'operator file\n' > "$base/incoming/operator-notes.tgz"
  touch -d "$((retention_days + 1)) days ago" "$old_upload" "$base/incoming/operator-notes.tgz"

  # Recursive cleanup must not follow links outside its deployment directory.
  mkdir -p "$work/outside-$retention_days"
  printf 'untouched\n' > "$work/outside-$retention_days/sentinel"
  ln -s "$work/outside-$retention_days" "$base/releases/$expired/outside"
  touch -d "$((retention_days + 1)) days ago" "$base/releases/$expired"
  ln -s "$work/outside-$retention_days" "$base/retained-assets/outside"
  ln -s "$work/outside-$retention_days" "$base/releases/$sha-202-1"

  # Old source-directory metadata from tar must not age a new deployment.
  touch -d '90 days ago' "$work/build"
  pack 300
  started=$(date +%s)
  activate
  [[ "$(readlink "$base/current")" == "releases/$release" ]]
  [[ "$(readlink "$base/previous")" == releases/bootstrap ]]
  [[ -s "$base/releases/bootstrap/index.html" && -s "$base/retained-assets/chunk-PROTECT1.js" ]]
  [[ "$(stat -c %Y "$base/releases/bootstrap")" -ge "$started" ]]
  [[ "$(stat -c %Y "$base/releases/$release")" -ge "$started" ]]
  [[ -d "$base/releases/$recent" && -s "$base/retained-assets/chunk-RETAIN01.js" ]]
  [[ ! -e "$base/releases/$expired" && ! -e "$base/retained-assets/chunk-EXPIRED1.js" ]]
  [[ ! -e "$base/retained-assets/sprites/old unit.1.0123456789abcdef.webp" ]]
  [[ ! -e "$old_upload" && -s "$fresh_upload" && -s "$base/incoming/operator-notes.tgz" ]]
  [[ -s "$work/outside-$retention_days/sentinel" && -L "$base/retained-assets/outside" && -L "$base/releases/$sha-202-1" ]]
  if [[ "$retention_days" == 1 ]]; then
    [[ ! -e "$base/releases/$ten_days_old" && ! -e "$base/retained-assets/chunk-TENDAYS1.js" ]]
  else
    [[ -d "$base/releases/$ten_days_old" && -s "$base/retained-assets/chunk-TENDAYS1.js" ]]
  fi

  # A second deployment must retain the formerly long-running release after
  # it loses the previous pointer, for its full time since last serving.
  pack 301
  activate
  [[ -d "$base/releases/bootstrap" && -s "$base/retained-assets/chunk-PROTECT1.js" ]]
  touch -d "$((retention_days + 1)) days ago" "$base/releases/bootstrap"
  pack 302
  activate
  [[ ! -e "$base/releases/bootstrap" && ! -e "$base/retained-assets/chunk-PROTECT1.js" ]]

  # Preparation reclaims expired data even if the subsequent archive fails validation.
  mkdir -p "$base/releases/$expired"
  touch -d "$((retention_days + 1)) days ago" "$base/releases/$expired"
  printf 'abandoned\n' > "$old_upload"
  touch -d "$((retention_days + 1)) days ago" "$old_upload"
  pack 303
  printf 'corrupt\n' >> "$base/incoming/$release.tgz"
  expect_failure
  [[ ! -e "$base/releases/$expired" && ! -e "$old_upload" ]]
  pack 304
  for invalid_days in 0 -1 366 '5;false'; do
    if bash "$script_dir/activate-release.sh" prepare "$base" "$invalid_days" "$release" "$run_number" "$checksum" "$archive_bytes" "$build_bytes" "$build_entries" > "$work/invalid-retention.log" 2>&1; then
      echo "Accepted invalid retention: $invalid_days" >&2
      exit 1
    fi
    [[ ! -e "$base/releases/$release" && ! -e "$base/releases/$expired" && ! -e "$old_upload" ]]
  done
done

init_site() {
  mkdir -p "$base/incoming" "$base/releases/bootstrap" "$base/retained-assets"
  printf 'bootstrap\n' > "$base/releases/bootstrap/index.html"
  ln -s releases/bootstrap "$base/current"
}
expect_superseded() {
  local operation before previous_before status
  before=$(readlink "$base/current")
  previous_before=$(readlink "$base/previous" || true)
  for operation in prepare activate; do
    status=0
    run_server "$operation" > "$work/superseded.log" 2>&1 || status=$?
    [[ "$status" == 42 ]]
    grep -Fq 'Superseded deployment' "$work/superseded.log"
    [[ "$(readlink "$base/current")" == "$before" ]]
    [[ "$(readlink "$base/previous" || true)" == "$previous_before" ]]
  done
}

# A newer accepted request supersedes an older upload before either activates.
base="$work/ordering"
retention_days=1
init_site
pack 400
prepare
pack 401
prepare
pack 400
expect_superseded
[[ ! -e "$base/releases/$release" ]]
pack 401
activate_prepared
# Rerunning an older workflow cannot leapfrog a newer run, even with attempt 99.
pack 400 99
expect_superseded
# Higher attempts of the same workflow run supersede delayed lower attempts.
pack 401 2
prepare
pack 401
expect_superseded
pack 401 2
activate_prepared

# Rollback and pruning must never lower the ordering high-water mark.
state_before=$(cat "$base/.latest-deployment")
(
  exec 9> "$base/.deploy.lock"
  flock -x -w 1 9
  touch -- "$base/$(readlink "$base/current")"
  ln -s -- "$(readlink "$base/previous")" "$base/.rollback-current"
  mv -Tf -- "$base/.rollback-current" "$base/current"
)
cleanup
[[ "$(cat "$base/.latest-deployment")" == "$state_before" ]]
pack 401
expect_superseded
pack 402
activate

# Simulate bytes/inode exhaustion without filling or mounting a real disk.
mkdir -p "$work/bin"
cat > "$work/bin/df" <<'MOCK_DF'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *--output=avail*)
    printf 'Available\n'
    if [[ -n "${MOCK_FULL_WHILE_PRESENT:-}" && -e "$MOCK_FULL_WHILE_PRESENT" ]]; then
      printf '0\n'
    else
      printf '%s\n' "${MOCK_BYTES:-2147483648}"
    fi
    ;;
  *--output=iavail*) printf 'IFree\n%s\n' "${MOCK_INODES:-2000000}" ;;
  *) exit 1 ;;
esac
MOCK_DF
cat > "$work/bin/mktemp" <<'MOCK_MKTEMP'
#!/usr/bin/env bash
echo 'No free disk blocks for temporary files' >&2
exit 1
MOCK_MKTEMP
chmod +x "$work/bin/df" "$work/bin/mktemp"
original_path=$PATH
export PATH="$work/bin:$PATH"
base="$work/capacity"
init_site
mkdir "$base/releases/$sha-450-1"
printf 'protected rollback\n' > "$base/releases/$sha-450-1/index.html"
ln -s "releases/$sha-450-1" "$base/previous"
touch -d '90 days ago' "$base/releases/bootstrap" "$base/releases/$sha-450-1"
expired="$base/releases/$sha-451-1"
mkdir "$expired"
touch -d '2 days ago' "$expired"
export MOCK_FULL_WHILE_PRESENT="$expired"
pack 500
prepare
[[ ! -e "$expired" && -s "$base/current/index.html" && -s "$base/previous/index.html" ]]
# Prepare succeeded only because cleanup ran before the mocked free-space check.
unset MOCK_FULL_WHILE_PRESENT
state_before=$(cat "$base/.latest-deployment")
pack 501
for constraint in bytes inodes; do
  export MOCK_BYTES=2147483648 MOCK_INODES=2000000
  if [[ "$constraint" == bytes ]]; then MOCK_BYTES=0; else MOCK_INODES=0; fi
  if prepare > "$work/capacity.log" 2>&1; then
    echo "Accepted deployment with exhausted $constraint" >&2
    exit 1
  fi
  grep -Fq 'Insufficient disk capacity for prepare' "$work/capacity.log"
  [[ "$(cat "$base/.latest-deployment")" == "$state_before" ]]
  [[ "$(readlink "$base/current")" == releases/bootstrap && -s "$base/previous/index.html" ]]
  [[ ! -e "$base/releases/$release" ]]
done
export MOCK_BYTES=2147483648 MOCK_INODES=2000000
prepare
export MOCK_BYTES=0
if activate_prepared > "$work/capacity.log" 2>&1; then
  echo 'Activation did not recheck capacity after upload' >&2
  exit 1
fi
grep -Fq 'Insufficient disk capacity for activate' "$work/capacity.log"
[[ "$(readlink "$base/current")" == releases/bootstrap && ! -e "$base/releases/$release" ]]

# Cleanup-only must work without allocating temp files or requiring free space.
printf 'orphan asset\n' > "$base/retained-assets/chunk-ORPHAN01.js"
printf 'abandoned archive\n' > "$base/incoming/$sha-499-1.tgz"
touch -d '2 days ago' "$base/incoming/$sha-499-1.tgz"
cleanup
[[ ! -e "$base/retained-assets/chunk-ORPHAN01.js" && ! -e "$base/incoming/$sha-499-1.tgz" ]]
[[ -s "$base/current/index.html" && -s "$base/previous/index.html" ]]

# An incomplete retained-file inventory must abort before asset deletion.
export MOCK_SCAN_ROOT="$base/releases"
real_find=$(command -v find)
export MOCK_REAL_FIND="$real_find"
cat > "$work/bin/find" <<'MOCK_FIND'
#!/usr/bin/env bash
if [[ "$1" == "$MOCK_SCAN_ROOT" ]]; then
  printf 'partial/inventory\0'
  exit 1
fi
exec "$MOCK_REAL_FIND" "$@"
MOCK_FIND
chmod +x "$work/bin/find"
printf 'keep when scan fails\n' > "$base/retained-assets/chunk-SCANFAIL.js"
if cleanup > "$work/scan.log" 2>&1; then
  echo 'Cleanup accepted an incomplete file inventory' >&2
  exit 1
fi
[[ -s "$base/retained-assets/chunk-SCANFAIL.js" && -s "$base/current/index.html" ]]
export PATH="$original_path"
unset MOCK_BYTES MOCK_INODES MOCK_SCAN_ROOT MOCK_REAL_FIND

echo 'Release tests passed (switch, locks, rollback, 1/30-day cleanup, ordering, reruns, disk/inode pressure and failed scans).'
