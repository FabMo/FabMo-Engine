#!/bin/bash
#### ATTENTION:
#### IF YOU WANT TO CHANGE WHAT HAPPENS when a thumbdrive 
#### is mounted, please read /fabmo/bin/readme.txt to learn 
#### what should happen.

## System Tools
LS="/bin/ls"
HEAD="/usr/bin/head"

## fabmo bin directory for utilities ###########################
FABMO_BIN="/fabmo/bin"

## get the mount point of the new thumb drive ##################
MEDIA_MOUNT="/media/pi"
THUMB_DIR_MOUNT=`$LS $MEDIA_MOUNT | $HEAD -1`



###### Get the work of exporting things done ###################
# Invoke the fabmo data collector

logger "Invoking data collector with args: $MEDIA_MOUNT and $THUMB_DIR_MOUNT"
if [ -e $FABMO_BIN/collect_and_export_data_to_usb_drive ]
	then $FABMO_BIN/collect_and_export_data_to_usb_drive "$MEDIA_MOUNT/$THUMB_DIR_MOUNT" &
fi
logger "post data collector launch, data collector running async now"

###### Finished with body of work to do ########################




###### Staying awake until drive is gone #######################
# Staying awake until thumbdrive is removed or unmounted
# then exiting, if we exit earlier, systemd will relaunch this
# script repeatedly and then kill the service
while true; do
	if [ ! -d "/media/pi/$THUMB_DIR_MOUNT" ] 
		then exit 0;
	fi
	sleep 1
done
