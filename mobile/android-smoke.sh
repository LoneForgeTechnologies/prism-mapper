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
#
# A build whose check fails is checked once more (ATTEMPTS=2), because an
# emulator on a shared runner now and then stops an app that is fine: the web
# view draws inside the app's own process, in software. Everything the first
# attempt left is kept in <output-folder>/attempt-1, its problems are reported
# as warnings, and the run says that it needed a second attempt. A build that
# fails every attempt fails the job. Set ATTEMPTS=1 to turn this off.

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
SCREENSHOT_TRIES="${SCREENSHOT_TRIES:-4}"
ATTEMPTS="${ATTEMPTS:-2}"
TITLE="Android emulator test"

mkdir -p "$OUT"
failures=0
# "error" when a failure is final, "warning" while the check can still be
# repeated. Annotations use it as their level.
LEVEL="error"

# Annotation messages are one line, so newlines and percent signs are escaped.
escape() { sed -e 's/%/%25/g' -e 's/\r//g' | awk 'BEGIN { ORS = "%0A" } { print }' | head -c 6000; }
fail() {
  echo "FAIL $*"
  echo "::$LEVEL title=$TITLE::$(echo "$*" | escape)"
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
  excerpt="$(adbt 60 logcat -b main,system,crash,events -d -v brief 2> /dev/null | tr -d '\r' \
    | grep -E "AndroidRuntime|FATAL|Fatal signal|ActivityManager|ActivityTaskManager|$PACKAGE|prismmapper|chromium|Capacitor|WebView|libc  |DEBUG|am_kill|am_low_memory|lmkd|lowmemorykiller" \
    | grep -v -E "^[VD]/" | tail -n 30 | cut -c1-260)"
  {
    echo "$label diagnosis. adb state: $state"
    echo "Processes:"
    echo "$processes"
    echo "Log:"
    echo "$excerpt"
  } > "$OUT/diagnosis-$label.txt"
  echo "::$LEVEL title=$TITLE diagnosis::$(escape < "$OUT/diagnosis-$label.txt")"
}

# Writes what the script is doing now, for the watchdog's timeline.
stage() {
  echo "$*" > "$OUT/stage.txt"
  note "$*"
}

