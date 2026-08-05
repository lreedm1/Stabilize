#!/bin/sh
set -eu

LANE="${STABILIZE_XCODE_CLOUD_FASTLANE_LANE:-}"
TRIGGER_ACTION="${STABILIZE_XCODE_CLOUD_FASTLANE_ACTION:-}"
CURRENT_ACTION="${CI_XCODEBUILD_ACTION:-}"

if [ -z "$LANE" ]; then
  exit 0
fi

if [ "${STABILIZE_XCODE_CLOUD_RELEASE:-}" != "1" ]; then
  echo "Stabilize App Store automation is restricted to the configured Xcode Cloud release workflows." >&2
  exit 1
fi

# Xcode Cloud invokes this script after every action. Run the lane exactly once,
# after the action selected in the workflow environment.
if [ -z "$TRIGGER_ACTION" ] || [ "$CURRENT_ACTION" != "$TRIGGER_ACTION" ]; then
  exit 0
fi

case "$LANE" in
  metadata|submit)
    ;;
  *)
    echo "Unsupported Stabilize Xcode Cloud Fastlane lane: $LANE" >&2
    exit 1
    ;;
esac

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
IOS_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$IOS_ROOT"
bundle exec fastlane ios "$LANE"
