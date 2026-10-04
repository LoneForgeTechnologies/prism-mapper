#!/usr/bin/env bash
# Temporary. Installs one APK, opens it and reports, every five seconds for
# 90 seconds, whether the emulator and the app are still alive.
#   bash mobile/experiment-launch.sh <apk> <folder with emulator.log>
set -u
APK="${1:?apk}"
OUT="${2:?folder}"
PACKAGE="org.prismmapper.mobile"
mkdir -p "$OUT"
adb logcat -c > /dev/null 2>&1 || true
(adb logcat -v threadtime > "$OUT/logcat-live.txt" 2>&1 &)
adb uninstall "$PACKAGE" > /dev/null 2>&1 || true
adb install -r "$APK"
echo "WebView: $(adb shell dumpsys webviewupdate | tr -d '\r' | grep -E 'Current WebView package' || true)"
date +%T
adb shell am start -W -n "$PACKAGE/.MainActivity" | tr -d '\r'
alive=1
for i in $(seq 1 18); do
  sleep 5
  qemu="$(pgrep -f qemu-system | head -n 1)"
  state="$(timeout 10 adb get-state 2>&1 | head -n 1)"
  pid="$(timeout 10 adb shell pidof "$PACKAGE" 2>&1 | tr -d '\r' | head -n 1)"
  echo "$(date +%T) t+$((i * 5))s adb=[$state] qemu=[${qemu:-gone}] app=[${pid:-none}] free=$(free -m | awk '/^Mem:/ { print $7 }')MB"
  if [ -z "$qemu" ]; then alive=0; fi
done
echo "=== host kernel messages ==="
sudo dmesg 2>&1 | tail -n 15 | cut -c1-220
echo "=== emulator.log (last 50 lines) ==="
tail -n 50 "$OUT/emulator.log" | cut -c1-240
echo "=== emulator.log (lines mentioning errors) ==="
grep -a -i -E "error|fatal|panic|segfault|segmentation|abort|crash|killed|exception|unsupported|failed" "$OUT/emulator.log" | grep -v -E "apexd|libprocessgroup" | tail -n 25 | cut -c1-240
echo "=== logcat: web view, graphics and crash lines (last 90) ==="
grep -a -i -E "chromium|webview|gpu|opengl|egl|angle|swiftshader|vulkan|fatal|crash|tombstone|signal|capacitor|console|am_proc_died|am_crash|has died" "$OUT/logcat-live.txt" | tail -n 90 | cut -c1-240
if [ "$alive" = 1 ]; then echo "RESULT: the emulator survived 90 seconds."; exit 0; fi
echo "RESULT: the emulator DIED."
exit 1
