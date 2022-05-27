#!/bin/sh

: "${FABMO_HOME:=/fabmo}"

cp ${FABMO_HOME}/files/*.service /etc/systemd/system/
cp ${FABMO_HOME}/files/*.path /etc/systemd/system/


cp ${FABMO_HOME}/files/export_network_config_thumb.sh /home/pi/bin/.
chown pi /home/pi/bin/export_network_config_thumb.sh
chgrp pi /home/pi/bin/export_network_config_thumb.sh

systemctl daemon-reload
systemctl restart export-netcfg-thumbdrive
