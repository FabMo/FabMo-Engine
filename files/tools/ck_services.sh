#!/bin/sh

# Checks the systemd services running FabMo

echo "Checking the status of Key Fabmo services ============================"
echo " "
echo "----FabMo---------------------------------------------------"
systemctl --no-pager status fabmo.service
echo " "
echo "----Updater-------------------------------------------------"
systemctl --no-pager status fabmo-updater.service
echo " "
echo "----User Networking-----------------------------------------"
systemctl --no-pager status network-monitor.service
echo " "
echo "----System Networking---------------------------------------"
systemctl --no-pager status NetworkManager



