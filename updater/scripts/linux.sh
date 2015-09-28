#!/bin/sh

# Pull latest from repository
git pull origin master

# Update dependencies with npm
npm install

# Delete the app cache
rm -rf /opt/fabmo/approot

#systemctl restart fabmo