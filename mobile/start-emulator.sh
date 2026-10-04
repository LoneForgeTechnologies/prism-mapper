#!/usr/bin/env bash
# Creates an Android emulator and waits until it has booted. Run by the
# "Android emulator test" job in .github/workflows/mobile.yml on a Linux runner
# that already allows hardware acceleration (the job takes care of /dev/kvm).
#
#   bash mobile/start-emulator.sh <api level> <google_apis|default> <graphics mode> <output-folder>
#
# This script starts the emulator itself instead of using a helper action so
# that everything the emulator says, including the guest kernel messages, is
# kept in <output-folder>/emulator.log. That file is the first place to look
# when an emulator stops answering.
#
# Use swangle_indirect for the graphics mode. On the GitHub runners the older
# swiftshader_indirect and the guest modes stop the whole emulator about 20
# seconds after Prism Mapper opens. A plain page, a canvas 2D page, a single
# WebGL triangle and the app without its WebGL drawing all survive those modes,
# so it is the full app's drawing that they cannot take. With swangle_indirect
# the same app stayed up for the 90 seconds that the experiment watched.
#
# The virtual device gets 4 GB of memory instead of the 1.5 GB that the Pixel 6
# profile asks for. 1.5 GB is tight for a page that decodes pictures and video
# and draws with WebGL, and the web view's own process is the first thing that
# Android stops when memory runs short. The runners have 16 GB. Set
# EMULATOR_RAM_MB to try another size.

set -eu

API="${1:?Android API level, for example 34}"
TARGET="${2:?system image flavour, google_apis or default}"
GPU="${3:?graphics mode, for example swangle_indirect}"
OUT="${4:?folder for the emulator log}"
CORES="${EMULATOR_CORES:-4}"
RAM="${EMULATOR_RAM_MB:-4096}"
BOOT_SECONDS="${BOOT_SECONDS:-900}"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:?the Android SDK is not set up on this runner}}"
IMAGE="system-images;android-$API;$TARGET;x86_64"
AVD="prism-test"

mkdir -p "$OUT"
# Keep the virtual device in a known place, whatever the runner image sets.
export ANDROID_AVD_HOME="$HOME/.android/avd"
mkdir -p "$ANDROID_AVD_HOME"
export PATH="$SDK/cmdline-tools/latest/bin:$SDK/platform-tools:$SDK/emulator:$PATH"
# The steps that come after this one need adb as well.
if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$SDK/platform-tools" >> "$GITHUB_PATH"
fi

# Prints the last interesting lines of a log file as one annotation and stops.
#   stop_with_log <message> <log file>
stop_with_log() {
  local lines
  lines="$(tr '\r' '\n' < "$2" | grep -v -E '^\[[= ]*\]' | tail -n 20 | cut -c1-220 | sed -e 's/%/%25/g' | awk 'BEGIN { ORS = "%0A" } { print }')"
  echo "::error title=Android emulator::$1 Last lines:%0A$lines"
  exit 1
}
trap 'echo "::error title=Android emulator::start-emulator.sh stopped at line $LINENO: $BASH_COMMAND"' ERR

echo "::group::Install the emulator and the system image ($IMAGE)"
echo "Java: $(java -version 2>&1 | head -n 1), SDK: $SDK, sdkmanager: $(command -v sdkmanager || echo missing), avdmanager: $(command -v avdmanager || echo missing)"
yes | sdkmanager --licenses > "$OUT/sdk-licenses.txt" 2>&1 || true
if ! sdkmanager --install "emulator" "platform-tools" "$IMAGE" > "$OUT/sdkmanager.txt" 2>&1; then
  stop_with_log "sdkmanager could not install $IMAGE." "$OUT/sdkmanager.txt"
fi
tr '\r' '\n' < "$OUT/sdkmanager.txt" | grep -v -E '^\[[= ]*\]' | tail -n 10
echo "::endgroup::"

