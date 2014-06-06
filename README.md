# Shopbot Tool Platform

This is the server software that runs the G2-Based shopbot platform.  This implementation uses node.js for both the web-service as well as the logic for communicating with the tool.

## Dependencies

* restify
* process
* lazy
* serialport
* TingoDB
* 

## Installation

To install on the raspberry pi, beaglebone, or other Archlinux-ARM powered SBC, simply run `build-server.sh` while connected to the network.  All of the appropriate dependencies should be downloaded and installed automatically, and the source of the application pulled from github and placed in `/opt/shopbot/app`

## Usage

To run the server from source (without installing), simply invoke `server.js` with node:

```bash
node server.js
```

If you have installed the application and want to run it as a system service, use `systemctl`:

```bash
systemctl start shopbot-api
```

To enable the service at startup:

```bash
systemctl enable shopbot-api
```
