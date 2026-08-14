#!/bin/bash
################################################################################
# FabMo Direct Connection Diagnostic Script
#
# This script diagnoses issues with direct ethernet connections (eth0).
# Run this when users report that direct connection "stops working" after
# having worked previously.
#
# Usage: sudo /fabmo/scripts/diagnose-direct-connection.sh
################################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}FabMo Direct Connection Diagnostics${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}ERROR: Please run as root (sudo)${NC}"
    exit 1
fi

################################################################################
# 1. Check eth0 Interface Status
################################################################################
echo -e "${BLUE}[1] Checking eth0 Interface...${NC}"

if ip link show eth0 &>/dev/null; then
    ETH0_STATUS=$(ip link show eth0 | grep -oP '(?<=state )\w+')
    ETH0_IP=$(ip addr show eth0 | grep -oP '(?<=inet )\d+\.\d+\.\d+\.\d+/\d+' || echo "NO IP")
    
    if [ "$ETH0_STATUS" = "UP" ]; then
        echo -e "  ${GREEN}✓${NC} eth0 is UP"
    else
        echo -e "  ${RED}✗${NC} eth0 is $ETH0_STATUS (should be UP)"
    fi
    
    if [[ "$ETH0_IP" == "192.168.44.1"* ]]; then
        echo -e "  ${GREEN}✓${NC} eth0 IP: $ETH0_IP (correct)"
    else
        echo -e "  ${RED}✗${NC} eth0 IP: $ETH0_IP (should be 192.168.44.1/24)"
    fi
else
    echo -e "  ${RED}✗${NC} eth0 interface not found!"
fi
echo ""

################################################################################
# 2. Check NetworkManager Connection Status
################################################################################
echo -e "${BLUE}[2] Checking NetworkManager Connections...${NC}"

if systemctl is-active --quiet NetworkManager; then
    echo -e "  ${GREEN}✓${NC} NetworkManager is running"
    
    # Check if direct-connection profile exists
    if nmcli connection show direct-connection &>/dev/null; then
        echo -e "  ${GREEN}✓${NC} direct-connection profile exists"
        
        # Check if it's active
        ACTIVE_CONN=$(nmcli -t -f DEVICE,NAME connection show --active | grep "eth0:" | cut -d: -f2)
        if [ "$ACTIVE_CONN" = "direct-connection" ]; then
            echo -e "  ${GREEN}✓${NC} direct-connection is active on eth0"
        else
            echo -e "  ${YELLOW}⚠${NC} Active connection on eth0: ${ACTIVE_CONN:-none} (should be direct-connection)"
        fi
    else
        echo -e "  ${RED}✗${NC} direct-connection profile NOT FOUND"
        echo -e "     ${YELLOW}Fix:${NC} Run /fabmo_image_builder/restore-network-config.sh"
    fi
else
    echo -e "  ${RED}✗${NC} NetworkManager is not running"
fi
echo ""

################################################################################
# 3. Check dnsmasq DHCP Server
################################################################################
echo -e "${BLUE}[3] Checking dnsmasq DHCP Server...${NC}"

if systemctl is-active --quiet dnsmasq; then
    echo -e "  ${GREEN}✓${NC} dnsmasq is running"
    
    # Check if listening on correct addresses
    LISTENING=$(ss -tulnp | grep dnsmasq | grep ":53 ")
    if echo "$LISTENING" | grep -q "192.168.44.1:53"; then
        echo -e "  ${GREEN}✓${NC} dnsmasq listening on 192.168.44.1:53"
    else
        echo -e "  ${YELLOW}⚠${NC} dnsmasq might not be listening on 192.168.44.1"
    fi
    
    # Check DHCP leases
    if [ -f /var/lib/misc/dnsmasq.leases ]; then
        LEASE_COUNT=$(wc -l < /var/lib/misc/dnsmasq.leases)
        echo -e "  ${GREEN}ℹ${NC} Active DHCP leases: $LEASE_COUNT"
        
        if [ $LEASE_COUNT -gt 0 ]; then
            echo -e "     ${BLUE}Recent leases:${NC}"
            tail -5 /var/lib/misc/dnsmasq.leases | while read line; do
                IP=$(echo "$line" | awk '{print $3}')
                MAC=$(echo "$line" | awk '{print $2}')
                echo -e "       - IP: $IP (MAC: $MAC)"
            done
        fi
    fi
    
    # Check active mode configuration
    if [ -L /etc/dnsmasq.d/active-mode.conf ]; then
        ACTIVE_MODE=$(readlink /etc/dnsmasq.d/active-mode.conf)
        echo -e "  ${GREEN}ℹ${NC} Active dnsmasq mode: $(basename $ACTIVE_MODE)"
    fi
