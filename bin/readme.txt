
How does "collect_and_export_data_to_usb_drive" get invoked?
**** FYI:  (short version) ****
All changes to data collection should happen in
"collect_and_export_data_to_usb_drive". It can be rewritten into a new
language. The critical features are that it is located here and that it is
readable by the user "pi" and does things that "pi" has permission to do and
that it is "executable" (file permissions)

**** Long detailed version: ****

In "/etc/systemd/system" are 2 files:
  export-netcfg-thumbdrive.path
  export-netcfg-thumbdrive.service

They are managed by systemd (the daemon)

"export-netcfg-thumbdrive.path" monitors a path (/media/pi) for any changes.
When a usb thumb is mounted, a subdirectory appears in /media/pi and
"export-netcfg-thumbdrive.path" starts the service name
"export-netcfg-thumbdrive.service". This service wakes up, and launches a
script in "/home/pi/bin" named "export_network_config_thumb.sh". This script
figures out the name of the mount point of the usb thumb drive 

(currently the script just picks the first mount point in "/media/pi". 
It makes no provision for a 2nd thumb drive)

Having found the mount point, the script invokes
"collect_and_export_data_to_usb_drive" in this directory, giving it as a
command line parameter, the path to the mount point.

When this script exits, control returns to "export_network_config_thumb.sh"
which then must basically sit "idle" until the usb drive goes away (if
"export_network_config_thumb.sh" exits while the drive is still mounted, then
the "export-netcfg-thumbdrive.path" will restart the
"export-netcfg-thumbdrive.service", and this will happen so fast and furious
that systemd will disable the service.

Finally, when the thumbdrive is removed "export-netcfg-thumbdrive.service" will
exit, and the "export-netcfg-thumbdrive.path" will be ready to start things
over when a drive is plugged back in.

If you want to add to what happens when a drive is plugged in, do it by
editing: "collect_and_export_data_to_usb_drive"

If you have to change either of 
  export-netcfg-thumbdrive.path
  export-netcfg-thumbdrive.service
then please run: 
% sudo systemctl daemon-reload

after your edits, and you may need to do:
% sudo systemctl restart export-netcfg-thumbdrive.path

You do not need to start or restart export-netcfg-thumbdrive.service, it is not
an independent service.
