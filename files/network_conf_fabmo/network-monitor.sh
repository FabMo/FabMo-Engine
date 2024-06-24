#!/bin/bash

INTERFACE="eth0"
LAN_PROFILE="lan-connection"
PC_PROFILE="direct-connection"
WIFI_PROFILE="wifi-connection"  # Add the WiFi profile name here
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
    /usr/bin/nmcli connection down "$1" >> $LOGFILE 2>&1
}

bring_up_profile() {
    log "Bringing up profile $1"
    /usr/bin/nmcli connection up "$1" >> $LOGFILE 2>&1
}

enable_wifi_device() {
    log "Enabling WiFi device wlan0"
    /usr/bin/nmcli radio wifi on >> $LOGFILE 2>&1
    /usr/bin/nmcli device set wlan0 managed yes >> $LOGFILE 2>&1
    /usr/bin/nmcli device connect wlan0 >> $LOGFILE 2>&1
}

disable_wifi_device() {
    log "Disabling WiFi device wlan0"
    /usr/bin/nmcli device disconnect wlan0 >> $LOGFILE 2>&1
    /usr/bin/nmcli radio wifi off >> $LOGFILE 2>&1
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
        log "Profile changed to $CURRENT_PROFILE, restarting dnsmasq service"
        sudo systemctl restart dnsmasq
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
                log "$INTERFACE has disconnected or is trying to connect."
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

# Handle specific actions passed as arguments
case "$1" in
    bring_up_profile)
        log "Command: bring_up_profile $2"
        if [ "$2" = "$WIFI_PROFILE" ]; then
            enable_wifi_device
        fi
        bring_up_profile "$2"
        ;;
    bring_down_profile)
        log "Command: bring_down_profile $2"
        bring_down_profile "$2"
        if [ "$2" = "$WIFI_PROFILE" ]; then
            disable_wifi_device
        fi
        ;;
    *)
        log "Invalid command: $1"
        ;;
esac

# If no arguments are provided, run the monitor_network function
if [ -z "$1" ]; then
    log "Starting network monitor script."
    monitor_network
fi
