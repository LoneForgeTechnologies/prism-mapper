#!/usr/bin/env bash
# Installs the iOS simulator build on an iPhone and an iPad simulator and
# checks that the app starts. Run by the "iOS simulator test" job in
# .github/workflows/mobile.yml on a macOS runner.
#
#   bash mobile/ios-smoke.sh <path of App.app> <output-folder> [iPhone|iPad|both]
#
# For each simulator the script boots it, installs and launches the app,
# waits, takes screenshots until one is not blank (the dark launch screen alone
# counts as blank, and a slow simulator gets up to ten tries), checks that the
# app process is still alive and that macOS wrote no crash report for it. Every
# command has a time limit, so a simulator that does not boot fails the check
# instead of hanging the job. Every failed check is reported, then the script
# exits with 1.
#
# A simulator on a shared runner is not always steady: it can boot slowly, refuse
# to launch an app right after it booted, or show the first page late. So the
# launch is tried three times, and a device whose check fails is checked once
# more on a freshly erased simulator (ATTEMPTS=2). The first attempt is kept in
# <output-folder>/attempt-1, its problems are reported as warnings, and the run
# says that it needed a second attempt. A device that fails every attempt fails
# the job. Set ATTEMPTS=1 to turn this off.

set -u

APP="${1:?path of the simulator App.app}"
OUT="${2:?folder for screenshots and logs}"
KINDS="${3:-both}"
BUNDLE_ID="org.prismmapper.mobile"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTLE_SECONDS="${SETTLE_SECONDS:-20}"
SCREENSHOT_TRIES="${SCREENSHOT_TRIES:-10}"
ATTEMPTS="${ATTEMPTS:-2}"
BOOT_SECONDS="${BOOT_SECONDS:-420}"
REPORTS="$HOME/Library/Logs/DiagnosticReports"

mkdir -p "$OUT"
MARKER="$OUT/.started"
touch "$MARKER"
failures=0
# "error" when a failure is final, "warning" while the check can still be
# repeated. Annotations use it as their level.
LEVEL="error"
fail() {
  echo "FAIL $*"
  echo "::$LEVEL title=iOS simulator test::$*"
  failures=$((failures + 1))
}
note() { echo "[ios-smoke] $*"; }

# macOS has no timeout command, but perl is always there.
#   with_timeout <seconds> <command> [arguments...]
with_timeout() {
  local seconds="$1"
  shift
  perl -e 'alarm shift @ARGV; exec @ARGV or die "cannot run $ARGV[0]: $!"' "$seconds" "$@"
}

# Prints "<id><TAB><name><TAB><runtime>" of an iOS simulator of the newest
# runtime whose name is the preferred one, or else starts with the given kind
# ("iPhone" or "iPad").
pick_device() {
  xcrun simctl list devices available -j | node -e '
    const [kind, preferred] = process.argv.slice(1);
    const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const runtimes = Object.keys(data.devices)
      .filter((id) => id.includes(".iOS-"))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!runtimes.length) process.exit(1);
    const devices = data.devices[runtimes[runtimes.length - 1]];
    const found =
      devices.find((device) => device.name === preferred) ??
      devices.find((device) => device.name.startsWith(kind));
    if (!found) process.exit(1);
    console.log(`${found.udid}\t${found.name}\t${runtimes[runtimes.length - 1].split(".").pop()}`);
  ' "$1" "$2"
}

app_pid() {
  xcrun simctl spawn "$1" launchctl list 2> /dev/null \
    | awk -v label="UIKitApplication:$BUNDLE_ID" 'index($3, label) == 1 && $1 != "-" { print $1; exit }'
}

