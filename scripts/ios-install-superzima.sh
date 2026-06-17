#!/usr/bin/env bash
set -euo pipefail

SUPERZIMA_SSH_HOST="${SUPERZIMA_SSH_HOST:-192.168.0.147}"
SUPERZIMA_SSH_USER="${SUPERZIMA_SSH_USER:-turnercore}"
SUPERZIMA_CONTAINER="${SUPERZIMA_DAISYPOD_CONTAINER:-daisy-pod}"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat >&2 <<'USAGE'
Usage:
  DAISYPOD_DEVELOPMENT_TEAM=<team-id> scripts/ios-install-superzima.sh <device-udid> <coredevice-id>

Environment:
  SUPERZIMA_SSH_HOST=192.168.0.147
  SUPERZIMA_SSH_USER=turnercore
  SUPERZIMA_DAISYPOD_CONTAINER=daisy-pod

This wrapper reads SERVER_NATIVE_APP_TOKEN from the live SuperZima DaisyPod
container and passes it to the iOS build as DAISYPOD_NATIVE_APP_TOKEN without
printing or writing the token.
USAGE
  exit 0
fi

token="$(
  ssh -o BatchMode=yes "${SUPERZIMA_SSH_USER}@${SUPERZIMA_SSH_HOST}" \
    "docker exec '$SUPERZIMA_CONTAINER' printenv SERVER_NATIVE_APP_TOKEN"
)"

if [[ -z "$token" ]]; then
  echo "SERVER_NATIVE_APP_TOKEN was empty or unavailable on ${SUPERZIMA_CONTAINER}." >&2
  exit 1
fi

DAISYPOD_NATIVE_APP_TOKEN="$token" "$(dirname "$0")/ios-device-install.sh" "$@"
