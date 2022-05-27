#!/bin/sh

cp /fabmo/files/*.service /etc/systemd/system/
cp /fabmo/files/*.path /etc/systemd/system/
cp /fabmo/files/export_network_config_thumb.sh /home/pi/bin/.

chown pi /home/pi/bin/export_network_config_thumb.sh
chgrp pi /home/pi/bin/export_network_config_thumb.sh

systemctl daemon-reload
systemctl restart export-netcfg-thumbdrive
