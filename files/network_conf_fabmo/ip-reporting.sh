#!/usr/bin/bash

#just in case we want to use i2c for RTC or other...

enable_i2c_cmd="sudo raspi-config nonint do_i2c 0"
get_i2c_cmd="sudo raspi-config nonint get_i2c"
i2c_enabled=`$get_i2c_cmd`

echo -n "i2c state: "
echo $i2c_enabled

if [ $i2c_enabled == "1" ] 
then
	echo "Enabling i2c"
	$enable_i2c_cmd
else
	echo "i2c enabled"
fi


# systemd is a little messy for starting graphics
# ... so we called this starter from: /etc/xdg/lxsessions/LXDE-pi/
# ... and, now continue with (which itself delays a bit before checking networks and reporting):

python3 /fabmo/files/network_conf_fabmo/ip-reporting.py
