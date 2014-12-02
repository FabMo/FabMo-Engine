#!/bin/sh
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root" 1>&2
   exit 1
fi

pacman -Sy

# Install system dependencies
pacman -S --needed gnu-netcat ntp python2 vim base-devel

# sytem time setings (necessary for some SSL stuff)
systemctl enable ntpd
systemctl start ntpd

# Clear out any old installation and create environment directories
rm -rf /opt/fabmo/app

mkdir -p /opt/fabmo

if [ $1 == "--factory-reset" ]
then
	rm -rf /opt/fabmo/parts
	rm -rf /opt/fabmo/db
fi

mkdir /opt/fabmo/logs #log files folder
mkdir /opt/fabmo/parts #file storage folder
mkdir /opt/fabmo/tmp #temporary folder
mkdir /opt/fabmo/db #database folder

# Get the code
git clone https://github.com/jlucidar/shopbot-example-app.git /opt/fabmo/app

#install nodejs dependencies
pacman -S --needed nodejs
cd /opt/fabmo/app/

# Python is needed by node-gyp to build serialport, but archlinux defaults to python 3
export PYTHON=`which python2`
npm install process restify serialport tingodb

# Configure the service 
cp /opt/fabmo/app/conf/shopbot_api.service /etc/systemd/system

## INSTALL THE UPLOAD APP
echo "DO YOU WANT TO INSTALL THE BASIC LOCAL APP ON THE DEVICE (need a Apache server, will ERASE the former content in /var/http) ? (y/n) "
read answer
if [ answer == "y" ]
then
	systemctl enable httpd
	systemctl start httpd
	rm -rf /srv/http
	ln -s /opt/fabmo/app/static /srv/http
fi

# Start up server
systemctl enable shopbot_api
systemctl start shopbot_api