else
    echo -e "  ${RED}✗${NC} dnsmasq is not running"
    echo -e "     ${YELLOW}Fix:${NC} sudo systemctl start dnsmasq"
fi
echo ""

################################################################################
# 4. Check FabMo Engine Web Server
################################################################################
echo -e "${BLUE}[4] Checking FabMo Engine...${NC}"

if systemctl is-active --quiet fabmo; then
    echo -e "  ${GREEN}✓${NC} fabmo service is running"
    
    # Check if listening on port 80
    if ss -tulnp | grep -q ":80.*node"; then
        echo -e "  ${GREEN}✓${NC} FabMo listening on port 80"
        
        # Test HTTP response on 192.168.44.1
        if curl -s -o /dev/null -w "%{http_code}" http://192.168.44.1 | grep -q "^[23]"; then
            echo -e "  ${GREEN}✓${NC} FabMo responding on http://192.168.44.1"
        else
            echo -e "  ${YELLOW}⚠${NC} FabMo not responding properly on http://192.168.44.1"
        fi
    else
        echo -e "  ${RED}✗${NC} FabMo not listening on port 80"
    fi
else
    echo -e "  ${RED}✗${NC} fabmo service is not running"
    echo -e "     ${YELLOW}Fix:${NC} sudo systemctl start fabmo"
fi
echo ""

################################################################################
# 5. Check Avahi/mDNS Service (if installed)
################################################################################
echo -e "${BLUE}[5] Checking mDNS Service...${NC}"

if systemctl is-active --quiet avahi-daemon &>/dev/null; then
    echo -e "  ${GREEN}✓${NC} avahi-daemon is running"
    
    # Test if fabmo.local resolves
    if avahi-resolve -n fabmo.local &>/dev/null; then
        RESOLVED_IP=$(avahi-resolve -n fabmo.local | awk '{print $2}')
        echo -e "  ${GREEN}✓${NC} fabmo.local resolves to $RESOLVED_IP"
    else
        echo -e "  ${YELLOW}⚠${NC} fabmo.local does not resolve"
    fi
else
    echo -e "  ${YELLOW}ℹ${NC} avahi-daemon not installed/running (optional)"
    echo -e "     ${BLUE}Note:${NC} mDNS allows access via http://fabmo.local"
fi
echo ""

################################################################################
# 6. Check Routing Table
################################################################################
echo -e "${BLUE}[6] Checking Routing Table...${NC}"

ROUTE_44=$(ip route show | grep "192.168.44.0/24" || echo "")
if [ -n "$ROUTE_44" ]; then
    echo -e "  ${GREEN}✓${NC} Route for 192.168.44.0/24 exists"
    echo -e "     $ROUTE_44"
else
    echo -e "  ${YELLOW}⚠${NC} No route for 192.168.44.0/24"
fi
echo ""

################################################################################
# 7. Check for Common Issues
################################################################################
echo -e "${BLUE}[7] Checking for Common Issues...${NC}"

