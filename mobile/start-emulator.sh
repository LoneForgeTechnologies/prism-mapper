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

set -eu

API="${1:?Android API level, for example 34}"
TARGET="${2:?system image flavour, google_apis or default}"
GPU="${3:?graphics mode, for example swiftshader_indirect}"
OUT="${4:?folder for the emulator log}"
CORES="${EMULATOR_CORES:-4}"
BOOT_SECONDS="${BOOT_SECONDS:-900}"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:?the Android SDK is not set up on this runner}}"
IMAGE="system-images;android-$API;$TARGET;x86_64"
AVD="prism-test"

mkdir -p "$OUT"
export PATH="$SDK/cmdline-tools/latest/bin:$SDK/platform-tools:$SDK/emulator:$PATH"

echo "::group::Install the emulator and the system image ($IMAGE)"
yes | sdkmanager --licenses > /dev/null 2>&1 || true
sdkmanager --install "emulator" "platform-tools" "$IMAGE" 2>&1 | tr '\r' '\n' | grep -v -E '^\[[= ]*\]' | tail -n 15 || true
echo "::endgroup::"

echo "::group::Create the virtual device"
echo no | avdmanager create avd --force --name "$AVD" --package "$IMAGE" --device pixel_6
CONFIG="$HOME/.android/avd/$AVD.avd/config.ini"
if grep -q '^hw.cpu.ncore' "$CONFIG"; then
  sed -i "s/^hw.cpu.ncore.*/hw.cpu.ncore=$CORES/" "$CONFIG"
else
  echo "hw.cpu.ncore=$CORES" >> "$CONFIG"
fi
grep -E '^(hw.ramSize|hw.cpu.ncore|hw.lcd|vm.heapSize|disk.dataPartition.size|image.sysdir.1|tag.id)' "$CONFIG" | tee "$OUT/avd-config.txt"
echo "::endgroup::"

ls -l /dev/kvm 2>&1 | tee "$OUT/kvm.txt"
emulator -version 2>&1 | grep -i -E "emulator version|build" | head -n 2 | tee "$OUT/emulator-version.txt"

echo "Starting the emulator (graphics mode $GPU, $CORES cores)."
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
