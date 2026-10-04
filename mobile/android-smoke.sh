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
# only gets the outside checks: it starts, stays alive, shows something,
# survives a rotation and survives Google Play services crashing and being
# stopped, also at the moment it is starting (mobile/watch-providers.sh). Both
# get a screenshot and a filtered system log. Every check that fails is
# reported, then the script exits with 1.
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
# 0 when a failure of the current attempt is not worth repeating, because it
# was caused on purpose and would happen again (see play_services_aftermath).
RETRY_OK=1

# Annotation messages are one line, so newlines and percent signs are escaped.
escape() { sed -e 's/%/%25/g' -e 's/\r//g' | awk 'BEGIN { ORS = "%0A" } { print }' | head -c 6000; }
fail() {
  echo "FAIL $*"
  echo "::$LEVEL title=$TITLE::$(echo "$*" | escape)"
  failures=$((failures + 1))
}
note() { echo "[android-smoke] $*"; }
notice() { echo "::notice title=$TITLE::$(echo "$*" | tr '\n' ' ' | head -c 2500)"; }

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
  # One annotation for both: GitHub shows no more than ten of each kind per step.
  notice "Device: $(cat "$OUT/device.txt") Host: $(nproc) cpus, $(free -m | awk '/^Mem:/ { print $2 " MB memory, " $7 " MB available" }')"
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

