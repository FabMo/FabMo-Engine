#!/usr/bin/env bash
set -u

BIN="/fabmo/firmware/g2.bin"
PORTS=(/dev/fabmo_g2_motion /dev/ttyACM0 /dev/ttyACM1 /dev/ttyACM2)
PER_PORT_SECONDS="${PER_PORT_SECONDS:-5}"
POLL_INTERVAL="${POLL_INTERVAL:-0.5}"

# Step 1: If G2 is running firmware, trigger bootloader entry
#         (Stop FabMo first if it's holding the port)
if [[ -e /dev/fabmo_g2_motion ]]; then
  echo "Device found at /dev/fabmo_g2_motion — triggering bootloader ..."
  systemctl stop fabmo 2>/dev/null || true
  sleep 1
  stty -F /dev/fabmo_g2_motion 1200 2>/dev/null || true
  sleep 3  # Wait for USB re-enumeration into SAM-BA mode
fi

# Step 2: Find the SAM-BA bootloader device and flash
for port in "${PORTS[@]}"; do
  echo "Trying $port"
  deadline=$((SECONDS + PER_PORT_SECONDS))

  while (( SECONDS < deadline )); do
    if [[ -e "$port" ]]; then
      if bossac -e -w -v --port="$port" "$BIN"; then
        echo "Success on $port"
        sleep 2
        bossac -b --port="$port"
        sleep 2
        bossac -R --port="$port"
        echo "Firmware loaded. Restarting FabMo ..."
        systemctl start fabmo 2>/dev/null || true
        exit 0
      fi
    fi
    sleep "$POLL_INTERVAL"
  done
done

echo "bossac could not find a usable device at fabmo_g2_motion or on ttyACM0..2" >&2
exit 1