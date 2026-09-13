#!/usr/bin/env bash
# Exercise transport sequencing and skipped deployments without network access.
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
work=$(mktemp -d /tmp/mekbay-transport-XXXXXXXX)
trap 'rm -rf -- "$work"' EXIT
export MOCK_TRANSPORT_ROOT="$work"
mkdir -p "$work/bin" "$work/dist/browser"
for file in index.html search.html forcegenerator.html ngsw.json ngsw-worker.js; do
  printf 'fixture %s\n' "$file" > "$work/dist/browser/$file"
done
printf 'licenses\n' > "$work/dist/3rdpartylicenses.txt"
cat > "$work/bin/sshpass" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == -e && "$SSHPASS" == 'fixture password' ]]
case "$2" in
  ssh)
    command=${!#}
    if [[ "$command" == *'for candidate in timeout gnutimeout'* ]]; then
      printf 'timeout\n'
      exit 0
    fi
    for operation in prepare activate cleanup; do
      [[ "$command" == *"bash -s -- $operation "* ]] || continue
      printf '%s\n' "$operation" >> "$MOCK_TRANSPORT_ROOT/steps"
      printf '%s\n' "$command" > "$MOCK_TRANSPORT_ROOT/$operation-command"
      cat > "$MOCK_TRANSPORT_ROOT/server-script"
      if [[ "${MOCK_REJECT_PHASE:-}" == "$operation" ]]; then exit 42; fi
      if [[ "${MOCK_FAIL_PHASE:-}" == "$operation" ]]; then exit 1; fi
      exit 0
    done
    exit 1
    ;;
  scp)
    printf 'upload\n' >> "$MOCK_TRANSPORT_ROOT/steps"
    [[ "${MOCK_FAIL_PHASE:-}" != upload ]] || exit 1
    args=("$@")
    cp -- "${args[$#-2]}" "$MOCK_TRANSPORT_ROOT/upload.tgz"
    printf '%s\n' "${args[$#-1]}" > "$MOCK_TRANSPORT_ROOT/upload-target"
    ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "$work/bin/sshpass"
export PATH="$work/bin:$PATH"
export DEPLOY_HOST=example.test DEPLOY_USER=fixture DEPLOY_PORT=2222
export DEPLOY_PASSWORD='fixture password' DEPLOY_KNOWN_HOSTS='fixture host key'
export DEPLOY_RETENTION_DAYS=1
export GITHUB_SHA=1111111111111111111111111111111111111111 GITHUB_RUN_ID=123 GITHUB_RUN_NUMBER=456 GITHUB_RUN_ATTEMPT=2
export GITHUB_OUTPUT="$work/github-output"
cd "$work"
reset_result() { : > "$work/steps"; : > "$GITHUB_OUTPUT"; }
for base in /var/www/mekbay-deploy /var/www/mekbay_next-deploy /var/www/mekbay_dev-deploy; do
  reset_result
  DEPLOY_PATH="$base" bash "$script_dir/deploy.sh"
  [[ "$(cat "$work/steps")" == $'prepare\nupload\nactivate' ]]
  [[ "$(tail -n 1 "$GITHUB_OUTPUT")" == deployed=true ]]
  [[ "$(cat "$work/upload-target")" == "fixture@example.test:$base/incoming/$GITHUB_SHA-123-2.tgz" ]]
  checksum=$(sha256sum "$work/upload.tgz")
  for phase in prepare activate; do
    grep -Fq -- "'$base' '$DEPLOY_RETENTION_DAYS' '$GITHUB_SHA-123-2' '$GITHUB_RUN_NUMBER' '${checksum%% *}'" "$work/$phase-command"
  done
  [[ "$(tar -xOzf "$work/upload.tgz" ./release.txt)" == "$GITHUB_SHA" ]]
  [[ "$(tar -xOzf "$work/upload.tgz" ./3rdpartylicenses.txt)" == licenses ]]
  cmp "$work/server-script" "$script_dir/activate-release.sh"
done
export DEPLOY_PATH=/var/www/mekbay_dev-deploy
for phase in prepare activate; do
  reset_result
  MOCK_REJECT_PHASE="$phase" bash "$script_dir/deploy.sh" > "$work/skipped.log"
  [[ "$(cat "$GITHUB_OUTPUT")" == deployed=false ]]
  grep -Fq "superseded during $phase" "$work/skipped.log"
  if [[ "$phase" == prepare ]]; then
    [[ "$(cat "$work/steps")" == prepare ]]
  else
    [[ "$(cat "$work/steps")" == $'prepare\nupload\nactivate' ]]
  fi
done
for phase in prepare upload activate; do
  reset_result
  if MOCK_FAIL_PHASE="$phase" bash "$script_dir/deploy.sh" > "$work/failed.log" 2>&1; then
    echo "Transport failure was ignored: $phase" >&2
    exit 1
  fi
  [[ "$(cat "$GITHUB_OUTPUT")" == deployed=false ]]
  [[ "$(tail -n 1 "$work/steps")" == "$phase" ]]
done
for base in /var/www /var/www/dev /var/www/mekbay_dev-deploy/.. /var/www/developer dev; do
  if DEPLOY_PATH="$base" bash "$script_dir/deploy.sh" > "$work/rejected.log" 2>&1; then
    echo "Unexpectedly accepted $base" >&2
    exit 1
  fi
  grep -Fq 'Unexpected deployment path' "$work/rejected.log"
done

# Maintenance needs only connection settings, from a directory with no build.
reset_result
mkdir "$work/no-build"
cd "$work/no-build"
unset GITHUB_SHA GITHUB_RUN_ID GITHUB_RUN_NUMBER GITHUB_RUN_ATTEMPT GITHUB_OUTPUT
bash "$script_dir/deploy.sh" cleanup
[[ "$(cat "$work/steps")" == cleanup ]]
grep -Fq "cleanup '$DEPLOY_PATH' '$DEPLOY_RETENTION_DAYS'" "$work/cleanup-command"
echo 'Transport tests passed (prepare/upload/activate, ordering skips, failures, destinations and standalone cleanup).'
