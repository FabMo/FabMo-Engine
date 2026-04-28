#!/bin/bash

# Restart the NetworkManager AP connection to apply SSID changes
# This is called by ip-reporting.py after updating the wlan0_ap SSID

# Note: We use NetworkManager to manage the AP, not standalone hostapd
# The wlan0_ap connection is defined in /etc/NetworkManager/system-connections/wlan0_ap.nmconnection

# Wait briefly to ensure previous operations complete
sleep 2

# Restart the NetworkManager AP connection to apply the new SSID
# This uses NetworkManager's internal hostapd, not the standalone service
sudo nmcli connection down wlan0_ap 2>/dev/null
sudo nmcli connection up wlan0_ap