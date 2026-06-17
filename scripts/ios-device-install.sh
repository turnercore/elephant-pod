#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="$ROOT_DIR/apps/ios"

DEVICE_UDID="${1:-${IOS_DEVICE_UDID:-}}"
COREDEVICE_ID="${2:-${IOS_COREDEVICE_ID:-}}"
DEVELOPMENT_TEAM="${DAISYPOD_DEVELOPMENT_TEAM:-${DEVELOPMENT_TEAM:-}}"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || -z "$DEVICE_UDID" || -z "$COREDEVICE_ID" ]]; then
  cat >&2 <<'USAGE'
Usage:
  DAISYPOD_DEVELOPMENT_TEAM=<team-id> scripts/ios-device-install.sh <device-udid> <coredevice-id>

Environment alternatives:
  IOS_DEVICE_UDID=<device-udid>
  IOS_COREDEVICE_ID=<coredevice-id>
  DAISYPOD_DEVELOPMENT_TEAM=<team-id>
  DAISYPOD_NATIVE_APP_TOKEN=<server-native-app-token>

Find ids with:
  xcrun xctrace list devices
  xcrun devicectl list devices
USAGE
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    exit 0
  fi
  exit 2
fi

if [[ -z "$DEVELOPMENT_TEAM" ]]; then
  echo "DAISYPOD_DEVELOPMENT_TEAM is required for physical-device signing." >&2
  exit 2
fi

cd "$IOS_DIR"
xcodegen generate

BUILD_XCCONFIG="$(mktemp "${TMPDIR:-/tmp}/daisypod-device-build.XXXXXX.xcconfig")"
chmod 600 "$BUILD_XCCONFIG"
trap 'rm -f "$BUILD_XCCONFIG"' EXIT
cat >"$BUILD_XCCONFIG" <<EOF
DAISYPOD_NATIVE_APP_TOKEN = ${DAISYPOD_NATIVE_APP_TOKEN:-}
EOF

set +e
xcodebuild \
  -project DaisyPod.xcodeproj \
  -scheme DaisyPod \
  -configuration Debug \
  -xcconfig "$BUILD_XCCONFIG" \
  -destination "id=$DEVICE_UDID" \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
  -allowProvisioningUpdates \
  build 2>&1 | sed "s/${DAISYPOD_NATIVE_APP_TOKEN:-__DAISYPOD_EMPTY_TOKEN__}/<redacted>/g"
build_status="${PIPESTATUS[0]}"
set -e
if [[ "$build_status" -ne 0 ]]; then
  exit "$build_status"
fi

APP_PATH="$(find "$HOME/Library/Developer/Xcode/DerivedData" -path '*/Build/Products/Debug-iphoneos/DaisyPod.app' -type d -print -quit)"
if [[ -z "$APP_PATH" ]]; then
  echo "Built app was not found in DerivedData." >&2
  exit 1
fi

xcrun devicectl device install app --device "$COREDEVICE_ID" "$APP_PATH"
