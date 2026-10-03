#!/usr/bin/env bash
# Checks an Android APK against what the project promises, using the tools of
# the Android SDK build-tools (aapt2 and apksigner).
#
#   bash mobile/verify-apk.sh <file.apk> <debuggable|release> [signed]
#
# It checks the application id, the version (versionName from package.json and
# the versionCode derived from it), the SDK levels, that the manifest turns off
# backups and cleartext traffic, that the only permissions are the microphone
# ones, and whether the app is debuggable. With "signed" it also verifies the
# signature. Needs ANDROID_HOME (or ANDROID_SDK_ROOT) to point at the SDK.

set -eu

APK="${1:?path of the APK}"
KIND="${2:?debuggable or release}"
SIGNED="${3:-}"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$SDK" ] || { echo "ANDROID_HOME is not set." >&2; exit 2; }
TOOLS="$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -1)"
AAPT2="$TOOLS/aapt2"

EXPECTED_VERSION="$(node -p 'require("./package.json").version')"
EXPECTED_CODE="$(node -p 'const [a,b,c]=require("./package.json").version.split(/[-+]/)[0].split(".").map(Number); a*10000+b*100+c')"
problems=0
expect() {
  # expect "<description>" <command that succeeds when the claim holds>
  local description="$1"
  shift
  if "$@"; then
    echo "ok   $description"
  else
    echo "FAIL $description"
    echo "::error title=APK check failed::$(basename "$APK"): $description"
    problems=$((problems + 1))
  fi
}

badging="$("$AAPT2" dump badging "$APK")"
permissions="$("$AAPT2" dump permissions "$APK")"
manifest="$("$AAPT2" dump xmltree --file AndroidManifest.xml "$APK")"

has() { grep -q -E -- "$1" <<< "$2"; }
# Boolean manifest attributes print as =true or =false, or in older aapt2
# versions as (type 0x12)0xffffffff and (type 0x12)0x0.
attr_false() { has "android:$1\\([^)]*\\)=(false|\\(type 0x12\\)0x0)( \\(Raw: .*\\))?\$" "$manifest"; }
attr_true() { has "android:$1\\([^)]*\\)=(true|\\(type 0x12\\)0xffffffff)( \\(Raw: .*\\))?\$" "$manifest"; }

expect "package is org.prismmapper.mobile" has "package: name='org.prismmapper.mobile'" "$badging"
expect "versionName is $EXPECTED_VERSION" has "versionName='$EXPECTED_VERSION'" "$badging"
expect "versionCode is $EXPECTED_CODE" has "versionCode='$EXPECTED_CODE'" "$badging"
expect "minSdkVersion is 24" has "sdkVersion:'24'" "$badging"
expect "targetSdkVersion is 36" has "targetSdkVersion:'36'" "$badging"
expect "application label is Prism Mapper" has "application-label:'Prism Mapper'" "$badging"
expect "backups are turned off" attr_false allowBackup
expect "cleartext traffic is turned off" attr_false usesCleartextTraffic
expect "the microphone is optional" has "uses-feature-not-required: name='android.hardware.microphone'" "$badging"

# The declared permissions must be exactly the microphone ones. The last entry
# is a signature permission that androidx.core adds for itself.
declared="$(sed -n "s/^uses-permission: name='\\([^']*\\)'.*/\\1/p" <<< "$permissions" | sort | tr '\n' ' ')"
wanted="android.permission.MODIFY_AUDIO_SETTINGS android.permission.RECORD_AUDIO org.prismmapper.mobile.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION "
expect "permissions are only the microphone ones (found: $declared)" test "$declared" = "$wanted"

if [ "$KIND" = "debuggable" ]; then
  expect "the build is debuggable" attr_true debuggable
else
  # A release build has no debuggable attribute at all, or has it set to false.
  not_debuggable() { ! attr_true debuggable; }
  expect "the build is not debuggable" not_debuggable
fi

if [ "$SIGNED" = "signed" ]; then
  echo "--- signature"
  "$TOOLS/apksigner" verify --verbose --print-certs "$APK" | grep -E "^Verifies|Signer #1 certificate (DN|SHA-256)|Verified using" || true
  expect "the signature verifies" "$TOOLS/apksigner" verify "$APK"
fi

echo "--- $(basename "$APK"): $(du -h "$APK" | cut -f1)"
if [ "$problems" -gt 0 ]; then
  # Show what aapt2 saw, so a failed check can be understood from the log.
  echo "::group::aapt2 dump badging"
  echo "$badging"
  echo "::endgroup::"
  echo "::group::aapt2 dump permissions"
  echo "$permissions"
  echo "::endgroup::"
  echo "::group::aapt2 dump xmltree AndroidManifest.xml"
  echo "$manifest"
  echo "::endgroup::"
  echo "::error::$(basename "$APK") failed $problems check(s)."
  exit 1
fi
