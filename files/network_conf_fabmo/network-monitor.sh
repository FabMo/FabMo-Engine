#!/bin/bash

INTERFACE="eth0"
LAN_PROFILE="lan-connection"
PC_PROFILE="direct-connection"
DIRECT_IP="192.168.44.1"
LOGFILE="/var/log/network_monitor.log"
FAIL_COUNT_FILE="/tmp/nm-fail-count"
LAST_PROFILE=""

log() {
    /bin/echo "$(/bin/date) - $1" >> $LOGFILE
}

check_active_profile() {
    /usr/bin/nmcli -t -f NAME connection show --active | /bin/grep -q "$1"
}

bring_down_profile() {
    log "Bringing down profile $1"
    /usr/bin/nmcli connection down "$1"
}

bring_up_profile() {
    log "Bringing up profile $1"
    /usr/bin/nmcli connection up "$1"
}

get_current_ip() {
    /usr/sbin/ip addr show $INTERFACE | /bin/grep 'inet ' | /usr/bin/awk '{print $2}' | /usr/bin/cut -d/ -f1
}

increment_failure_count() {
    if [ -f $FAIL_COUNT_FILE ]; then
        FAIL_COUNT=$(cat $FAIL_COUNT_FILE)
        FAIL_COUNT=$((FAIL_COUNT + 1))
    else
        FAIL_COUNT=1
    fi
    echo $FAIL_COUNT > $FAIL_COUNT_FILE
    log "Failure count incremented to $FAIL_COUNT"
}

reset_failure_count() {
    log "Resetting failure count."
    rm -f $FAIL_COUNT_FILE
}

restart_dnsmasq_if_needed() {
    CURRENT_PROFILE=$1
    if [ "$CURRENT_PROFILE" != "$LAST_PROFILE" ]; then
        log "Profile changed to $CURRENT_PROFILE, reconfiguring dnsmasq"
        
        if [ "$CURRENT_PROFILE" = "direct" ]; then
            log "Activating direct-mode dnsmasq config (DHCP on eth0 + wlan0_ap)"
            sudo ln -sf /etc/dnsmasq.d/direct-mode.conf /etc/dnsmasq.d/active-mode.conf
            
            # CRITICAL: Wait for eth0 to have IP 192.168.44.1
            log "Waiting for eth0 to have IP 192.168.44.1..."
            MAX_WAIT=20
            for i in $(seq 1 $MAX_WAIT); do
                # Check if eth0 has the direct IP
                ETH0_IP=$(/usr/sbin/ip addr show eth0 2>/dev/null | /bin/grep "inet " | /usr/bin/awk '{print $2}' | /usr/bin/cut -d/ -f1)
                if [ "$ETH0_IP" = "$DIRECT_IP" ]; then
                    log "SUCCESS: eth0 has IP $DIRECT_IP (attempt $i/$MAX_WAIT)"
                    break
                fi
                log "Attempt $i/$MAX_WAIT: eth0 IP is '$ETH0_IP', waiting for $DIRECT_IP..."
                sleep 1
            done
            
            # Final check
            ETH0_IP=$(/usr/sbin/ip addr show eth0 2>/dev/null | /bin/grep "inet " | /usr/bin/awk '{print $2}' | /usr/bin/cut -d/ -f1)
            if [ "$ETH0_IP" != "$DIRECT_IP" ]; then
                log "ERROR: eth0 still doesn't have $DIRECT_IP after ${MAX_WAIT}s wait. Current IP: $ETH0_IP"
            fi
        else
            log "Activating ap-only dnsmasq config (DHCP only on wlan0_ap)"
            sudo ln -sf /etc/dnsmasq.d/ap-only.conf /etc/dnsmasq.d/active-mode.conf
        fi
        
        log "Restarting dnsmasq..."
        sudo systemctl restart dnsmasq
        sleep 2
        
        # Verify dnsmasq bound correctly
        if [ "$CURRENT_PROFILE" = "direct" ]; then
            if sudo /usr/bin/netstat -tulnp 2>/dev/null | /bin/grep dnsmasq | /bin/grep -q "192.168.44.1:53"; then
                log "SUCCESS: dnsmasq is listening on 192.168.44.1:53"
            else
                log "ERROR: dnsmasq is NOT listening on 192.168.44.1:53"
                sudo /usr/bin/netstat -tulnp 2>/dev/null | /bin/grep dnsmasq >> $LOGFILE
            fi
        fi
        
        LAST_PROFILE=$CURRENT_PROFILE
    fi
}

monitor_network() {
    while true; do
        STATE=$(/usr/bin/nmcli device status | /bin/grep $INTERFACE | /usr/bin/awk '{print $3}')
        CURRENT_IP=$(get_current_ip)

        log ""
        log "State: $STATE, IP: $CURRENT_IP"

        case "$STATE" in
            connected)
                log "$INTERFACE is connected."
                log "Current IP: $CURRENT_IP"
                if [ "$CURRENT_IP" = "$DIRECT_IP" ]; then
                    log "Direct connection IP detected. Ensuring Direct PC profile is active."
                    if ! check_active_profile "$PC_PROFILE"; then
                        bring_down_profile "$LAN_PROFILE"
                        bring_up_profile "$PC_PROFILE"
                        restart_dnsmasq_if_needed "direct"
                    fi
                else
                    log "LAN profile detected. Ensuring LAN profile is active."
                    if ! check_active_profile "$LAN_PROFILE"; then
                        bring_down_profile "$PC_PROFILE"
                        bring_up_profile "$LAN_PROFILE"
                        restart_dnsmasq_if_needed "lan"
                    fi
                fi
                reset_failure_count
                ;;
            disconnected|connecting)
                log "$INTERFACE is has disconnected or trying to connect."
                log "$INTERFACE is $STATE."
                if [ -f $FAIL_COUNT_FILE ]; then
                    FAIL_COUNT=$(cat $FAIL_COUNT_FILE)
                    FAIL_COUNT=$((FAIL_COUNT + 1))
                else
                    FAIL_COUNT=1
                fi
                echo $FAIL_COUNT > $FAIL_COUNT_FILE
                log "Failure count incremented to $FAIL_COUNT"
                if [ "$FAIL_COUNT" -ge 2 ]; then
                    log "Failure count exceeded. Switching to Direct PC profile."
                    bring_down_profile "$LAN_PROFILE"
                    bring_up_profile "$PC_PROFILE"
                    reset_failure_count
                    restart_dnsmasq_if_needed "direct"
                else
                    log "Retrying LAN profile."
                    bring_up_profile "$LAN_PROFILE"
                fi
                ;;
            unavailable)
                log "$INTERFACE is $STATE."
                ;;
            *)
                log "Unhandled state: $STATE"
                ;;
        esac

        sleep 5
    done
}

log "Starting network monitor script."
monitor_network
