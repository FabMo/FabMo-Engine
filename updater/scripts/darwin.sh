#!/bin/sh

# Pull the latest master
git pull origin master

# Update npm dependencies
npm install

# Delete the approot cache
rm -rvf /opt/fabmo/approot
