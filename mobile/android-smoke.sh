#!/usr/bin/env bash
# Installs the Android builds on the emulator that is already running and
# checks that each one starts. Run by the "Android emulator test" job in
# .github/workflows/mobile.yml, inside the emulator runner.
#
#   bash mobile/android-smoke.sh <debug.apk> <sideload.apk> <output-folder>
#
# The debug build is inspected from the inside over the WebView DevTools
# (mobile/android-smoke.mjs), and then its web view process is stopped to check
# that the app comes back. The sideload build is the APK people install, so it
# only gets the outside checks: it starts, stays alive, shows something and
# survives a rotation. Both get a screenshot and a filtered system log.
# Every check that fails is reported, then the script exits with 1.
#
# Every adb command has a time limit, so a stuck emulator fails a check
# instead of hanging the job. Results and, for failures, an excerpt of the
# system log are also written as GitHub annotations (::notice and ::error),
# so they can be read from the run page and from the API without opening logs.

set -u

DEBUG_APK="${1:?path of the debug APK}"
SIDELOAD_APK="${2:?path of the sideload APK}"
OUT="${3:?folder for screenshots and logs}"
# Which builds to try: any of debug and sideload.
VARIANTS="${VARIANTS:-debug sideload}"
PACKAGE="org.prismmapper.mobile"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPECTED_VERSION="$(node -p 'require("./package.json").version')"
EXPECTED_CODE="$(node -p 'const [a,b,c]=require("./package.json").version.split(/[-+]/)[0].split(".").map(Number); a*10000+b*100+c')"
SETTLE_SECONDS="${SETTLE_SECONDS:-20}"
TITLE="Android emulator test"

mkdir -p "$OUT"
failures=0

# Annotation messages are one line, so newlines and percent signs are escaped.
escape() { sed -e 's/%/%25/g' -e 's/\r//g' | awk 'BEGIN { ORS = "%0A" } { print }' | head -c 6000; }
fail() {
  echo "FAIL $*"
  echo "::error title=$TITLE::$(echo "$*" | escape)"
  failures=$((failures + 1))
}
note() { echo "[android-smoke] $*"; }
notice() { echo "::notice title=$TITLE::$(echo "$*" | tr '\n' ' ' | head -c 1500)"; }

# adb with a time limit (seconds) so that nothing can hang the job.
adbt() {
  local seconds="$1"
  shift
  timeout "$seconds" adb "$@"
}

app_pid() { adbt 20 shell pidof -s "$PACKAGE" 2> /dev/null | tr -d '\r'; }

# The most useful evidence about a failed start, as one annotation: the state
# of the emulator, the app's processes and the interesting lines of the log.
diagnose() {
  local label="$1" state processes excerpt
  state="$(adbt 20 get-state 2>&1 | tr -d '\r' | head -c 200)"
  processes="$(adbt 30 shell ps -A 2> /dev/null | tr -d '\r' | grep -i -E "prism|webview|chromium|sandboxed" | head -n 8)"
  excerpt="$(adbt 60 logcat -b main,system,crash -d -v brief 2> /dev/null | tr -d '\r' \
    | grep -E "AndroidRuntime|FATAL|Fatal signal|ActivityManager|ActivityTaskManager|$PACKAGE|prismmapper|chromium|Capacitor|WebView|libc  |DEBUG" \
    | grep -v -E "^[VD]/" | tail -n 30 | cut -c1-260)"
  {
    echo "$label diagnosis. adb state: $state"
    echo "Processes:"
    echo "$processes"
    echo "Log:"
    echo "$excerpt"
  } > "$OUT/diagnosis-$label.txt"
  echo "::error title=$TITLE diagnosis::$(escape < "$OUT/diagnosis-$label.txt")"
}

# Writes what the script is doing now, for the watchdog's timeline.
stage() {
  echo "$*" > "$OUT/stage.txt"
  note "$*"
}

# Runs in the background and records, every two seconds, whether the emulator
# is still attached to adb and whether its process still exists. The timeline
# shows exactly when, and during which stage, an emulator disappears. The
# fields are separated by "|": time, adb state, emulator process, available
# memory in MB, stage.
watchdog() {
  while true; do
    printf '%s|%s|%s|%s|%s\n' \
      "$(date +%T)" \
      "$(timeout 10 adb get-state 2>&1 | head -n 1 | cut -c1-60)" \
      "$(pgrep -f 'qemu-system' | head -n 1)" \
      "$(free -m | awk '/^Mem:/ { print $7 }')" \
      "$(cat "$OUT/stage.txt" 2> /dev/null)" >> "$OUT/watchdog.txt"
    sleep 2
  done
}