echo "::group::Create the virtual device"
if ! echo no | avdmanager create avd --force --name "$AVD" --package "$IMAGE" --device pixel_6 > "$OUT/avdmanager.txt" 2>&1; then
  stop_with_log "avdmanager could not create the virtual device for $IMAGE." "$OUT/avdmanager.txt"
fi
cat "$OUT/avdmanager.txt"
CONFIG="$ANDROID_AVD_HOME/$AVD.avd/config.ini"
if [ ! -f "$CONFIG" ]; then
  stop_with_log "The virtual device was created, but $CONFIG does not exist." "$OUT/avdmanager.txt"
fi
if grep -q '^hw.cpu.ncore' "$CONFIG"; then
  sed -i "s/^hw.cpu.ncore.*/hw.cpu.ncore=$CORES/" "$CONFIG"
else
  echo "hw.cpu.ncore=$CORES" >> "$CONFIG"
fi
if grep -q '^hw.ramSize' "$CONFIG"; then
  sed -i "s/^hw.ramSize.*/hw.ramSize=$RAM/" "$CONFIG"
else
  echo "hw.ramSize=$RAM" >> "$CONFIG"
fi
grep -E '^(hw.ramSize|hw.cpu.ncore|hw.lcd|vm.heapSize|disk.dataPartition.size|image.sysdir.1|tag.id)' "$CONFIG" | tee "$OUT/avd-config.txt"
echo "::endgroup::"

ls -l /dev/kvm 2>&1 | tee "$OUT/kvm.txt"
emulator -version 2>&1 | grep -i -E "emulator version|build" | head -n 2 | tee "$OUT/emulator-version.txt"

echo "Starting the emulator (graphics mode $GPU, $CORES cores, $RAM MB memory)."
adb start-server > /dev/null 2>&1 || true
started=$SECONDS
setsid nohup emulator -avd "$AVD" -no-window -gpu "$GPU" -no-snapshot -noaudio -no-boot-anim -no-metrics \
  -show-kernel -verbose > "$OUT/emulator.log" 2>&1 &
EMULATOR_PID=$!
echo "$EMULATOR_PID" > "$OUT/emulator.pid"

booted=""
while [ $((SECONDS - started)) -lt "$BOOT_SECONDS" ]; do
  if ! kill -0 "$EMULATOR_PID" 2> /dev/null && ! pgrep -f 'qemu-system' > /dev/null; then
    echo "::error title=Android emulator::The emulator stopped while starting. Its last lines:%0A$(tail -n 25 "$OUT/emulator.log" | cut -c1-220 | awk 'BEGIN { ORS = "%0A" } { print }')"
    exit 1
  fi
  booted="$(timeout 20 adb shell getprop sys.boot_completed 2> /dev/null | tr -d '\r' || true)"
  if [ "$booted" = "1" ]; then break; fi
  sleep 5
done
if [ "$booted" != "1" ]; then
  echo "::error title=Android emulator::The emulator did not finish booting within $BOOT_SECONDS seconds. Its last lines:%0A$(tail -n 25 "$OUT/emulator.log" | cut -c1-220 | awk 'BEGIN { ORS = "%0A" } { print }')"
  exit 1
fi

# The package manager can lag behind the boot flag a little.
for _ in $(seq 1 30); do
  if timeout 20 adb shell pm path android 2> /dev/null | grep -q package; then break; fi
  sleep 2
done

# Animations only slow the checks down.
for setting in window_animation_scale transition_animation_scale animator_duration_scale; do
  timeout 20 adb shell settings put global "$setting" 0 > /dev/null 2>&1 || true
done

echo "Booted after $((SECONDS - started)) seconds."
echo "::notice title=Android emulator::$(head -n 1 "$OUT/emulator-version.txt" | cut -c1-80); image $IMAGE; graphics $GPU; $(grep -E 'hw.ramSize' "$OUT/avd-config.txt" | tr '\n' ' ')$CORES cores; booted after $((SECONDS - started)) seconds."