#   check_device <iPhone|iPad> <preferred simulator name> <attempt number>
check_device() {
  local kind="$1" preferred="$2" attempt_number="$3" picked udid name runtime started=$SECONDS
  if ! picked="$(pick_device "$kind" "$preferred")"; then
    fail "$kind: no $kind simulator is installed on this runner."
    return
  fi
  IFS=$'\t' read -r udid name runtime <<< "$picked"
  note "$kind: using $name ($runtime), $udid."

  # A clean start: nothing left running from an earlier attempt, and the second
  # attempt begins with an erased simulator.
  xcrun simctl shutdown "$udid" 2> /dev/null || true
  if [ "$attempt_number" -gt 1 ]; then xcrun simctl erase "$udid" 2> /dev/null || true; fi
  xcrun simctl boot "$udid" 2> /dev/null || true
  if ! with_timeout "$BOOT_SECONDS" xcrun simctl bootstatus "$udid" -b > "$OUT/boot-$kind.txt" 2>&1; then
    fail "$kind: $name did not finish booting within $BOOT_SECONDS seconds (see boot-$kind.txt)."
    tail -n 5 "$OUT/boot-$kind.txt"
    xcrun simctl shutdown "$udid" 2> /dev/null || true
    return
  fi
  note "$kind: booted after $((SECONDS - started)) seconds."
  xcrun simctl status_bar "$udid" override --time "9:41" > /dev/null 2>&1 || true

  if ! with_timeout 180 xcrun simctl install "$udid" "$APP"; then
    fail "$kind: the app could not be installed on $name."
    xcrun simctl shutdown "$udid" 2> /dev/null || true
    return
  fi
  # The first launch right after the boot is sometimes refused, so try three
  # times and keep what simctl said.
  local launched="" launch_ok="no" tries
  for tries in 1 2 3; do
    if launched="$(with_timeout 120 xcrun simctl launch "$udid" "$BUNDLE_ID" 2>&1)"; then
      launch_ok="yes"
      break
    fi
    note "$kind: launch attempt $tries failed: $(echo "$launched" | tr '\n' ' ' | head -c 300)"
    sleep 15
  done
  echo "$launched" | tee "$OUT/launch-$kind.txt"
  if [ "$launch_ok" != "yes" ]; then
    fail "$kind: the app could not be launched on $name after 3 attempts: $(echo "$launched" | tr '\n' ' ' | head -c 300)"
    # Nothing to wait for. Keep a picture of what the simulator shows.
    with_timeout 60 xcrun simctl io "$udid" screenshot "$OUT/$kind.png" > /dev/null 2>&1 || true
    xcrun simctl spawn "$udid" launchctl list > "$OUT/launchctl-$kind.txt" 2>&1 || true
    xcrun simctl shutdown "$udid" 2> /dev/null || true
    return
  fi
  note "$kind: waiting $SETTLE_SECONDS seconds for the first frames."
  sleep "$SETTLE_SECONDS"

  # A simulator that has only just booted sometimes cannot take a screenshot
  # yet, and a simulator on a busy runner can need much longer than the settle
  # time to show the first page. So take screenshots, ten seconds apart, until
  # one shows something other than the dark launch screen, and say how many it
  # took. The last answer decides.
  local attempt stats="" drawn="no"
  for attempt in $(seq 1 "$SCREENSHOT_TRIES"); do
    if with_timeout 90 xcrun simctl io "$udid" screenshot "$OUT/$kind.png" > "$OUT/screenshot-$kind.txt" 2>&1 && [ -s "$OUT/$kind.png" ]; then
      if stats="$(node "$HERE/png-stats.mjs" "$OUT/$kind.png" 2>&1)"; then
        drawn="yes"
        break
      fi
      note "$kind: screenshot attempt $attempt shows nothing yet: $(echo "$stats" | tr '\n' ' ' | head -c 200)"
    else
      note "$kind: screenshot attempt $attempt failed: $(tr '\n' ' ' < "$OUT/screenshot-$kind.txt" | head -c 300)"
    fi
    sleep 10
  done
  if [ "$drawn" = "yes" ]; then
    note "$kind screenshot (attempt $attempt): $stats"
  else
    echo "$stats"
    fail "$kind: the screenshot looks blank or is missing after $SCREENSHOT_TRIES attempts, so the app did not draw. $(echo "$stats" | tr '\n' ' ' | head -c 300) simctl said: $(tr '\n' ' ' < "$OUT/screenshot-$kind.txt" | head -c 300)"
  fi

  local pid
  pid="$(app_pid "$udid")"
  if [ -z "$pid" ]; then
    fail "$kind: the app is not running any more, it crashed or exited."
  else
    note "$kind: still running as process $pid."
  fi

  xcrun simctl spawn "$udid" launchctl list > "$OUT/launchctl-$kind.txt" 2>&1 || true
  xcrun simctl shutdown "$udid" 2> /dev/null || true
  echo "::notice title=iOS simulator test::$kind ($name, $runtime): booted, installed, launched, process ${pid:-none}, $((SECONDS - started)) seconds in total, screenshot attempt $attempt. Screenshot: $(echo "$stats" | tr '\n' ' ' | head -c 400)"
}