# Turns the output of mobile/watch-providers.sh into one short line: how many
# questions were asked, and every provider the app was connected to, with its
# highest number of stable connections and when it was first seen and when it
# was gone. Connections to Google Play services are marked, because Android
# stops an app that holds a stable one when the process of the provider dies.
summarize_watch() {
  awk '
    /^t=[0-9]+ CRASHED / { crashed = substr($1, 3) + 0; next }
    /^t=[0-9]+ / {
      t = substr($1, 3) + 0
      line = $0
      sub(/^t=[0-9]+ ?/, "", line)
      delete now
      n = split(line, entries, ";")
      for (i = 1; i <= n; i++) {
        if (entries[i] == "") continue
        split(entries[i], f, " ")
        key = f[1]
        stable = f[2]
        sub(/^s/, "", stable)
        sub(/\/.*/, "", stable)
        now[key] = 1
        if (!(key in first)) { first[key] = t; order[++m] = key }
        if (stable + 0 > top[key]) top[key] = stable + 0
        gone[key] = ""
      }
      for (i = 1; i <= m; i++) { k = order[i]; if (!(k in now) && gone[k] == "") gone[k] = t }
    }
    /^samples=/ { samples = substr($0, 9) }
    /^probe:/ { probe = $0 }
    END {
      printf "%s questions. ", (samples == "" ? "?" : samples)
      if (m == 0) printf "No connection was recognised. %s ", substr(probe, 1, 600)
      for (i = 1; i <= m; i++) {
        k = order[i]
        printf "%s%s with %d stable, from %ds%s; ", (k ~ /^com[.]google[.]android[.]gms\// ? "PLAY SERVICES " : ""), k, top[k], first[k], (gone[k] != "" ? " until " gone[k] "s" : " to the end")
      }
      if (crashed != "") printf "Play services were crashed at %ds while the app held a stable connection to them.", crashed
    }'
}

# Watches the content providers the app connects to while it starts, for the
# given number of seconds. mobile/watch-providers.sh runs on the device, so that
# it can ask as often as the system answers: a connection to a provider of
# Google Play services exists only for the moments an emoji font is fetched,
# and that is when the app is exposed. The summary is left in $WATCH_SUMMARY.
# With "crash", the persistent process of Google Play services is crashed the
# first moment the app holds a stable connection to one of its providers, and
# the app must live on.
#   watch_providers <label> <seconds> [crash]
WATCH_SUMMARY=""
watch_providers() {
  local label="$1" seconds="$2" crash="${3:-}" before output started left
  WATCH_SUMMARY=""
  before="$(app_pid)"
  started=$SECONDS
  if ! adbt 60 push "$HERE/watch-providers.sh" /data/local/tmp/watch-providers.sh > /dev/null 2>&1; then
    note "$label: the provider watcher could not be copied to the device, so the app is only given time to start."
    sleep "$seconds"
    return
  fi
  output="$(adbt $((seconds + 90)) shell sh /data/local/tmp/watch-providers.sh "$PACKAGE" "$seconds" $crash 2> /dev/null | tr -d '\r')"
  echo "$output" > "$OUT/providers-start-$label.txt"
  WATCH_SUMMARY="$(summarize_watch <<< "$output")"
  note "$label: content providers while starting: $WATCH_SUMMARY"
  left=$((seconds - (SECONDS - started)))
  if [ "$left" -gt 0 ]; then sleep "$left"; fi
  if grep -q "^t=[0-9]* CRASHED " <<< "$output" && [ -n "$before" ]; then
    play_services_aftermath "$label" "$before" "the persistent process of Google Play services crashed while the app held a stable connection to one of its providers" || true
  fi
}

# Starts the app from a cold start and waits until it should have drawn. During
# the wait it watches which content providers the app connects to (see
# watch_providers). With "crash" as the second argument, Google Play services
# are crashed at the worst moment for the app.
#   launch <label> [crash]
launch() {
  local label="$1" crash="${2:-}"
  adbt 30 shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS > /dev/null 2>&1 || true
  adbt 30 logcat -c
  adbt 180 shell am start -W -n "$PACKAGE/.MainActivity" 2>&1 | tr -d '\r' | tee "$OUT/am-start-$label.txt"
  if ! grep -q "Status: ok" "$OUT/am-start-$label.txt"; then
    fail "$label: the activity did not start: $(tr '\n' ' ' < "$OUT/am-start-$label.txt" | head -c 300)"
  fi
  note "$label: waiting $SETTLE_SECONDS seconds for the first frames."
  watch_providers "$label" "$SETTLE_SECONDS" "$crash"
  report_load "after starting $label" "$WATCH_SUMMARY"
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

# The content providers this app is connected to. Android stops an app whose
# connection to a provider is cut because the process of the provider died, so
# a connection to Google Play services can take the app down with it. Every
# provider record in the dump lists the apps that are connected to it, with
# the number of stable (s) and unstable (u) connections.
#   provider_report <label>
provider_report() {
  local label="$1" dump held
  dump="$(adbt 90 shell dumpsys activity providers 2> /dev/null | tr -d '\r')"
  echo "$dump" > "$OUT/providers-$label.txt"
  held="$(awk -v pkg="$PACKAGE" '
    /ContentProviderRecord\{/ { record = $0; sub(/^ +/, "", record) }
    /->/ && index($0, pkg) { line = $0; sub(/^ +/, "", line); print record "  <-  " line }
  ' <<< "$dump" | cut -c1-240 | head -n 8 | tr '\n' '|')"
  notice "Providers the app is connected to ($label): ${held:-none found}"
}

# Did the app live on after something happened to Google Play services? It
# must still run in the process it had before, and the system log says why if
# Android stopped it.
#   play_services_aftermath <label> <app process> <what happened>
play_services_aftermath() {
  local label="$1" before="$2" what="$3" after killed
  after="$(app_pid)"
  killed="$(adbt 60 logcat -b events,system -d -v brief 2> /dev/null | tr -d '\r' | grep -E "am_kill|Killing" | grep "$PACKAGE" | tail -n 3 | cut -c1-300)"
  if [ -z "$after" ] || [ "$after" != "$before" ]; then
    # Play services were crashed on purpose, so this is not a flaky emulator:
    # the same thing would happen again, and the build is not given a second try.
    LEVEL="error"
    RETRY_OK=0
    if [ -z "$after" ]; then
      fail "$label: the app was stopped when $what. ${killed:-No kill was logged.}"
    else
      fail "$label: the app process changed from $before to $after when $what. ${killed:-No kill was logged.}"
    fi
    return 1
  fi
  note "$label: the app stayed alive (process $after) when $what."
}

# Google Play services restarts now and then: an update, a crash, a stop by the
# system when memory is short, and often on the emulator images. Android stops
# every app that is connected to one of its content providers when its process
# dies, and a stopped app is a dark projector. launch() has already crashed
# Play services at the moment the app was starting, which is the only time the
# app should be connected to them. This check comes later, when the app has
# settled: crash the persistent process of Play services, the one a crash
# takes down with all of its providers, then stop the rest of it, and check
# after each that the app lives on in the same process. (am force-stop alone
# would not do, it spares persistent processes.)
#   check_play_services_restart <label> <app process>
check_play_services_restart() {
  local label="$1" before="$2" persistent restarted
  if ! adbt 30 shell pm list packages com.google.android.gms 2> /dev/null | tr -d '\r' | grep -q "^package:com.google.android.gms$"; then
    note "$label: this image has no Google Play services, so there is nothing to restart."
    return
  fi
  if [ -z "$before" ]; then return; fi
  stage "$label: crash Google Play services"
  provider_report "$label"
  persistent="$(adbt 30 shell pidof com.google.android.gms.persistent 2> /dev/null | tr -d '\r' | awk '{ print $1 }')"
  # A clean log, so that only what the crash caused is read afterwards.
  adbt 30 logcat -b all -c > /dev/null 2>&1 || true
  if [ -n "$persistent" ]; then
    adbt 30 shell am crash "$persistent" > /dev/null 2>&1 || true
    sleep 10
    restarted="$(adbt 30 shell pidof com.google.android.gms.persistent 2> /dev/null | tr -d '\r' | awk '{ print $1 }')"
    if [ "$restarted" = "$persistent" ]; then
      echo "::warning title=$TITLE::$label: the persistent process of Google Play services (process $persistent) is still the same after am crash, so the crash was not tested."
    else
      note "$label: the persistent process of Google Play services changed from $persistent to ${restarted:-none}."
    fi
    play_services_aftermath "$label" "$before" "the persistent process of Google Play services crashed" || return
  else
    echo "::warning title=$TITLE::$label: the persistent process of Google Play services is not running, so there is nothing to crash."
  fi
  adbt 30 shell am force-stop com.google.android.gms > /dev/null 2>&1 || true
  sleep 15
  play_services_aftermath "$label" "$before" "Google Play services was stopped" || return
  screenshot "$label-after-play-services"
}

# --- Diagnosis: what talks to the font provider of Google Play services? ------
# Only with DIAGNOSE_CLIENT=1 (the workflow sets it for one emulator leg). It
# changes nothing that is tested. It adds warnings (not notices, so that they do
# not use up the ten notices a step can show) that say which code of the app, or
# of its web view, connected to a provider of Google Play services while the
# app was starting.
DIAGNOSE_CLIENT="${DIAGNOSE_CLIENT:-}"

# Android can record the stack of every binder call that every process makes.
trace_ipc_start() {
  [ -n "$DIAGNOSE_CLIENT" ] || return 0
  note "binder tracing: $(adbt 30 shell am trace-ipc start 2>&1 | tr -d '\r' | tr '\n' ' ' | head -c 200)"
}

# The recorded calls whose stack matches a pattern, the most frequent first,
# each as "<count> x <frame> < <frame> ...", from the call upwards.
#   ipc_calls <pattern> <how many>
ipc_calls() {
  awk -v pattern="$1" '
    BEGIN { RS = "" }
    $0 ~ pattern {
      n = split($0, l, "\n")
      count = l[1]
      sub(/^Count: */, "", count)
      frames = ""
      shown = 0
      for (i = 3; i <= n && shown < 18; i++) {
        f = l[i]
        sub(/^[ \t]*at /, "", f)
        sub(/\(.*$/, "", f)
        if (f == "" || f ~ /^android[.]os[.]Binder/ || f ~ /Stub[$]Proxy/) continue
        frames = frames " < " f
        shown++
      }
      print count + 0 " x" frames
    }' "$OUT/ipc-trace.txt" | sort -rn | head -n "$2" | cut -c1-560
}

# Stops the recording and reports the calls that have to do with fonts, the
# calls that acquire a content provider from code of the app or its web view,
# and the calls that open a file from a provider (a stable connection to the
# provider lasts until that file is closed).
trace_ipc_report() {
  [ -n "$DIAGNOSE_CLIENT" ] || return 0
  local answer fonts acquired opened total
  answer="$(adbt 120 shell am trace-ipc stop --dump-file /data/local/tmp/ipc-trace.txt 2>&1 | tr -d '\r' | tr '\n' ' ' | head -c 300)"
  sleep 2
  if ! adbt 120 pull /data/local/tmp/ipc-trace.txt "$OUT/ipc-trace.txt" > /dev/null 2>&1 || [ ! -s "$OUT/ipc-trace.txt" ]; then
    echo "::warning title=$TITLE binder trace::There is no trace. am said: $answer"
    return
  fi
  total="$(grep -c '^Count: ' "$OUT/ipc-trace.txt")"
  fonts="$(ipc_calls '[Ff]ont|[Ee]moji' 10)"
  acquired="$(ipc_calls 'getContentProvider' 400 | grep -E 'chromium|capacitor|getcapacitor|prismmapper|webkit|androidx|ContentResolver' | head -n 14)"
  opened="$(ipc_calls 'openFile|openAssetFile|openTypedAssetFile' 10)"
  echo "::warning title=$TITLE binder trace (fonts)::$total distinct stacks were recorded. am said: $answer%0AStacks that mention fonts or emoji:%0A$(escape <<< "${fonts:-none}")"
  echo "::warning title=$TITLE binder trace (providers acquired)::$(escape <<< "${acquired:-none}")"
  echo "::warning title=$TITLE binder trace (files opened)::$(escape <<< "${opened:-none}")"
}

# Does the code of the web view know about the font provider of Google Play
# services? Looks for its name in the web view that the emulator uses.
webview_report() {
  [ -n "$DIAGNOSE_CLIENT" ] || return 0
  local info package path n=0 hits=""
  info="$(adbt 30 shell dumpsys webviewupdate 2> /dev/null | tr -d '\r' | grep -i "Current WebView package" | head -n 1 | cut -c1-200)"
  package="$(sed -n 's/.*(\([A-Za-z0-9_.]*\), .*/\1/p' <<< "$info")"
  : "${package:=com.google.android.webview}"
  for path in $(adbt 30 shell pm path "$package" 2> /dev/null | tr -d '\r' | sed -n 's/^package://p'); do
    n=$((n + 1))
    adbt 300 pull "$path" "$OUT/webview-$n.apk" > /dev/null 2>&1 || continue
    hits="$hits $(basename "$path") ($(du -h "$OUT/webview-$n.apk" | cut -f1)): $(unzip -p "$OUT/webview-$n.apk" 'classes*.dex' 2> /dev/null \
      | grep -a -o -i -E '[A-Za-z0-9_/.$]*(gms[./]fonts|FontsContract|FontRequest|DownloadableFont|AndroidFont|FontLookup)[A-Za-z0-9_/.$]*' \
      | sort | uniq -c | sort -rn | head -n 12 | awk '{ printf "%s x%s, ", $2, $1 }')"
    rm -f "$OUT/webview-$n.apk"
  done
  echo "::warning title=$TITLE web view code::${info:-no WebView package found}.${hits:- No file could be read.}"
}

# The lines of the system log that mention fonts or emoji.
font_log_report() {
  [ -n "$DIAGNOSE_CLIENT" ] || return 0
  local lines
  lines="$(adbt 90 logcat -b all -d -v threadtime 2> /dev/null | tr -d '\r' | grep -i -E 'font|emoji' | cut -c1-230 | head -n 25)"
  echo "::warning title=$TITLE log lines about fonts::$(escape <<< "${lines:-none}")"
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
  trace_ipc_start
  launch "$label"
  trace_ipc_report
  font_log_report
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
  launch sideload crash
  if [ "$RETRY_OK" = 0 ]; then
    # Play services were crashed on purpose while the app was starting, and the
    # app did not live through it. The rest of the checks would only repeat that.
    diagnose sideload
    return
  fi
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
  check_play_services_restart sideload "$before"
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
  notice "Load $1: ${load:-unknown}. Busiest: ${busiest:-unknown}${2:+ Content providers while starting: $2}"
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
adbt 20 shell settings put global hide_error_dialogs 1 > /dev/null 2>&1 || true
report_load "at the start"
webview_report

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
    RETRY_OK=1
    failures_before=$failures
    run_variant "$variant"
    if [ "$failures" -eq "$failures_before" ] || [ "$attempt" -ge "$ATTEMPTS" ] || [ "$RETRY_OK" = 0 ]; then break; fi
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
