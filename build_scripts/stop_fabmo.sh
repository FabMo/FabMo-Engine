#!/bin/sh

if [ ! -f /.dockerenv ]; then
# When running inside docker, systemd is hard to do right, so just skip it

sudo systemctl stop fabmo

fi