xcrun simctl list devices available > "$OUT/simulators.txt" 2>&1 || true

# Checks one device kind.
run_device() {
  case "$1" in
    iPhone) check_device iPhone "iPhone 17" "$2" ;;
    iPad) check_device iPad "iPad Pro 11-inch (M5)" "$2" ;;
  esac
}

# Moves what an attempt left for one device kind into attempt-<number>, so that
# the next attempt starts clean and the evidence stays.
#   keep_attempt <iPhone|iPad> <number>
keep_attempt() {
  local dir="$OUT/attempt-$2" file
  mkdir -p "$dir"
  for file in "$OUT"/*"$1"*; do
    if [ -f "$file" ]; then mv "$file" "$dir/"; fi
  done
}

case "$KINDS" in
  iPhone) kinds="iPhone" ;;
  iPad) kinds="iPad" ;;
  both) kinds="iPhone iPad" ;;
  *)
    kinds=""
    fail "Unknown device kind '$KINDS', use iPhone, iPad or both."
    ;;
esac

# Device kinds that needed a second attempt, for the summary.
retried=""
for kind in $kinds; do
  attempt=1
  while true; do
    # Failures of an attempt that can be repeated are only warnings.
    if [ "$attempt" -lt "$ATTEMPTS" ]; then LEVEL="warning"; else LEVEL="error"; fi
    failures_before=$failures
    run_device "$kind" "$attempt"
    if [ "$failures" -eq "$failures_before" ] || [ "$attempt" -ge "$ATTEMPTS" ]; then break; fi
    keep_attempt "$kind" "$attempt"
    failures=$failures_before
    LEVEL="error"
    echo "::warning title=iOS simulator test::$kind: attempt $attempt of $ATTEMPTS failed, see the warnings above and attempt-$attempt in the artifact. Trying once more."
    retried="$retried $kind"
    attempt=$((attempt + 1))
  done
done
LEVEL="error"

# macOS writes a report next to the host's other logs when an app crashes in
# a simulator. Any report that mentions the bundle id and is newer than this
# script is a crash.
crashes=0
if [ -d "$REPORTS" ]; then
  while IFS= read -r report; do
    if grep -q "$BUNDLE_ID" "$report" 2> /dev/null; then
      crashes=$((crashes + 1))
      cp "$report" "$OUT/" 2> /dev/null || true
      fail "The app left a crash report: $(basename "$report")."
    fi
  done < <(find "$REPORTS" -type f \( -name '*.ips' -o -name '*.crash' \) -newer "$MARKER" 2> /dev/null)
fi
note "Crash reports for the app: $crashes."

rm -f "$MARKER"
if [ "$failures" -gt 0 ]; then
  echo "iOS smoke test: $failures problem(s)." | tee "$OUT/summary.txt"
  exit 1
fi
if [ -n "$retried" ]; then
  echo "::warning title=iOS simulator test::Passed, but only at the second attempt for:$retried. The first attempt is kept in the attempt-1 folder of the ios-smoke artifact."
  echo "iOS smoke test ($KINDS): passed, but a second attempt was needed for:$retried." | tee "$OUT/summary.txt"
else
  echo "iOS smoke test ($KINDS): the app started, drew its interface and stayed alive." | tee "$OUT/summary.txt"
fi
