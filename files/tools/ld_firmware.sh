#!/bin/sh

# Does the initial load and and initialization of the FabMo-G2 Control Card
# Card needs to be powered and fresh or reset


echo " "
echo "LOADING G2 INITIAL FIRMWARE ================================"
echo " - press red button while starting; hold 10 sec"
echo " "
cd /fabmo
until bossac -w -v ./firmware/g2.bin; do
    echo "bossac failed, retrying in 2 seconds ..."
    sleep 2
done
bossac -b
bossac -R
echo " "
echo "G2 Firmware loaded and initialized successfully."
echo " > You will need to POWERCYCLE the TOOL and RPi to reboot. Confirm heartbeat LED is blinking."

