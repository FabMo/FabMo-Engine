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

#install nodejs dependencies
pacman -S --needed nodejs

# Clear out any old installation and create environment directories
rm -rf /opt/shopbot
mkdir -p /opt/shopbot
mkdir -p /opt/shopbot/logs

# Create the virtualenv that will house the python application
virtualenv --no-site-packages /opt/shopbot/env

# Get the code
git clone https://github.com/jlucidar/shopbot-example-app.git /opt/shopbot/app

# Configure the python environment
source /opt/shopbot/env/bin/activate
pip install -r /opt/shopbot/app/conf/requirements.txt
deactivate

# Configure the webserver
cp /opt/shopbot/app/conf/shopbot_api.service /etc/systemd/system

# Configure shopbotd which talks to the tool
cp /opt/shopbot/app/conf/shopbotd.service /etc/systemd/system

chown -R shopbot /opt/shopbot 

# Kill apache in case it's running - it can't run alongside nginx
systemctl disable httpd
systemctl stop httpd

# Start up server
systemctl enable memcached
systemctl enable shopbot_api
systemctl enable shopbotd
systemctl start memcached
systemctl start shopbot_api
systemctl start shopbotd

