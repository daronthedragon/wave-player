#!/usr/bin/env bash
# Run inside android-emulator-runner, before its teardown can hide a VM failure.
set -uo pipefail
live_audio="${1:-false}"
if [[ "$live_audio" != true && "$live_audio" != false ]]; then
  echo 'Expected true or false for provider network tests.' >&2
  exit 2
fi
diagnostics=android/.tmp/device-diagnostics
mkdir -p "$diagnostics"
adb logcat -v threadtime > "$diagnostics/device-logcat.txt" 2>&1 &
logcat_pid=$!
trap 'kill "$logcat_pid" 2>/dev/null || true' EXIT

gradle -p android --no-daemon --max-workers=2 \
  '-Dorg.gradle.jvmargs=-Xmx1024m -Dfile.encoding=UTF-8' \
  connectedDebugAndroidTest \
  "-Pandroid.testInstrumentationRunnerArguments.waveLiveAudio=$live_audio"
result=$?

if [[ "$result" -ne 0 ]]; then
  # Keep failure evidence even when adb has already lost the emulator. Never
  # turn a disconnected device or a failed provider check into a passing run.
  free -h > "$diagnostics/host-memory.txt" 2>&1 || true
  df -h > "$diagnostics/host-disk.txt" 2>&1 || true
  ps -eo pid,ppid,rss,comm --sort=-rss | head -40 > "$diagnostics/host-processes.txt" || true
  sudo -n dmesg --ctime | tail -300 > "$diagnostics/host-kernel.txt" 2>&1 || true
  timeout 10 adb devices -l > "$diagnostics/adb-devices.txt" 2>&1 || true
  timeout 10 adb shell dumpsys meminfo > "$diagnostics/device-memory.txt" 2>&1 || true
  for crash in /tmp/android-runner/emu-crash*.db; do
    if [[ -f "$crash" ]]; then cp "$crash" "$diagnostics/" || true; fi
  done
fi
exit "$result"
