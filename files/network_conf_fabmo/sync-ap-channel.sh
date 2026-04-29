#!/bin/bash
# Sync wlan0_ap (AP mode) band/channel to match wlan0 (WiFi client)
# This ensures concurrent AP + WiFi client mode works on the same frequency

LOGFILE="/var/log/sync_ap_channel.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOGFILE"
}

# Check if wlan0 is connected as a WiFi client
WLAN0_STATE=$(nmcli -t -f DEVICE,STATE dev status | grep "^wlan0:" | cut -d: -f2)

if [ "$WLAN0_STATE" != "connected" ]; then
    log "wlan0 is not connected (state: $WLAN0_STATE), skipping AP sync"
    exit 0
fi

# Get the current channel and frequency from wlan0
CHANNEL_INFO=$(iw dev wlan0 info | grep "channel")
if [ -z "$CHANNEL_INFO" ]; then
    log "ERROR: Could not get channel info from wlan0"
    exit 1
fi

# Extract channel number and frequency
CHANNEL=$(echo "$CHANNEL_INFO" | grep -oP 'channel \K\d+')
FREQ=$(echo "$CHANNEL_INFO" | grep -oP '\(\K\d+')

if [ -z "$CHANNEL" ] || [ -z "$FREQ" ]; then
    log "ERROR: Could not parse channel ($CHANNEL) or frequency ($FREQ)"
    exit 1
fi

# Determine band based on frequency
if [ "$FREQ" -lt 3000 ]; then
    BAND="bg"  # 2.4 GHz
    BAND_NAME="2.4GHz"
elif [ "$FREQ" -ge 5000 ]; then
    BAND="a"   # 5 GHz
    BAND_NAME="5GHz"
else
    log "ERROR: Unexpected frequency $FREQ MHz"
    exit 1
fi

log "wlan0 connected: $BAND_NAME channel $CHANNEL (${FREQ} MHz)"

# Get current AP settings
AP_BAND=$(nmcli -t -f 802-11-wireless.band connection show wlan0_ap | cut -d: -f2)
AP_CHANNEL=$(nmcli -t -f 802-11-wireless.channel connection show wlan0_ap | cut -d: -f2)

log "wlan0_ap current: band=$AP_BAND channel=$AP_CHANNEL"

# Check if AP needs updating
if [ "$AP_BAND" = "$BAND" ] && [ "$AP_CHANNEL" = "$CHANNEL" ]; then
    log "AP already matches WiFi client settings, no changes needed"
    exit 0
fi

# Update AP to match
log "Updating wlan0_ap: band=$BAND channel=$CHANNEL"

# Modify connection
if ! nmcli connection modify wlan0_ap 802-11-wireless.band "$BAND" 802-11-wireless.channel "$CHANNEL" 2>&1 | tee -a "$LOGFILE"; then
    log "ERROR: Failed to modify wlan0_ap connection"
    exit 1
fi

# Check if AP is currently active
AP_STATE=$(nmcli -t -f DEVICE,STATE dev status | grep "^wlan0_ap:" | cut -d: -f2)

if [ "$AP_STATE" = "connected" ]; then
    log "Restarting wlan0_ap to apply new settings..."
    
    # Bring down and up to apply changes
    if nmcli connection down wlan0_ap 2>&1 | tee -a "$LOGFILE"; then
        sleep 2
        if nmcli connection up wlan0_ap 2>&1 | tee -a "$LOGFILE"; then
            log "SUCCESS: wlan0_ap restarted on $BAND_NAME channel $CHANNEL"
        else
            log "ERROR: Failed to bring up wlan0_ap"
            exit 1
        fi
    else
        log "WARNING: wlan0_ap was not active, changes will apply on next connection"
    fi
else
    log "wlan0_ap not active, changes will apply when connection starts"
fi

log "AP channel sync complete"
exit 0
