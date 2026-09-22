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

# --- Machine identity from engine.json ---
MACHINE_NAME=""
MACHINE_ID=""
if [ -f "/opt/fabmo/config/engine.json" ]; then
    MACHINE_NAME=$(grep -oP '"machine_name"\s*:\s*"\K[^"]+' /opt/fabmo/config/engine.json 2>/dev/null)
    MACHINE_ID=$(grep -oP '"machine_id"\s*:\s*"\K[^"]+' /opt/fabmo/config/engine.json 2>/dev/null)
fi
[ -z "$MACHINE_NAME" ] || [ "$MACHINE_NAME" = "null" ] && MACHINE_NAME="${MACHINE_ID:-unknown}"

# Avahi hostname: same sanitization FabMo uses (lowercase, non-alphanumeric → dash)
AVAHI_HOST=$(echo "$MACHINE_NAME" | tr '[:upper:]' '[:lower:]' | \
    sed 's/[^a-z0-9-]/-/g; s/-\+/-/g; s/^-//; s/-$//')
[ -z "$AVAHI_HOST" ] && AVAHI_HOST="fabmo"

# Current AP SSID (what users see in their Wi-Fi list)
AP_SSID=$(nmcli -t -f 802-11-wireless.ssid connection show wlan0_ap 2>/dev/null | cut -d: -f2)
[ -z "$AP_SSID" ] && AP_SSID="(not set)"

echo "=== Machine Names ==="
echo "  Machine Name (engine.machine_name) : $MACHINE_NAME"
echo "  SSID Display                       : $AP_SSID"
echo "  Avahi Shortcut                     : ${AVAHI_HOST}.local"
echo " "

# --- Gather interface states and IPs ---
ETH_STATE=$(nmcli -t -f DEVICE,STATE dev status 2>/dev/null | grep "^eth0:"    | cut -d: -f2)
ETH_IP=$(   ip -4 addr show eth0    2>/dev/null | grep inet | awk '{print $2}' | cut -d/ -f1)

WLAN_STATE=$(nmcli -t -f DEVICE,STATE dev status 2>/dev/null | grep "^wlan0:"  | cut -d: -f2)
WLAN_IP=$(  ip -4 addr show wlan0   2>/dev/null | grep inet | awk '{print $2}' | cut -d/ -f1)
WLAN_SSID=$(nmcli -t -f GENERAL.CONNECTION dev show wlan0 2>/dev/null | cut -d: -f2)

AP_STATE=$(nmcli -t -f DEVICE,STATE dev status 2>/dev/null | grep "^wlan0_ap:" | cut -d: -f2)
AP_IP=$(    ip -4 addr show wlan0_ap 2>/dev/null | grep inet | awk '{print $2}' | cut -d/ -f1)

echo "=== Current Network Connections ==="

# eth0 is either a direct PC cable (192.168.44.x) or a LAN connection
ETH_DIRECT_OK=""
ETH_LAN_OK=""
if echo "$ETH_STATE" | grep -q "connected"; then
    if echo "$ETH_IP" | grep -q "^192\.168\.44\."; then
        echo "  Ethernet Direct (eth0 to PC)      : Connected   - $ETH_IP, ${AVAHI_HOST}.local"
        ETH_DIRECT_OK=1
    else
        echo "  LAN Connection  (eth0 to network) : Connected   - $ETH_IP, ${AVAHI_HOST}.local"
        ETH_LAN_OK=1
    fi
else
    echo "  Ethernet Direct (eth0 to PC)      : Not connected"
    echo "  LAN Connection  (eth0 to network) : Not connected"
fi

WLAN_OK=""
if echo "$WLAN_STATE" | grep -q "connected"; then
    echo "  WiFi (wlan0)                      : Connected   - via '$WLAN_SSID', $WLAN_IP, ${AVAHI_HOST}.local"
    WLAN_OK=1
else
    echo "  WiFi (wlan0)                      : Not connected"
fi

AP_OK=""
if echo "$AP_STATE" | grep -q "connected"; then
    echo "  Access Point (wlan0_ap)           : Available   - join WiFi '$AP_SSID', then use $AP_IP"
    AP_OK=1
else
    echo "  Access Point (wlan0_ap)           : Not available"
fi

echo " "

# --- Primary Mode: same priority order as ip-reporting.py ---
# eth Direct > eth LAN > WiFi > AP > nothing
echo "=== Primary Mode (recommended from connections) ==="
if [ -n "$ETH_DIRECT_OK" ]; then
    echo "  ETHERNET DIRECT PC  ->  http://$ETH_IP   (${AVAHI_HOST}.local)"
elif [ -n "$ETH_LAN_OK" ]; then
    echo "  LAN (ethernet)      ->  http://$ETH_IP   (${AVAHI_HOST}.local)"
elif [ -n "$WLAN_OK" ]; then
    echo "  WiFi                ->  http://$WLAN_IP   (${AVAHI_HOST}.local)"
elif [ -n "$AP_OK" ]; then
    echo "  ACCESS POINT        ->  http://192.168.42.1   (join WiFi '$AP_SSID')"
else
    echo "  Nothing Available - no active network connection found"
fi

echo " "
echo "============================================================"


