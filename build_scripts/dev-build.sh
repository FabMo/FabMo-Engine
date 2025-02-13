#!/bin/sh
# Builds my current dev version ... need to have branch identified right!!!

clear
echo "==> Building dev version"
cd /
echo "--> ... be at root"
echo "--> ... clearing all Fabmo dirs"

sudo systemctl stop fabmo
echo "--> ... Stopped fabmo service"

sudo rm -rf /fabmo
sudo rm -rf /opt/fabmo
echo

echo "--> Cloning current version of FabMo Engine from GitHub"
cd /
sudo git clone https://github.com/fabmo/fabmo-engine ./fabmo

cd /fabmo
echo

cd pythonUtils
make -f MakeFile
sh run_i2c_display.sh &
cd ..

echo "--> Setting Branch"
sudo git checkout master
git status
echo

echo "--> Ready for npm install"
sudo npm install

echo
echo "================================================="
echo "==> Seem to have done it ... "
echo "STARTING FabMo!"
echo "================================== check path! =="
echo
sudo npm run dev

