#!/usr/bin/env bash
# Installs the Android builds on the emulator that is already running and
# checks that each one starts. Run by the "Android emulator" job in
# .github/workflows/mobile.yml, inside the emulator runner.
#
#   bash mobile/android-smoke.sh <debug.apk> <sideload.apk> <output-folder>
#
# The debug build is inspected from the inside over the WebView DevTools
# (mobile/android-smoke.mjs). The sideload build is the APK people install, so
# it only gets the outside checks: it starts, stays alive, shows something and
# survives a rotation. Both get a screenshot and a filtered system log.
# Every check that fails is reported, then the script exits with 1.

set -u

DEBUG_APK="${1:?path of the debug APK}"
SIDELOAD_APK="${2:?path of the sideload APK}"
OUT="${3:?folder for screenshots and logs}"
PACKAGE="org.prismmapper.mobile"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPECTED_VERSION="$(node -p 'require("./package.json").version')"
EXPECTED_CODE="$(node -p 'const [a,b,c]=require("./package.json").version.split(/[-+]/)[0].split(".").map(Number); a*10000+b*100+c')"
SETTLE_SECONDS="${SETTLE_SECONDS:-20}"

mkdir -p "$OUT"
failures=0
fail() {
  echo "::error::$*"
  failures=$((failures + 1))
}
note() { echo "[android-smoke] $*"; }

app_pid() { adb shell pidof -s "$PACKAGE" 2>/dev/null | tr -d '\r' || true; }

device_report() {
  {
    echo "Android $(adb shell getprop ro.build.version.release | tr -d '\r') (API $(adb shell getprop ro.build.version.sdk | tr -d '\r')), $(adb shell getprop ro.product.cpu.abi | tr -d '\r')"
    echo "Screen: $(adb shell wm size | tr -d '\r' | tail -1), $(adb shell wm density | tr -d '\r' | tail -1)"
    adb shell dumpsys webviewupdate | tr -d '\r' | grep -E "Current WebView package|Minimum WebView version" || true
  } | tee "$OUT/device.txt"
}

install_apk() {
  local apk="$1" label="$2"
  adb uninstall "$PACKAGE" > /dev/null 2>&1 || true
  local result
  result="$(adb install -r "$apk" 2>&1 | tr -d '\r')"
  echo "$result" | tee "$OUT/install-$label.txt"
  if ! grep -q "Success" <<< "$result"; then
    fail "$label: adb install failed (see install-$label.txt)."
    return 1
  fi
  local info
  info="$(adb shell dumpsys package "$PACKAGE" | tr -d '\r')"
  echo "$info" > "$OUT/package-$label.txt"
  if ! grep -q "versionName=$EXPECTED_VERSION" <<< "$info"; then
    fail "$label: the installed versionName is not $EXPECTED_VERSION."
  fi
  if ! grep -q "versionCode=$EXPECTED_CODE" <<< "$info"; then
    fail "$label: the installed versionCode is not $EXPECTED_CODE."
  fi
  note "$label: installed version $EXPECTED_VERSION (code $EXPECTED_CODE)."
}

# Starts the app from a cold start and waits until it should have drawn.
launch() {
  local label="$1"
  adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS > /dev/null 2>&1 || true
  adb logcat -c
  adb shell am start -W -n "$PACKAGE/.MainActivity" 2>&1 | tr -d '\r' | tee "$OUT/am-start-$label.txt"
  if ! grep -q "Status: ok" "$OUT/am-start-$label.txt"; then
    fail "$label: the activity did not start (see am-start-$label.txt)."
  fi
  note "$label: waiting $SETTLE_SECONDS seconds for the first frames."
  sleep "$SETTLE_SECONDS"
}

screenshot() {
  adb exec-out screencap -p > "$OUT/$1.png"
  if ! node "$HERE/png-stats.mjs" "$OUT/$1.png"; then
    fail "$1: the screenshot looks blank, so the app did not draw (see $1.png)."
  fi
}

