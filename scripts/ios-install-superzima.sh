#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat >&2 <<'USAGE'
Usage:
  DAISYPOD_DEVELOPMENT_TEAM=<team-id> scripts/ios-install-superzima.sh <device-udid> <coredevice-id>

This compatibility wrapper now delegates to ios-device-install.sh. Protected
backend features use Sign in with Apple sessions instead of a bundled native app
token.
USAGE
  exit 0
fi

"$(dirname "$0")/ios-device-install.sh" "$@"