# Check DHCP range exhaustion (if dnsmasq configured with max 100 addresses)
if [ -f /var/lib/misc/dnsmasq.leases ]; then
    LEASE_COUNT=$(wc -l < /var/lib/misc/dnsmasq.leases)
    if [ $LEASE_COUNT -gt 40 ]; then
        echo -e "  ${YELLOW}⚠${NC} High number of DHCP leases ($LEASE_COUNT)"
        echo -e "     ${BLUE}Suggestion:${NC} May need to clear old leases or expand range"
    else
        echo -e "  ${GREEN}✓${NC} DHCP lease count reasonable ($LEASE_COUNT/100)"
    fi
fi

# Check for NetworkManager connection file protection
IMMUTABLE_COUNT=0
for conn in lan-connection direct-connection; do
    if [ -f "/etc/NetworkManager/system-connections/$conn" ]; then
        if lsattr "/etc/NetworkManager/system-connections/$conn" 2>/dev/null | grep -q "i-"; then
            ((IMMUTABLE_COUNT++))
        fi
    fi
done

if [ $IMMUTABLE_COUNT -eq 2 ]; then
    echo -e "  ${GREEN}✓${NC} Critical connections protected (immutable flags set)"
else
    echo -e "  ${YELLOW}⚠${NC} Some connections not protected from deletion"
    echo -e "     ${BLUE}Suggestion:${NC} Run /fabmo_image_builder/restore-network-config.sh"
fi
echo ""

################################################################################
# 8. Summary and Recommendations
################################################################################
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Summary and Troubleshooting${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Generate recommendations based on findings
ISSUES_FOUND=0

if [ "$ETH0_IP" != "192.168.44.1"* ]; then
    ((ISSUES_FOUND++))
    echo -e "${RED}[ISSUE]${NC} eth0 not configured with 192.168.44.1"
    echo -e "  ${YELLOW}Fix:${NC} sudo nmcli connection up direct-connection"
    echo ""
fi

if ! systemctl is-active --quiet dnsmasq; then
    ((ISSUES_FOUND++))
    echo -e "${RED}[ISSUE]${NC} dnsmasq DHCP server not running"
    echo -e "  ${YELLOW}Fix:${NC} sudo systemctl start dnsmasq"
    echo ""
fi

if ! systemctl is-active --quiet fabmo; then
    ((ISSUES_FOUND++))
    echo -e "${RED}[ISSUE]${NC} FabMo engine not running"
    echo -e "  ${YELLOW}Fix:${NC} sudo systemctl start fabmo"
    echo ""
fi

if [ $ISSUES_FOUND -eq 0 ]; then
    echo -e "${GREEN}✓ No critical issues detected${NC}"
    echo ""
    echo -e "${BLUE}If client PC still cannot connect:${NC}"
    echo ""
    echo -e "  ${YELLOW}On Client PC:${NC}"
    echo -e "    1. Check if PC has received IP in range 192.168.44.50-150"
    echo -e "    2. Try ping 192.168.44.1"
    echo -e "    3. Check if PC using static IP (prevents DHCP)"
    echo -e "    4. Clear ARP cache (Windows: arp -d, Linux: ip neigh flush)"
    echo -e "    5. Disable/re-enable ethernet adapter"
    echo ""
    echo -e "  ${YELLOW}On Mobile Devices:${NC}"
    echo -e "    1. Turn OFF Mobile Data (Settings → Mobile Data → OFF)"
    echo -e "    2. Or use Airplane Mode"
    echo -e "    3. Wait 10-20 seconds after connecting ethernet"
    echo -e "    4. iOS: Turn off WiFi"
    echo ""
    echo -e "  ${YELLOW}On RPi:${NC}"
    echo -e "    - Check recent logs: journalctl -u fabmo -n 50"
    echo -e "    - Check dnsmasq logs: journalctl -u dnsmasq -n 50"
    echo -e "    - Try restarting direct connection:"
    echo -e "      sudo nmcli connection down direct-connection"
    echo -e "      sudo nmcli connection up direct-connection"
fi

echo ""
echo -e "${BLUE}For additional help, save this output and share with support.${NC}"
echo ""
