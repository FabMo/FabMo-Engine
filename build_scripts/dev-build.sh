#!/bin/sh
# Builds my current dev version ... need to have branch identified right!!!

clear
echo "==> Building dev version"
cd /
echo "--> ... be at root"
echo "--> ... clearing all Fabmo dirs"

sudo systemctl stop fabmo
echo "--> ... Stopped fabmo service"

sudo rm -rf /fabmo && sudo rm -rf /opt/fabmo
echo

echo "--> Cloning current version of FabMo Engine from GitHub"
cd /
sudo git clone https://github.com/fabmo/fabmo-engine ./fabmo

cd /fabmo
echo

echo "--> Setting Branch"
sudo git checkout master
git status
echo

# starts the 
cd pythonUtils
make -f MakeFile # installs usb status logger deamon
sudo apt-get install i2c-tools # ensures i2c serial tools are avalible
output=$(i2cdetect -y 1) 
if echo "$output" | grep -q "3c"; then # checks if display is connected
    sh run_i2c_display.sh & # Runs line in background
fi
unset $output
cd ..

echo "--> Ready for npm install"
sudo npm install
sudo npm install multer # Used for the usb fileFilesRoutes.js to serve the usb files

echo
echo "================================================="
echo "==> Seem to have done it ... "
echo "STARTING FabMo!"
echo "================================== check path! =="
echo
sudo npm run dev