# Crash and error checks on the system log taken after the app has run.
check_run() {
  local label="$1" before_pid="$2" debuggable="$3"
  adb logcat -d -v threadtime > "$OUT/logcat-$label.txt" 2>&1 || true
  local log="$OUT/logcat-$label.txt"
  local pid
  pid="$(app_pid)"
  if [ -z "$pid" ]; then
    fail "$label: the app is not running any more, it crashed or exited."
  elif [ -n "$before_pid" ] && [ "$pid" != "$before_pid" ]; then
    fail "$label: the app process changed from $before_pid to $pid, so it crashed and restarted."
  else
    note "$label: still running as process $pid."
  fi
  if grep -A3 "FATAL EXCEPTION" "$log" | grep -q "Process: $PACKAGE"; then
    fail "$label: Java crash in the app (FATAL EXCEPTION in logcat-$label.txt)."
    grep -A12 "FATAL EXCEPTION" "$log" | head -30
  fi
  if grep -q "ANR in $PACKAGE" "$log"; then
    fail "$label: the app did not respond (ANR in logcat-$label.txt)."
  fi
  if [ -n "$before_pid" ] && grep -E "Fatal signal [0-9]+ .*pid ($before_pid|$pid) " "$log" | head -3 | grep -q .; then
    fail "$label: native crash in the app (Fatal signal in logcat-$label.txt)."
  fi
  if ! adb shell dumpsys activity activities | tr -d '\r' | grep -E "topResumedActivity|mResumedActivity" | grep -q "$PACKAGE"; then
    fail "$label: the app is not the foreground activity (a crash or error dialog may cover it)."
  fi
  # Capacitor copies web console output and native plugin errors to logcat,
  # in debuggable builds only.
  if [ "$debuggable" = "yes" ]; then
    if grep -E " E Capacitor" "$log" | head -10 | grep -q .; then
      fail "$label: Capacitor logged errors:"
      grep -E " E Capacitor" "$log" | head -10
    fi
  fi
  grep -E "FATAL EXCEPTION|AndroidRuntime|ANR in|Fatal signal| E Capacitor| E chromium|$PACKAGE.*(died|crash)" "$log" > "$OUT/problems-$label.txt" || true
}

is_debuggable() {
  adb shell dumpsys package "$PACKAGE" | tr -d '\r' | grep -E "pkgFlags=|flags=" | grep -q "DEBUGGABLE"
}

# --- Device ---------------------------------------------------------------
adb wait-for-device
device_report
adb shell settings put global hide_error_dialogs 1 > /dev/null 2>&1 || true

# --- Debug build: inspected from the inside --------------------------------
note "Debug build."
if install_apk "$DEBUG_APK" debug; then
  if ! is_debuggable; then fail "debug: expected a debuggable build."; fi
  launch debug
  before="$(app_pid)"
  [ -n "$before" ] || fail "debug: no process after launch."
  screenshot debug-screen
  if ! node "$HERE/android-smoke.mjs" --native --package "$PACKAGE" --out "$OUT"; then
    fail "debug: the page check inside the WebView failed (see webview-probe.json)."
  fi
  check_run debug "$before" yes
fi

# --- Sideload build: the APK people install --------------------------------
note "Sideload build."
if install_apk "$SIDELOAD_APK" sideload; then
  if is_debuggable; then fail "sideload: the shared APK must not be debuggable."; fi
  launch sideload
  before="$(app_pid)"
  [ -n "$before" ] || fail "sideload: no process after launch."
  screenshot sideload-screen
  # The app must cope with rotation. Rotation is a device setting, so a
  # failure to change it is only a warning.
  if adb shell settings put system accelerometer_rotation 0 && adb shell settings put system user_rotation 1; then
    sleep 5
    screenshot sideload-landscape
    adb shell settings put system user_rotation 0 || true
    sleep 3
  else
    note "Could not rotate the emulator, skipping the landscape screenshot."
  fi
  check_run sideload "$before" no
fi

if [ "$failures" -gt 0 ]; then
  echo "Android smoke test: $failures problem(s)." | tee "$OUT/summary.txt"
  exit 1
fi
echo "Android smoke test: both builds installed, started, drew their interface and stayed alive." | tee "$OUT/summary.txt"
