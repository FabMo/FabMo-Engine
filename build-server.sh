#!/bin/sh
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root" 1>&2
   exit 1
fi

systemctl enable ntpd
systemctl start ntpd

pacman -Sy

# Install system dependencies
pacman -S --needed nginx memcached gnu-netcat ntpd

# Install python dependencies
pacman -S --needed python2 python2-pip
pip2 install virtualenv

# Clear out any old installation and create environment directories
rm -rf /opt/shopbot
mkdir -p /opt/shopbot
mkdir -p /opt/shopbot/logs

# Create the virtualenv that will house the python application
virtualenv --no-site-packages /opt/shopbot/env

# Get the code
git clone https://github.com/ShopbotTools/shopbot-example-app.git /opt/shopbot/app

# Configure the python environment
source /opt/shopbot/env/bin/activate
pip install -r /opt/shopbot/app/conf/requirements.txt
deactivate

# Configure the webserver
mkdir -p /etc/nginx/sites-available
mkdir -p /etc/nginx/sites-enabled
cp /opt/shopbot/app/conf/nginx.conf /etc/nginx/nginx.conf
cp /opt/shopbot/app/conf/nginx-shopbot.conf /etc/nginx/sites-available/nginx-shopbot.conf
ln -s /etc/nginx/sites-available/nginx-shopbot.conf /etc/nginx/sites-enabled/nginx-shopbot.conf

# Configure gunicorn
cp /opt/shopbot/app/conf/gunicorn.* /etc/systemd/system

# Configure shopbotd which talks to the tool
cp /opt/shopbot/app/conf/shopbotd.service /etc/systemd/system

chown -R shopbot /opt/shopbot 

# Kill apache in case it's running - it can't run alongside nginx
systemctl disable httpd
systemctl stop httpd

# Start up server
systemctl enable memcached
systemctl enable gunicorn
systemctl enable nginx
systemctl enable shopbotd
systemctl start memcached
systemctl start gunicorn
systemctl start nginx
systemctl start shopbotd

