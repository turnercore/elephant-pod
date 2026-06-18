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

xcodebuild \
  -project DaisyPod.xcodeproj \
  -scheme DaisyPod \
  -configuration Debug \
  -destination "id=$DEVICE_UDID" \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
  -allowProvisioningUpdates \
  build

APP_PATH="$(find "$HOME/Library/Developer/Xcode/DerivedData" -path '*/Build/Products/Debug-iphoneos/DaisyPod.app' -type d -print -quit)"
if [[ -z "$APP_PATH" ]]; then
  echo "Built app was not found in DerivedData." >&2
  exit 1
fi

xcrun devicectl device install app --device "$COREDEVICE_ID" "$APP_PATH"
