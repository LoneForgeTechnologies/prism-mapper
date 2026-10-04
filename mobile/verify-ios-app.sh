#!/usr/bin/env bash
# Checks a built iOS app (App.app) against what the project promises, using
# PlistBuddy, which is part of macOS.
#
#   bash mobile/verify-ios-app.sh <App.app> <version from package.json> <build number>
#
# It checks the bundle id, the display name, the version and build number
# (the build number comes from the CI run number), the microphone text, the
# file sharing and encryption keys, dark appearance, that every orientation is
# allowed on iPhone and iPad, and that the bundle holds the web app, the app
# icons and the privacy manifest.

set -eu

APP="${1:?path of App.app}"
VERSION="${2:?version from package.json}"
BUILD="${3:?build number}"
PLIST="$APP/Info.plist"
EXPECTED_SHORT="${VERSION%%[-+]*}"
MICROPHONE_TEXT="Prism Mapper analyzes your selected audio input locally to animate effects when you tap Start listening. Audio is never recorded or uploaded."

problems=0
value() { /usr/libexec/PlistBuddy -c "Print :$1" "$PLIST" 2> /dev/null || true; }
expect_equal() {
  # expect_equal "<description>" "<actual>" "<expected>"
  if [ "$2" = "$3" ]; then
    echo "ok   $1"
  else
    echo "FAIL $1 (found: '$2', wanted: '$3')"
    echo "::error title=iOS app check failed::$1 (found: '$2', wanted: '$3')"
    problems=$((problems + 1))
  fi
}
expect_contains() {
  # expect_contains "<description>" "<text>" "<needle>"
  if grep -q -F -- "$3" <<< "$2"; then
    echo "ok   $1"
  else
    echo "FAIL $1 (missing: '$3')"
    echo "::error title=iOS app check failed::$1 (missing: '$3')"
    problems=$((problems + 1))
  fi
}
expect_file() {
  if [ -e "$APP/$1" ]; then
    echo "ok   the bundle holds $1"
  else
    echo "FAIL the bundle is missing $1"
    echo "::error title=iOS app check failed::the bundle is missing $1"
    problems=$((problems + 1))
  fi
}

expect_equal "bundle id" "$(value CFBundleIdentifier)" "org.prismmapper.mobile"
expect_equal "display name" "$(value CFBundleDisplayName)" "Prism Mapper"
expect_equal "version is package.json's version ($EXPECTED_SHORT)" "$(value CFBundleShortVersionString)" "$EXPECTED_SHORT"
expect_equal "build number is the CI run number" "$(value CFBundleVersion)" "$BUILD"
expect_equal "minimum iOS version" "$(value MinimumOSVersion)" "15.0"
expect_equal "microphone text" "$(value NSMicrophoneUsageDescription)" "$MICROPHONE_TEXT"
expect_equal "encryption export key" "$(value ITSAppUsesNonExemptEncryption)" "false"
expect_equal "file sharing" "$(value UIFileSharingEnabled)" "true"
expect_equal "open documents in place" "$(value LSSupportsOpeningDocumentsInPlace)" "true"
expect_equal "dark appearance" "$(value UIUserInterfaceStyle)" "Dark"

iphone="$(value UISupportedInterfaceOrientations)"
ipad="$(value UISupportedInterfaceOrientations~ipad)"
for orientation in UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight; do
  expect_contains "iPhone allows $orientation" "$iphone" "$orientation"
  expect_contains "iPad allows $orientation" "$ipad" "$orientation"
done

expect_file public/index.html
expect_file capacitor.config.json
expect_file Assets.car
expect_file PrivacyInfo.xcprivacy

# The bundled configuration must never point the web view at a remote server.
if [ -f "$APP/capacitor.config.json" ]; then
  remote="$(node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(c.server && c.server.url ? c.server.url : "")' "$APP/capacitor.config.json")"
  expect_equal "no remote server url in capacitor.config.json" "$remote" ""
fi

if [ "$problems" -gt 0 ]; then
  echo "::error::$(basename "$APP") failed $problems check(s)."
  exit 1
fi
