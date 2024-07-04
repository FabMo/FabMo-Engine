#!/bin/bash

# Function to open a new terminal window and execute a command
open_terminal() {
  local title="$1"
  local command="$2"
  lxterminal --title="$title" --command="bash -c '$command; exec bash'" &
  sleep 2
}

# Commands to run in each terminal window
command1="sudo nmcli m"
title1="NetManager M"
command2="sudo tail -f /var/log/network_monitor.log"
title2="Monitoring Script Log"
command3="sudo journalctl -u dnsmasq -f"
title3="dnsmasq"
command4="sudo journalctl -u NetworkManager -f"
title4="NetManager JCtl"

# Open terminal windows with the specified commands
open_terminal "$title1" "$command1"
open_terminal "$title2" "$command2"
open_terminal "$title3" "$command3"
open_terminal "$title4" "$command4"

# Add a delay to ensure terminals are fully open
sleep 3
echo "Please manually arrange the terminal windows."