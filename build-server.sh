#!/bin/sh
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root" 1>&2
   exit 1
fi
# sytem time setings
systemctl enable ntpd
systemctl start ntpd

pacman -Sy

# Install system dependencies
pacman -S --needed memcached gnu-netcat ntpd

# Install python dependencies
pacman -S --needed python2 python2-pip
pip2 install virtualenv


# Clear out any old installation and create environment directories
rm -rf /opt/shopbot
mkdir -p /opt/shopbot
mkdir /opt/shopbot/logs
mkdir /opt/shopbot/parts
mkdir /opt/shopbot/tmp



# Create the virtualenv that will house the python application
virtualenv --no-site-packages /opt/shopbot/env

# Get the code
git clone -b node.js https://github.com/jlucidar/shopbot-example-app.git /opt/shopbot/app


#install nodejs dependencies
pacman -S --needed nodejs
cd /opt/shopbot/app/shopbot-api/
npm install restify
pacman -S --needed zeromq
npm install zmq



# Configure the python environment
source /opt/shopbot/env/bin/activate
pip install -r /opt/shopbot/app/conf/requirements.txt
deactivate

# Configure the webserver
cp /opt/shopbot/app/conf/shopbot_api.service /etc/systemd/system

# Configure shopbotd which talks to the tool
cp /opt/shopbot/app/conf/shopbotd.service /etc/systemd/system

chown -R shopbot /opt/shopbot 

## INSTALL THE UPLOAD APP
echo "DO YOU WANT TO INSTALL THE LOCAL APP FOR UPLOADING FILE (need a Apache server, will ERASE the former content in /var/http) ? (y/n) "
read answer
if [ answer == "y" ]
then
	systemctl enable httpd
	systemctl start httpd
	rm -rf /srv/http
	ln -s /opt/shopbot/app/static /srv/http
fi

# Start up server
systemctl enable memcached
systemctl enable shopbot_api
systemctl enable shopbotd
systemctl start memcached
systemctl start shopbot_api
systemctl start shopbotd

