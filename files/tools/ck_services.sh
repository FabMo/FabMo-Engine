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
systemctl --no-pager status setup-wlan0_ap.service
echo " "
echo "------------------------------------------------------------"
echo "----System Networking---------------------------------------"
systemctl --no-pager status NetworkManager
systemctl --no-pager status dnsmasq
systemctl --no-pager status hostapd



