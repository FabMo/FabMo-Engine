#!/bin/sh
git pull origin master
rm -rf /opt/fabmo/approot
npm install
systemctl restart fabmo