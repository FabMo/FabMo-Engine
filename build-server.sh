#!/bin/sh
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root" 1>&2
   exit 1
fi

pacman -Sy

# Install system dependencies
pacman -S --needed nginx

# Install python dependencies
pacman -S --needed python2 python2-pip
pip2 install virtualenv

# Clear out any old installation and create environment directories
rm -rf /opt/shopbot
mkdir -p /opt/shopbot
mkdir -p /opt/shopbot/logs
mkdir -p /opt/shopbot/pid

# Create the virtualenv that will house the python application
virtualenv --no-site-packages /opt/shopbot/env
source /opt/shopbot/env/bin/activate
pip install flask gunicorn pyserial
deactivate

# Get the code
git clone https://github.com/ShopbotTools/shopbot-example-app.git /opt/shopbot/app

# Configure the webserver
mkdir -p /etc/nginx/sites-available
mkdir -p /etc/nginx/sites-enabled
cp /opt/shopbot/app/conf/nginx.conf /etc/nginx/nginx.conf
cp /opt/shopbot/app/conf/nginx-shopbot.conf /etc/nginx/sites-available/nginx-shopbot.conf
ln -s /etc/nginx/sites-available/nginx-shopbot.conf /etc/nginx/sites-enabled/nginx-shopbot.conf

# Configure gunicorn
cp /opt/shopbot/app/conf/gunicorn.* /etc/systemd/system

chown -R shopbot /opt/shopbot 
# Start up server
systemctl enable gunicorn
systemctl enable nginx
systemctl start gunicorn
systemctl start nginx

