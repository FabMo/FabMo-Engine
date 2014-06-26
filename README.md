The FabMo Engine
===========
This is the server software that runs the G2-Based shopbot platform and provide a full API to allow high level applications to talk with the tool.  This implementation uses node.js for both the web-service as well as the logic for communicating with the tool.

## Dependencies

* restify
* process
* lazy
* serialport
* TingoDB

## Installation

To install on the raspberry pi, beaglebone, or other Archlinux-ARM powered SBC, simply run `build-server.sh` while connected to the network.  All of the appropriate dependencies should be downloaded and installed automatically, and the source of the application pulled from github and placed in `/opt/shopbot/app`
