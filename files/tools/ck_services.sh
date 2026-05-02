#!/bin/sh

# Checks the systemd services running FabMo

echo " "
echo "Checking the status of Key Fabmo services ============================"
echo " "
echo "------------------------------------------------------------"
echo "----FabMo---------------------------------------------------"
systemctl --no-pager status fabmo.service
echo " "
echo "------------------------------------------------------------"
echo "----Updater-------------------------------------------------"
systemctl --no-pager status fabmo-updater.service
echo " "
echo "------------------------------------------------------------"
echo "----User Networking-----------------------------------------"
systemctl --no-pager status network-monitor.service
echo " "
# Check setup_wlan0_ap.service if it exists
if systemctl list-unit-files | grep -q "setup_wlan0_ap.service"; then
    echo "------------------------------------------------------------"
    echo "----AP Setup Service (for SSID with IP)-----------------------"
    systemctl --no-pager status setup_wlan0_ap.service
    echo " "
fi
echo "------------------------------------------------------------"
echo "----System Networking---------------------------------------"
systemctl --no-pager status NetworkManager
systemctl --no-pager status dnsmasq
systemctl --no-pager status hostapd
echo " "
echo "------------------------------------------------------------"
echo "----Network Status Summary----------------------------------"
echo " "

# Get current AP SSID being broadcast
echo "Access Point SSID (name users see in WiFi list):"
AP_SSID=$(nmcli -t -f 802-11-wireless.ssid connection show wlan0_ap 2>/dev/null | cut -d: -f2)
if [ -n "$AP_SSID" ]; then
    echo "  Broadcast Name: $AP_SSID"
    
    # Check if AP is actually active
    AP_STATE=$(nmcli -t -f GENERAL.STATE dev show wlan0_ap 2>/dev/null | cut -d: -f2)
    if echo "$AP_STATE" | grep -q "activated"; then
        echo "  Status: Active (broadcasting)"
        
        # Show connected clients if any
        AP_CLIENTS=$(iw dev wlan0_ap station dump 2>/dev/null | grep -c "Station")
        echo "  Connected clients: $AP_CLIENTS"
    else
        echo "  Status: Not active"
    fi
else
    echo "  AP not configured"
fi
echo " "

# Show current network mode and IPs
echo "Current Network Connections:"

# Check ethernet
ETH_STATE=$(nmcli -t -f DEVICE,STATE dev status 2>/dev/null | grep "^eth0:" | cut -d: -f2)
if echo "$ETH_STATE" | grep -q "connected"; then
    ETH_IP=$(ip -4 addr show eth0 2>/dev/null | grep inet | awk '{print $2}' | cut -d/ -f1)
    echo "  Ethernet (eth0): Connected - $ETH_IP"
    ACTIVE_MODE="Ethernet"
else
    echo "  Ethernet (eth0): Not connected"
fi

# Check WiFi client mode
WLAN_STATE=$(nmcli -t -f DEVICE,STATE dev status 2>/dev/null | grep "^wlan0:" | cut -d: -f2)
if echo "$WLAN_STATE" | grep -q "connected"; then
    WLAN_IP=$(ip -4 addr show wlan0 2>/dev/null | grep inet | awk '{print $2}' | cut -d/ -f1)
    WLAN_SSID=$(nmcli -t -f GENERAL.CONNECTION dev show wlan0 2>/dev/null | cut -d: -f2)
    echo "  WiFi Client (wlan0): Connected to '$WLAN_SSID' - $WLAN_IP"
    ACTIVE_MODE="WiFi Client"
else
    echo "  WiFi Client (wlan0): Not connected"
fi

# Check AP mode
WLAN_AP_STATE=$(nmcli -t -f DEVICE,STATE dev status 2>/dev/null | grep "^wlan0_ap:" | cut -d: -f2)
if echo "$WLAN_AP_STATE" | grep -q "connected"; then
    WLAN_AP_IP=$(ip -4 addr show wlan0_ap 2>/dev/null | grep inet | awk '{print $2}' | cut -d/ -f1)
    echo "  Access Point (wlan0_ap): Active - $WLAN_AP_IP"
    if [ -z "$ACTIVE_MODE" ]; then
        ACTIVE_MODE="Access Point"
    fi
else
    echo "  Access Point (wlan0_ap): Not active"
fi

echo " "
if [ -n "$ACTIVE_MODE" ]; then
    echo "Primary Mode: $ACTIVE_MODE"
fi

# Show FabMo tool name if available
if [ -f "/opt/fabmo/config/engine.json" ]; then
    TOOL_NAME=$(grep -oP '"name"\s*:\s*"\K[^"]+' /opt/fabmo/config/engine.json 2>/dev/null | head -1)
    if [ -n "$TOOL_NAME" ]; then
        echo "FabMo Tool Name: $TOOL_NAME"
    fi
fi

echo " "
echo "============================================================"


