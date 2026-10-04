#!/usr/bin/env bash
# Packages an Xcode archive as an .ipa file and writes its SHA-256 next to it.
# Used by the iOS job in .github/workflows/mobile.yml on a macOS runner.
#
#   bash mobile/package-ipa.sh <App.xcarchive> <output.ipa>
#
# An .ipa is a zip file with one folder, Payload, that holds the app. The
# script first checks that the archive holds what the project promises: a
# device build (arm64), the right bundle id, the bundled web app and the
# privacy manifest.

set -euo pipefail

ARCHIVE="${1:?path of the .xcarchive}"
IPA="${2:?path of the .ipa to write}"
APP="$ARCHIVE/Products/Applications/App.app"
BUNDLE_ID="org.prismmapper.mobile"

problem() {
  echo "::error::$*"
  exit 1
}

[ -d "$APP" ] || problem "There is no App.app inside $ARCHIVE."

archs="$(lipo -archs "$APP/App")"
case " $archs " in
  *" arm64 "*) ;;
  *) problem "$APP/App has no arm64 slice (found: $archs), so it is not a device build." ;;
esac

plist="$APP/Info.plist"
value() { /usr/libexec/PlistBuddy -c "Print :$1" "$plist"; }
[ "$(value CFBundleIdentifier)" = "$BUNDLE_ID" ] || problem "The bundle id is not $BUNDLE_ID."
[ "$(value DTPlatformName)" = "iphoneos" ] || problem "The archive was not built for iphoneos."
[ -f "$APP/public/index.html" ] || problem "The bundled web app (public/index.html) is missing."
[ -f "$APP/PrivacyInfo.xcprivacy" ] || problem "PrivacyInfo.xcprivacy is missing from the app."
echo "Bundle $(value CFBundleIdentifier), version $(value CFBundleShortVersionString) ($(value CFBundleVersion)), minimum iOS $(value MinimumOSVersion), architectures: $archs"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir "$work/Payload"
ditto "$APP" "$work/Payload/App.app"

mkdir -p "$(dirname "$IPA")"
ipa_path="$(cd "$(dirname "$IPA")" && pwd)/$(basename "$IPA")"
rm -f "$ipa_path"
(cd "$work" && zip -qry "$ipa_path" Payload)

(cd "$(dirname "$ipa_path")" && shasum -a 256 "$(basename "$ipa_path")" > "$(basename "$ipa_path").sha256")
echo "Wrote $ipa_path ($(du -h "$ipa_path" | cut -f1))"
codesign -dv "$APP" 2>&1 | head -3 || true