# Runs in the background and records, every two seconds, whether the emulator
# is still attached to adb, whether its process still exists, how much memory
# the guest has left and whether the app is running. The timeline shows
# exactly when, and during which stage, an emulator or the app disappears.
# The fields are separated by "|": time, adb state, emulator process, memory
# available on the runner in MB, memory available in the guest in MB (? when
# the guest does not answer), the app's process (- when there is none), stage.
watchdog() {
  local guest
  while true; do
    guest="$(timeout 10 adb shell "head -n 3 /proc/meminfo | tail -n 1; pidof -s $PACKAGE" 2> /dev/null | tr -d '\r' | tr '\n' ' ' \
      | awk 'NF == 0 { printf "?|?"; next } { printf "%d|%s", $2 / 1024, ($4 == "" ? "-" : $4) }')"
    printf '%s|%s|%s|%s|%s|%s\n' \
      "$(date +%T)" \
      "$(timeout 10 adb get-state 2>&1 | head -n 1 | cut -c1-60)" \
      "$(pgrep -f 'qemu-system' | head -n 1)" \
      "$(free -m | awk '/^Mem:/ { print $7 }')" \
      "${guest:-?|?}" \
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
    echo "Timeline (time, adb state, emulator process, app process, stage; changes only):"
    awk -F'|' '{ key = $2 "|" $3 "|" $6 "|" $7; if (key != last) { print $1 " " $2 " qemu=" $3 " app=" $6 " " $7; last = key } }' "$OUT/watchdog.txt" 2> /dev/null | tail -n 16 | cut -c1-200
    echo "Memory available in the guest in MB (minutes:seconds=MB, last 20 samples, two seconds apart): $(tail -n 20 "$OUT/watchdog.txt" 2> /dev/null | awk -F'|' '{ printf "%s=%s ", substr($1, 4), $5 }')"
    echo "Last watchdog line: $(tail -n 1 "$OUT/watchdog.txt" 2> /dev/null)"
    echo "Emulator process: $(pgrep -af 'qemu-system' | head -n 1 | cut -c1-300)"
    echo "Host kernel messages about killed processes:"
    sudo dmesg 2> /dev/null | grep -i -E "out of memory|oom-kill|killed process|segfault|general protection|invalid opcode|call trace" | tail -n 8 | cut -c1-220
    echo "System log kept on this machine (deaths, kills and crashes):"
    grep -a -E "FATAL|Fatal signal|AndroidRuntime|ANR in|lowmemorykiller|lmkd|am_crash|am_proc_died|am_kill|am_low_memory|am_anr|has died|Killing|tombstone|SIGSEGV" "$OUT/logcat-live.txt" 2> /dev/null | tail -n 14 | cut -c1-230
    echo "Last lines of that log: $(tail -n 3 "$OUT/logcat-live.txt" 2> /dev/null | cut -c1-200 | tr '\n' '|')"
    echo "Guest kernel messages about memory or killed processes:"
    grep -a -i -E "out of memory|oom|killed process|lowmemorykiller|lmkd|segfault|call trace|BUG:" "$OUT/emulator.log" 2> /dev/null | tail -n 6 | cut -c1-230
    echo "Emulator output (errors and warnings, $(grep -a -c "DisplaySurfaceGlContextHelper" "$OUT/emulator.log" 2> /dev/null) context messages left out):"
    grep -a -i -E "error|fatal|panic|segfault|segmentation|oops|killed|abort|crash|failed" "$OUT/emulator.log" 2> /dev/null | grep -a -v -E "DisplaySurfaceGlContextHelper|Failed to restore previous context|binder: " | tail -n 10 | cut -c1-230
    echo "Emulator output (last lines):"
    tail -n 8 "$OUT/emulator.log" 2> /dev/null | cut -c1-230
  } > "$OUT/host-diagnosis-$label.txt"
  echo "::$LEVEL title=$TITLE host diagnosis::$(escape < "$OUT/host-diagnosis-$label.txt")"
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
  report_load "after starting $label"
}

# Takes a screenshot into <name>.png, checks that it is not blank and leaves
# the numbers in $SHOT_STATS. An emulator on a busy runner can need longer than
# the settle time to draw the first page, so a blank screenshot is taken again,
# up to SCREENSHOT_TRIES times, eight seconds apart. The last one decides.
SHOT_STATS=""
screenshot() {
  local name="$1" file="$OUT/$1.png" try drawn="no"
  for try in $(seq 1 "$SCREENSHOT_TRIES"); do
    timeout 60 adb exec-out screencap -p > "$file" 2> "$OUT/screencap-$name.txt"
    if SHOT_STATS="$(node "$HERE/png-stats.mjs" "$file" 2>&1)"; then
      drawn="yes"
      break
    fi
    note "$name: attempt $try of $SCREENSHOT_TRIES shows nothing yet: $(echo "$SHOT_STATS" | tr '\n' ' ' | head -c 200)"
    if [ "$try" -lt "$SCREENSHOT_TRIES" ]; then sleep 8; fi
  done
  if [ "$drawn" = "yes" ]; then
    note "$name${try:+ (attempt $try)}: $(echo "$SHOT_STATS" | tr '\n' ' ')"
  else
    echo "$SHOT_STATS"
    fail "$name: the screenshot looks blank or is missing after $SCREENSHOT_TRIES attempts, so nothing was drawn. $(echo "$SHOT_STATS" | tr '\n' ' ' | head -c 300) screencap said: $(head -c 300 "$OUT/screencap-$name.txt") file starts with: $(head -c 80 "$file" | tr -c '[:print:]' '.')"
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

# Checks one build.
run_variant() {
  case "$1" in
    debug) check_debug debug "$DEBUG_APK" ;;
    sideload) check_sideload ;;
    *) fail "Unknown build '$1', use debug or sideload." ;;
  esac
}

