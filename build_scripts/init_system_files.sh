#!/bin/sh

: "${FABMO_HOME:=/fabmo}"

#cp ${FABMO_HOME}/files/*.service /etc/systemd/system/
#cp ${FABMO_HOME}/files/*.path /etc/systemd/system/

mkdir -p /home/pi/bin/
install -g pi -o pi ${FABMO_HOME}/files/export_network_config_thumb.sh /home/pi/bin/

# if [ ! -f /.dockerenv ]; then
# # When running inside docker, systemd is hard to do right, so just skip it
# systemctl daemon-reload
# systemctl restart export-netcfg-thumbdrive

# fi

