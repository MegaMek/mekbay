#!/usr/bin/env bash
# Upload a complete build, or run cleanup without a build/GitHub run context.
set -euo pipefail
mode=${1:-deploy}
[[ $# -le 1 && ( "$mode" == deploy || "$mode" == cleanup ) ]] || { echo 'Usage: deploy.sh [deploy|cleanup]' >&2; exit 1; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
for name in DEPLOY_HOST DEPLOY_USER DEPLOY_PASSWORD DEPLOY_PATH DEPLOY_KNOWN_HOSTS DEPLOY_RETENTION_DAYS; do
  [[ -n "${!name:-}" ]] || { echo "Missing required setting: $name" >&2; exit 1; }
done
port=${DEPLOY_PORT:-22}
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9.-]+$ && "$DEPLOY_USER" =~ ^[a-zA-Z0-9_-]+$ && "$port" =~ ^[0-9]+$ ]] || { echo 'Invalid SSH host, user or port' >&2; exit 1; }
[[ "$DEPLOY_PATH" =~ ^/var/www/mekbay(_next|_dev)?-deploy$ ]] || { echo 'Unexpected deployment path' >&2; exit 1; }
[[ "$DEPLOY_RETENTION_DAYS" =~ ^[1-9][0-9]{0,2}$ && "$DEPLOY_RETENTION_DAYS" -le 365 ]] || { echo 'Invalid retention (expected 1-365 days)' >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$work/known_hosts"
chmod 600 "$work/known_hosts"
if [[ "$mode" == deploy ]]; then
  [[ -z "${GITHUB_OUTPUT:-}" ]] || printf 'deployed=false\n' >> "$GITHUB_OUTPUT"
  for name in GITHUB_SHA GITHUB_RUN_ID GITHUB_RUN_NUMBER; do
    [[ -n "${!name:-}" ]] || { echo "Missing required setting: $name" >&2; exit 1; }
  done
  release="$GITHUB_SHA-$GITHUB_RUN_ID-${GITHUB_RUN_ATTEMPT:-1}"
  [[ "$release" =~ ^[a-f0-9]{40}-[1-9][0-9]{0,14}-[1-9][0-9]{0,8}$ && "$GITHUB_RUN_NUMBER" =~ ^[1-9][0-9]{0,14}$ ]] || { echo 'Invalid release ID or run number' >&2; exit 1; }
  for file in index.html search.html forcegenerator.html ngsw.json ngsw-worker.js; do
    [[ -s "dist/browser/$file" ]] || { echo "Missing build output: $file" >&2; exit 1; }
  done
  [[ -s dist/3rdpartylicenses.txt ]] || { echo 'Missing third-party licenses' >&2; exit 1; }
  printf '%s\n' "$GITHUB_SHA" > dist/browser/release.txt
  cp dist/3rdpartylicenses.txt dist/browser/3rdpartylicenses.txt
  tar -czf "$work/site.tgz" -C dist/browser .
  checksum=$(sha256sum "$work/site.tgz")
  checksum=${checksum%% *}
  archive_bytes=$(stat -c %s "$work/site.tgz")
  build_bytes=$(du -s -B1 dist/browser)
  build_bytes=${build_bytes%%[[:space:]]*}
  build_entries=$(find dist/browser -printf '.\n' | wc -l)
  build_entries=${build_entries//[[:space:]]/}
  for number in "$archive_bytes" "$build_bytes" "$build_entries"; do
    [[ "$number" =~ ^[1-9][0-9]{0,14}$ ]] || { echo 'Invalid build size' >&2; exit 1; }
  done
fi

target="$DEPLOY_USER@$DEPLOY_HOST"
options=(-o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$work/known_hosts" -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o NumberOfPasswordPrompts=1)
export SSHPASS="$DEPLOY_PASSWORD"
unset DEPLOY_PASSWORD
# Require the server setup and a timeout implementation whose process-group
# termination has been tested. Newer Ubuntu also packages it as gnutimeout.
remote_timeout=$(sshpass -e ssh "${options[@]}" -p "$port" "$target" "
  test -d '$DEPLOY_PATH/incoming' && test -L '$DEPLOY_PATH/current' || exit 1
  for candidate in timeout gnutimeout; do
    if \"\$candidate\" --version 2>/dev/null | grep -q 'GNU coreutils'; then
      printf '%s\\n' \"\$candidate\"
      exit 0
    fi
  done
  echo 'GNU timeout is required on the server (GNU coreutils or Ubuntu gnu-coreutils).' >&2
  exit 1
")
[[ "$remote_timeout" == timeout || "$remote_timeout" == gnutimeout ]] || { echo 'Unexpected remote timeout command' >&2; exit 1; }
# Bound remote work too, including descendants holding the deployment lock.
remote_command="$remote_timeout --signal=TERM --kill-after=10s 10m bash -s --"
if [[ "$mode" == cleanup ]]; then
  sshpass -e ssh "${options[@]}" -p "$port" "$target" "$remote_command cleanup '$DEPLOY_PATH' '$DEPLOY_RETENTION_DAYS'" < "$script_dir/activate-release.sh"
  exit 0
fi
remote_arguments="'$DEPLOY_PATH' '$DEPLOY_RETENTION_DAYS' '$release' '$GITHUB_RUN_NUMBER' '$checksum' '$archive_bytes' '$build_bytes' '$build_entries'"
for operation in prepare activate; do
  status=0
  sshpass -e ssh "${options[@]}" -p "$port" "$target" "$remote_command $operation $remote_arguments" < "$script_dir/activate-release.sh" || status=$?
  if [[ "$status" == 42 ]]; then
    echo "::notice::Deployment superseded during $operation; no further deployment or public checks."
    exit 0
  fi
  [[ "$status" == 0 ]] || exit "$status"
  if [[ "$operation" == prepare ]]; then
    # OpenSSH on the GitHub runner uses SFTP. Preparation has pruned expired
    # files and checked space for this archive plus its extraction.
    sshpass -e scp "${options[@]}" -P "$port" "$work/site.tgz" "$target:$DEPLOY_PATH/incoming/$release.tgz"
  fi
done
unset SSHPASS
[[ -z "${GITHUB_OUTPUT:-}" ]] || printf 'deployed=true\n' >> "$GITHUB_OUTPUT"
echo "Activated $release"
