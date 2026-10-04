#!/system/bin/sh
# Runs on the Android device. mobile/android-smoke.sh pushes it to
# /data/local/tmp and starts it with adb shell right after the app has started.
#
#   sh watch-providers.sh <package> <seconds> [crash]
#
# For the given number of seconds it asks the system, as fast as the system
# answers, which content providers the app is connected to, and prints the
# connections whenever they change:
#
#   t=<seconds since the start> <provider> s<stable>/<total> u<unstable>/<total>;...
#
# Android stops an app whose stable connection to a content provider is cut
# because the process of the provider died. With "crash", the persistent process
# of Google Play services is crashed (am crash) at the first moment the app holds
# a stable connection to a provider of Google Play services, which is the worst
# moment for the app, and the script prints "t=<seconds> CRASHED <process>".
# The last line is "samples=<number of questions asked>".
#
# Only sh builtins and the tools every Android has (dumpsys, grep, sed, cut,
# tr, date, pidof, am) are used, so that it runs on the oldest supported image.

pkg="$1"
limit="$2"
crash="${3:-}"

start="$(date +%s)"
last="-"
crashed=0
probed=0
samples=0

while :; do
  t=$(( $(date +%s) - start ))
  if [ "$t" -ge "$limit" ]; then break; fi
  samples=$((samples + 1))

  # One line per connection: the provider, then the stable and unstable counts.
  # The system prints a connection as
  #   - 1ce4fd0/com.google.android.gms/.fonts.provider.FontsProvider->7571:<package>/u0a193 s1/2 u0/11 +3s424ms
  # (older versions as - ContentProviderRecord{1ce4fd0 u0 <provider>}->7571:... ),
  # so the part before "->" and after the age are cut off. The age is left out so
  # that only real changes print.
  lines="$(dumpsys activity processes "$pkg" 2> /dev/null \
    | grep -E -- "->[0-9]+:$pkg/" \
    | sed -e 's/^.*ContentProviderRecord{[0-9a-f]* u[0-9]* //' -e 's/^ *- [0-9a-f]*\///' -e 's/}*->[0-9]*:[^ ]* / /' -e 's/ [+][0-9a-z]*$//')"
  if [ "$lines" != "$last" ]; then
    echo "t=$t $(echo "$lines" | tr '\n' ';')"
    last="$lines"
  fi

  if [ -n "$crash" ] && [ "$crashed" = 0 ] && echo "$lines" | grep -q -E "^com[.]google[.]android[.]gms/[^ ]* s[1-9]"; then
    gms="$(pidof com.google.android.gms.persistent | cut -d ' ' -f 1)"
    if [ -n "$gms" ]; then
      am crash "$gms" > /dev/null 2>&1
      crashed=1
      echo "t=$t CRASHED $gms"
    fi
  fi

  # Once, a few seconds in: what the system prints about providers, so that a
  # change in its format shows in the report.
  if [ "$probed" = 0 ] && [ "$t" -ge 3 ]; then
    probed=1
    echo "probe: $(dumpsys activity processes "$pkg" 2> /dev/null | grep -i -A4 "connected providers" | head -n 6 | cut -c1-200 | tr '\n' '|')"
  fi
done

echo "samples=$samples"
