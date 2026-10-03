#!/usr/bin/env bash
# Installs the iOS simulator build on an iPhone and an iPad simulator and
# checks that the app starts. Run by the "iOS simulator test" job in
# .github/workflows/mobile.yml on a macOS runner.
#
#   bash mobile/ios-smoke.sh <path of App.app> <output-folder> [iPhone|iPad|both]
#
# For each simulator the script boots it, installs and launches the app,
# waits, takes a screenshot, checks that the screenshot is not blank (the dark
# launch screen alone counts as blank), checks that the app process is still
# alive and that macOS wrote no crash report for it. Every command has a time
# limit, so a simulator that does not boot fails the check instead of hanging
# the job. Every failed check is reported, then the script exits with 1.

set -u

APP="${1:?path of the simulator App.app}"
OUT="${2:?folder for screenshots and logs}"
KINDS="${3:-both}"
BUNDLE_ID="org.prismmapper.mobile"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTLE_SECONDS="${SETTLE_SECONDS:-20}"
BOOT_SECONDS="${BOOT_SECONDS:-420}"
REPORTS="$HOME/Library/Logs/DiagnosticReports"

mkdir -p "$OUT"
MARKER="$OUT/.started"
touch "$MARKER"
failures=0
fail() {
  echo "FAIL $*"
  echo "::error title=iOS simulator test::$*"
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

check_device() {
  local kind="$1" preferred="$2" picked udid name runtime started=$SECONDS
  if ! picked="$(pick_device "$kind" "$preferred")"; then
    fail "$kind: no $kind simulator is installed on this runner."
    return
  fi
  IFS=$'\t' read -r udid name runtime <<< "$picked"
  note "$kind: using $name ($runtime), $udid."

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
  local launched
  if launched="$(with_timeout 120 xcrun simctl launch "$udid" "$BUNDLE_ID" 2>&1)"; then
    echo "$launched" | tee "$OUT/launch-$kind.txt"
  else
    echo "$launched" | tee "$OUT/launch-$kind.txt"
    fail "$kind: the app could not be launched on $name."
  fi
  note "$kind: waiting $SETTLE_SECONDS seconds for the first frames."
  sleep "$SETTLE_SECONDS"

  # A simulator that has only just booted sometimes cannot take a screenshot
  # yet, so try a few times and keep what simctl said.
  local attempt
  for attempt in 1 2 3 4; do
    if with_timeout 90 xcrun simctl io "$udid" screenshot "$OUT/$kind.png" > "$OUT/screenshot-$kind.txt" 2>&1 && [ -s "$OUT/$kind.png" ]; then
      break
    fi
    note "$kind: screenshot attempt $attempt failed: $(tr '\n' ' ' < "$OUT/screenshot-$kind.txt" | head -c 300)"
    sleep 10
  done
  local stats
  if stats="$(node "$HERE/png-stats.mjs" "$OUT/$kind.png" 2>&1)"; then
    note "$kind screenshot: $stats"
  else
    echo "$stats"
    fail "$kind: the screenshot looks blank or is missing, so the app did not draw. $(echo "$stats" | tr '\n' ' ' | head -c 300) simctl said: $(tr '\n' ' ' < "$OUT/screenshot-$kind.txt" | head -c 300)"
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
  echo "::notice title=iOS simulator test::$kind ($name, $runtime): booted, installed, launched, process ${pid:-none}, $((SECONDS - started)) seconds in total. Screenshot: $(echo "$stats" | tr '\n' ' ' | head -c 400)"
}

xcrun simctl list devices available > "$OUT/simulators.txt" 2>&1 || true
case "$KINDS" in
  iPhone) check_device iPhone "iPhone 17" ;;
  iPad) check_device iPad "iPad Pro 11-inch (M5)" ;;
  both)
    check_device iPhone "iPhone 17"
    check_device iPad "iPad Pro 11-inch (M5)"
    ;;
  *) fail "Unknown device kind '$KINDS', use iPhone, iPad or both." ;;
esac

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
echo "iOS smoke test ($KINDS): the app started, drew its interface and stayed alive." | tee "$OUT/summary.txt"
