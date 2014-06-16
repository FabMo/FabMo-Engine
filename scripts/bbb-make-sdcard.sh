#!/bin/sh

# This is a script for making a beaglebone SD card

if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root" 1>&2
   exit 1
fi

read -p "This will obliterate the partition table on $1... Are you sure? (y/n)" -n 1 -r
echo 
if [[ $REPLY =~ ^[Yy]$ ]]
then 

# Create the partition table using fdisk    
echo "
o
n
p
1

+64M
t
e
a
n
p
2


w
" | fdisk $1
fdisk -l $1
mkfs.vfat -v -F 16 $1"1"
mkfs.ext4 -v -F 16 $1"2"

# Get and install the bootloader
wget http://archlinuxarm.org/os/omap/BeagleBone-bootloader.tar.gz -O /tmp/bootloader.tar.gz
mkdir /tmp/boot
mount $1"1" /tmp/boot
tar -xvf /tmp/bootloader.tar.gz -C boot
umount /tmp/boot
rm -rf /tmp/boot

# Get an install the root filesystem
wget http://archlinuxarm.org/os/ArchLinuxARM-am33x-latest.tar.gz -O /tmp/rootfs.tar.gz
mkdir /tmp/root
mount $1"2" /tmp/root
tar -xf /tmp/rootfs.tar.gz -C /tmp/root
umount /tmp/root
rm -rf /tmp/root

fi