# Moves what an attempt left for one build into attempt-<number>, so that the
# next attempt starts clean and the evidence stays.
#   keep_attempt <build> <number>
keep_attempt() {
  local variant="$1" dir="$OUT/attempt-$2" file
  local files=("$OUT"/*"$variant"*)
  if [ "$variant" = debug ]; then files+=("$OUT/webview-probe.json" "$OUT/webview-crash.json"); fi
  mkdir -p "$dir"
  for file in "${files[@]}"; do
    if [ -f "$file" ]; then mv "$file" "$dir/"; fi
  done
}

# What the guest is busy with, as one notice: the load averages and the
# processes that use the most processor time. The Google apps on the system
# images keep the guest busy for a long time after the first boot, which is
# worth knowing when an app or a screenshot is slow.
#   report_load <when>
report_load() {
  local load busiest
  load="$(adbt 10 shell cat /proc/loadavg 2> /dev/null | tr -d '\r' | awk '{ print $1 ", " $2 ", " $3 }')"
  busiest="$(adbt 30 shell top -b -n 2 -d 2 -m 6 2> /dev/null | tr -d '\r' | tail -n 7 | cut -c1-120 | tr '\n' '|')"
  notice "Load $1: ${load:-unknown}. Busiest: ${busiest:-unknown}"
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
report_load "at the start"

# A control: if the emulator cannot show and screenshot the Settings app, then
# the environment is broken and the results for Prism Mapper mean nothing.
stage "control: Settings app"
adbt 30 shell am start -a android.settings.SETTINGS > /dev/null 2>&1 || true
sleep 8
screenshot control-settings
note "control: $(echo "$SHOT_STATS" | tr '\n' ' ' | head -c 200)"
adbt 20 shell input keyevent KEYCODE_HOME > /dev/null 2>&1 || true
sleep 2

# Builds that needed a second attempt, for the summary.
retried=""
for variant in $VARIANTS; do
  attempt=1
  while true; do
    # Failures of an attempt that can be repeated are only warnings.
    if [ "$attempt" -lt "$ATTEMPTS" ]; then LEVEL="warning"; else LEVEL="error"; fi
    failures_before=$failures
    run_variant "$variant"
    if [ "$failures" -eq "$failures_before" ] || [ "$attempt" -ge "$ATTEMPTS" ]; then break; fi
    keep_attempt "$variant" "$attempt"
    failures=$failures_before
    LEVEL="error"
    if [ "$(adbt 20 get-state 2> /dev/null | tr -d '\r')" != "device" ]; then
      fail "$variant: the emulator no longer answers, so the check cannot be repeated."
      break
    fi
    echo "::warning title=$TITLE::$variant: attempt $attempt of $ATTEMPTS failed, see the warnings above and attempt-$attempt in the artifact. Trying once more."
    retried="$retried $variant"
    adbt 30 shell am force-stop "$PACKAGE" > /dev/null 2>&1 || true
    sleep 15
    attempt=$((attempt + 1))
  done
done
LEVEL="error"

stage "finished"
if [ "$failures" -gt 0 ]; then
  host_diagnose final
  echo "Android smoke test: $failures problem(s)." | tee "$OUT/summary.txt"
  exit 1
fi
if [ -n "$retried" ]; then
  echo "::warning title=$TITLE::Passed, but only at the second attempt for:$retried. The first attempt is kept in the attempt-1 folder of the android-smoke artifact."
  echo "Android smoke test: passed, but a second attempt was needed for:$retried." | tee "$OUT/summary.txt"
else
  echo "Android smoke test: the builds installed, started, drew their interface and stayed alive." | tee "$OUT/summary.txt"
fi