# One annotation with what the machine knows: the changes of the watchdog
# timeline, what the host kernel says about killed processes, the last
# important lines of the system log that was kept on this machine, and what
# the emulator itself printed.
host_diagnose() {
  local label="$1"
  {
    echo "$label host diagnosis: $(nproc) cpus, $(free -m | awk '/^Mem:/ { print $2 " MB memory, " $7 " MB available" }'), $(df -h / | awk 'NR == 2 { print $4 " disk free" }')"
    echo "Timeline (time, adb state, emulator process, free MB, stage; changes only):"
    awk -F'|' '{ key = $2 "|" $3 "|" $5; if (key != last) { print $1 " " $2 " qemu=" $3 " " $4 "MB " $5; last = key } }' "$OUT/watchdog.txt" 2> /dev/null | tail -n 16 | cut -c1-200
    echo "Last watchdog line: $(tail -n 1 "$OUT/watchdog.txt" 2> /dev/null)"
    echo "Emulator process: $(pgrep -af 'qemu-system' | head -n 1 | cut -c1-300)"
    echo "Host kernel messages about killed processes:"
    sudo dmesg 2> /dev/null | grep -i -E "out of memory|oom-kill|killed process|segfault|general protection|invalid opcode|call trace" | tail -n 8 | cut -c1-220
    echo "System log kept on this machine (last important lines):"
    grep -a -E "FATAL|Fatal signal|AndroidRuntime|ANR in|Watchdog|lowmemorykiller|lmkd|am_crash|am_proc_died|am_anr|has died|DEBUG|tombstone|SIGSEGV|zygote" "$OUT/logcat-live.txt" 2> /dev/null | tail -n 14 | cut -c1-230
    echo "Last lines of that log: $(tail -n 3 "$OUT/logcat-live.txt" 2> /dev/null | cut -c1-200 | tr '\n' '|')"
    echo "Emulator output (errors and warnings):"
    grep -a -i -E "error|fatal|panic|segfault|segmentation|oops|killed|abort|crash|failed" "$OUT/emulator.log" 2> /dev/null | tail -n 12 | cut -c1-230
    echo "Emulator output (last lines):"
    tail -n 8 "$OUT/emulator.log" 2> /dev/null | cut -c1-230
  } > "$OUT/host-diagnosis-$label.txt"
  echo "::error title=$TITLE host diagnosis::$(escape < "$OUT/host-diagnosis-$label.txt")"
}

device_report() {
  {
    echo "Android $(adbt 20 shell getprop ro.build.version.release | tr -d '\r') (API $(adbt 20 shell getprop ro.build.version.sdk | tr -d '\r')), $(adbt 20 shell getprop ro.product.cpu.abi | tr -d '\r')"
    echo "Screen: $(adbt 20 shell wm size | tr -d '\r' | tail -1), $(adbt 20 shell wm density | tr -d '\r' | tail -1)"
    adbt 30 shell dumpsys webviewupdate | tr -d '\r' | grep -E "Current WebView package" || true
  } | tee "$OUT/device.txt"
  notice "Device: $(cat "$OUT/device.txt")"
}

install_apk() {
  local apk="$1" label="$2"
  adbt 60 uninstall "$PACKAGE" > /dev/null 2>&1 || true
  local result
  result="$(adbt 300 install -r "$apk" 2>&1 | tr -d '\r')"
  echo "$result" | tee "$OUT/install-$label.txt"
  if ! grep -q "Success" <<< "$result"; then
    fail "$label: adb install failed: $(echo "$result" | tail -n 2)"
    return 1
  fi
  local info
  info="$(adbt 60 shell dumpsys package "$PACKAGE" | tr -d '\r')"
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
  adbt 30 shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS > /dev/null 2>&1 || true
  adbt 30 logcat -c
  adbt 180 shell am start -W -n "$PACKAGE/.MainActivity" 2>&1 | tr -d '\r' | tee "$OUT/am-start-$label.txt"
  if ! grep -q "Status: ok" "$OUT/am-start-$label.txt"; then
    fail "$label: the activity did not start: $(tr '\n' ' ' < "$OUT/am-start-$label.txt" | head -c 300)"
  fi
  note "$label: waiting $SETTLE_SECONDS seconds for the first frames."
  sleep "$SETTLE_SECONDS"
}

