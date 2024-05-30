#!/bin/sh

# Checks the systemd services running FabMo

echo "Checking the status of services ============================"

echo "----FabMo---------------------------------------------------"
systemctl --no-pager status fabmo.service
echo "----Updater-------------------------------------------------"
systemctl --no-pager status fabmo-updater.service
echo "----User Networking-----------------------------------------"
systemctl --no-pager status maintain_network_mode
echo "----System Networking---------------------------------------"
systemctl --no-pager status hostapd
systemctl --no-pager status wpa_supplicant
systemctl --no-pager status dnsmasq
systemctl --no-pager status dhcpcd



