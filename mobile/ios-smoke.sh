#!/usr/bin/env bash
# Installs the iOS simulator build on an iPhone and an iPad simulator and
# checks that the app starts. Run by the iOS job in .github/workflows/mobile.yml
# on a macOS runner, after xcodebuild has produced the simulator build.
#
#   bash mobile/ios-smoke.sh <path of App.app> <output-folder>
#
# For each simulator the script boots it, installs and launches the app,
# waits, takes a screenshot, checks that the screenshot is not blank (the dark
# launch screen alone counts as blank), checks that the app process is still
# alive and that macOS wrote no crash report for it. Every failed check is
# reported, then the script exits with 1.

set -u

APP="${1:?path of the simulator App.app}"
OUT="${2:?folder for screenshots and logs}"
BUNDLE_ID="org.prismmapper.mobile"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTLE_SECONDS="${SETTLE_SECONDS:-20}"
REPORTS="$HOME/Library/Logs/DiagnosticReports"

mkdir -p "$OUT"
MARKER="$OUT/.started"
touch "$MARKER"
failures=0
fail() {
  echo "::error::$*"
  failures=$((failures + 1))
}
note() { echo "[ios-smoke] $*"; }

# Prints the id of an iOS simulator of the newest runtime whose name is the
# preferred one, or else starts with the given kind ("iPhone" or "iPad").
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
  local kind="$1" preferred="$2" picked udid name runtime
  if ! picked="$(pick_device "$kind" "$preferred")"; then
    fail "$kind: no $kind simulator is installed on this runner."
    return
  fi
  IFS=$'\t' read -r udid name runtime <<< "$picked"
  note "$kind: using $name ($runtime), $udid."

  xcrun simctl boot "$udid" 2> /dev/null || true
  xcrun simctl bootstatus "$udid" -b > "$OUT/boot-$kind.txt" 2>&1
  xcrun simctl status_bar "$udid" override --time "9:41" > /dev/null 2>&1 || true

  if ! xcrun simctl install "$udid" "$APP"; then
    fail "$kind: the app could not be installed on $name."
    xcrun simctl shutdown "$udid" 2> /dev/null || true
    return
  fi
  local launched
  if launched="$(xcrun simctl launch "$udid" "$BUNDLE_ID" 2>&1)"; then
    echo "$launched" | tee "$OUT/launch-$kind.txt"
  else
    echo "$launched" | tee "$OUT/launch-$kind.txt"
    fail "$kind: the app could not be launched on $name."
  fi
  note "$kind: waiting $SETTLE_SECONDS seconds for the first frames."
  sleep "$SETTLE_SECONDS"

  xcrun simctl io "$udid" screenshot "$OUT/$kind.png" 2> /dev/null
  if ! node "$HERE/png-stats.mjs" "$OUT/$kind.png"; then
    fail "$kind: the screenshot looks blank, so the app did not draw (see $kind.png)."
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
}

check_device iPhone "iPhone 17"
check_device iPad "iPad Pro 11-inch (M5)"

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
echo "iOS smoke test: the app started on the iPhone and iPad simulators, drew its interface and stayed alive." | tee "$OUT/summary.txt"