# Takes a screenshot into <name>.png, checks that it is not blank and leaves
# the numbers in $SHOT_STATS.
SHOT_STATS=""
screenshot() {
  local name="$1" file="$OUT/$1.png"
  timeout 60 adb exec-out screencap -p > "$file" 2> "$OUT/screencap-$name.txt"
  if SHOT_STATS="$(node "$HERE/png-stats.mjs" "$file" 2>&1)"; then
    note "$name: $(echo "$SHOT_STATS" | tr '\n' ' ')"
  else
    echo "$SHOT_STATS"
    fail "$name: the screenshot looks blank or is missing, so nothing was drawn. $(echo "$SHOT_STATS" | tr '\n' ' ' | head -c 300) screencap said: $(head -c 300 "$OUT/screencap-$name.txt") file starts with: $(head -c 80 "$file" | tr -c '[:print:]' '.')"
  fi
}

capacitor_errors() { grep -E " E Capacitor" "$1" | grep -v "Error injecting safe area CSS"; }

# Crash and error checks on the system log taken after the app has run.
check_run() {
  local label="$1" before_pid="$2" debuggable="$3"
  adbt 90 logcat -b main,system,crash -d -v threadtime > "$OUT/logcat-$label.txt" 2>&1 || true
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
    fail "$label: Java crash in the app: $(grep -A8 "FATAL EXCEPTION" "$log" | cut -c1-200)"
  fi
  if grep -q "ANR in $PACKAGE" "$log"; then
    fail "$label: the app did not respond (ANR in logcat-$label.txt)."
  fi
  if [ -n "$before_pid" ] && grep -E "Fatal signal [0-9]+ .*pid ($before_pid|$pid) " "$log" | head -3 | grep -q .; then
    fail "$label: native crash in the app: $(grep -E "Fatal signal" "$log" | head -2 | cut -c1-200)"
  fi
  if ! adbt 60 shell dumpsys activity activities | tr -d '\r' | grep -E "topResumedActivity|mResumedActivity" | grep -q "$PACKAGE"; then
    fail "$label: the app is not the foreground activity (a crash or error dialog may cover it)."
  fi
  # Capacitor copies web console output and native plugin errors to logcat,
  # in debuggable builds only. One message is left out: the SystemBars plugin
  # logs "Error injecting safe area CSS" when the first insets arrive before
  # the page has a document, and writes them again once the page is visible.
  if [ "$debuggable" = "yes" ] && capacitor_errors "$log" | head -10 | grep -q .; then
    fail "$label: Capacitor logged errors: $(capacitor_errors "$log" | head -3 | cut -c1-300)"
  fi
  grep -E "FATAL EXCEPTION|AndroidRuntime|ANR in|Fatal signal| E Capacitor| E chromium|$PACKAGE.*(died|crash)" "$log" > "$OUT/problems-$label.txt" || true
  grep -E "Displayed $PACKAGE|Start proc .*$PACKAGE" "$log" | head -3 | cut -c1-200 || true
}

# Stops the web view's process, as a phone short of memory does, and checks
# that the app lives on in the same process and draws its screen again.
#   check_recovery <label>
check_recovery() {
  local label="$1" before after log="$OUT/logcat-$1-recovery.txt"
  before="$(app_pid)"
  if [ -z "$before" ]; then
    fail "$label: the app is not running, so its web view process cannot be stopped."
    return
  fi
  stage "$label: stop the web view process"
  adbt 30 logcat -c
  if ! node "$HERE/android-smoke.mjs" --crash --package "$PACKAGE" --out "$OUT" --timeout 60; then
    fail "$label: the app did not come back after its web view process was stopped (see webview-crash.json)."
  fi
  adbt 90 logcat -b main,system,crash -d -v threadtime > "$log" 2>&1 || true
  after="$(app_pid)"
  if [ -z "$after" ]; then
    fail "$label: the app closed when its web view process was stopped."
  elif [ "$after" != "$before" ]; then
    fail "$label: the app process changed from $before to $after when its web view process was stopped."
  fi
  if ! grep -q "PrismMapper.*restarting the screen" "$log"; then
    fail "$label: MainActivity did not log that it restarted the screen, so something else kept the app alive."
  fi
  if grep -A3 "FATAL EXCEPTION" "$log" | grep -q "Process: $PACKAGE"; then
    fail "$label: Java crash in the app after its web view process was stopped: $(grep -A8 "FATAL EXCEPTION" "$log" | cut -c1-200)"
  fi
  sleep 5
  screenshot "$label-recovered"
  note "$label: after the web view process was stopped: $(echo "$SHOT_STATS" | tr '\n' ' ')"
}

is_debuggable() {
  adbt 60 shell dumpsys package "$PACKAGE" | tr -d '\r' | grep -E "pkgFlags=|flags=" | grep -q "DEBUGGABLE"
}

