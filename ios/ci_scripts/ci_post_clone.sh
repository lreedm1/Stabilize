#!/bin/sh
set -eu

# Most Xcode Cloud workflows need no Ruby tooling. Install Fastlane only for
# the manually started metadata or App Review submission workflows.
if [ -z "${STABILIZE_XCODE_CLOUD_FASTLANE_LANE:-}" ]; then
  exit 0
fi

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
IOS_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$IOS_ROOT"
bundle config set --local path "$HOME/.bundle/stabilize"
bundle install --jobs 4 --retry 3
