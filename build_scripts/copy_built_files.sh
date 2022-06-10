#!/bin/sh 

: "${FABMO_HOME:=/fabmo}"

cp -R ${FABMO_HOME}/dashboard/static/* ${FABMO_HOME}/dashboard/build/
cp ${FABMO_HOME}/dashboard/build/dashboard.css ${FABMO_HOME}/dashboard/build/css/dashboard.css
