#!/bin/bash

# Needed to make sure we are using the wlan0 transmitter with NetworkManager ???
# Create the AP interface if it doesn't exist
if ! iw dev | grep -q wlan0_ap; then
    iw dev wlan0 interface add wlan0_ap type __ap
fi
# Bring up the AP interface
ip link set wlan0_ap up

# Wait for the interface to be up and running
sleep 5

# Ensure the interface is properly configured
ifconfig wlan0_ap 192.168.42.1 netmask 255.255.255.0

# Restart hostapd to ensure it picks up the interface correctly
sudo systemctl restart hostapd