# A debuggable build, inspected from the inside over the WebView DevTools.
#   check_debug <label> <apk>
check_debug() {
  local label="$1" apk="$2" before stats
  stage "$label: install"
  install_apk "$apk" "$label" || return
  if ! is_debuggable; then fail "$label: expected a debuggable build."; fi
  stage "$label: launch"
  launch "$label"
  before="$(app_pid)"
  if [ -z "$before" ]; then
    fail "$label: no process after launch."
    diagnose "$label"
    host_diagnose "$label"
  fi
  stage "$label: screenshot"
  screenshot "$label-screen"
  stats="$SHOT_STATS"
  stage "$label: web view check"
  if [ -n "$before" ]; then
    if ! node "$HERE/android-smoke.mjs" --native --package "$PACKAGE" --out "$OUT" --timeout 45; then
      fail "$label: the page check inside the WebView failed (see webview-probe.json)."
    fi
  fi
  stage "$label: log check"
  check_run "$label" "$before" yes
  if [ -n "$before" ]; then check_recovery "$label"; fi
  notice "$label build: version $EXPECTED_VERSION installed, process ${before:-none}, screenshot: $(echo "$stats" | tr '\n' ' ' | head -c 500)"
}

# The APK people install: outside checks only, plus a rotation.
check_sideload() {
  local before portrait landscape="not tried"
  stage "sideload: install"
  install_apk "$SIDELOAD_APK" sideload || return
  if is_debuggable; then fail "sideload: the shared APK must not be debuggable."; fi
  stage "sideload: launch"
  launch sideload
  before="$(app_pid)"
  if [ -z "$before" ]; then
    fail "sideload: no process after launch."
    diagnose sideload
    host_diagnose sideload
  fi
  stage "sideload: screenshot"
  screenshot sideload-screen
  portrait="$SHOT_STATS"
  # The app must cope with rotation. Rotation is a device setting, so a
  # failure to change it is only a warning.
  if [ -n "$before" ] && adbt 20 shell settings put system accelerometer_rotation 0 && adbt 20 shell settings put system user_rotation 1; then
    sleep 5
    screenshot sideload-landscape
    landscape="$SHOT_STATS"
    adbt 20 shell settings put system user_rotation 0 || true
    sleep 3
  else
    note "Skipping the landscape screenshot."
  fi
  stage "sideload: log check"
  check_run sideload "$before" no
  notice "sideload build: version $EXPECTED_VERSION installed, process ${before:-none}, portrait: $(echo "$portrait" | tr '\n' ' ' | head -c 450) landscape: $(echo "$landscape" | tr '\n' ' ' | head -c 450)"
}

# --- Device ---------------------------------------------------------------
stage "waiting for the device"
adbt 120 wait-for-device
adbt 20 devices -l
# The system log is also kept on this machine while the tests run, so that
# its last lines survive an emulator that stops answering.
adb logcat -b main,system,crash,events -v threadtime > "$OUT/logcat-live.txt" 2>&1 &
LOGCAT_PID=$!
watchdog &
WATCHDOG_PID=$!
trap 'kill $WATCHDOG_PID $LOGCAT_PID 2> /dev/null' EXIT
device_report
notice "Host: $(nproc) cpus, $(free -m | awk '/^Mem:/ { print $2 " MB memory, " $7 " MB available" }')"
adbt 20 shell settings put global hide_error_dialogs 1 > /dev/null 2>&1 || true

# A control: if the emulator cannot show and screenshot the Settings app, then
# the environment is broken and the results for Prism Mapper mean nothing.
stage "control: Settings app"
adbt 30 shell am start -a android.settings.SETTINGS > /dev/null 2>&1 || true
sleep 8
screenshot control-settings
note "control: $(echo "$SHOT_STATS" | tr '\n' ' ' | head -c 200)"
adbt 20 shell input keyevent KEYCODE_HOME > /dev/null 2>&1 || true
sleep 2

for variant in $VARIANTS; do
  case "$variant" in
    debug) check_debug debug "$DEBUG_APK" ;;
    sideload) check_sideload ;;
    *) fail "Unknown build '$variant', use debug or sideload." ;;
  esac
done

stage "finished"
if [ "$failures" -gt 0 ]; then
  host_diagnose final
  echo "Android smoke test: $failures problem(s)." | tee "$OUT/summary.txt"
  exit 1
fi
echo "Android smoke test: the builds installed, started, drew their interface and stayed alive." | tee "$OUT/summary.txt"
