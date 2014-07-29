#!/bin/sh

# This is a script for making a beaglebone SD card

if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root" 1>&2
   exit 1
fi

partition=0
make_fs=0
install_bootloader=0
install_root=0
device=""

while getopts "h?pfbrad:" opt; do
    case "$opt" in
    h|\?)
		echo "BeagleBone Black SD Card Maker"
		echo ""
		echo "Options"
		echo "h - Show this help"
		echo "p - Partition card"
		echo "f - Create filesystems"
		echo "b - Install bootloader"
		echo "r - Install root partition"
		echo "a - Do everything"
        echo ""
        exit 0
        ;;
    p)  partition=1  
        ;;
    f)  make_fs=1  
        ;;
    b)  install_bootloader=1  
        ;;
    r)  install_root=1  
        ;;
    a)  partition=1; make_fs=1; install_bootloader=1; install_root=1;  
        ;;
    d)  device=$OPTARG  
        ;;
    esac
done

if [[ "$device" == "" ]]; then
	echo "You must at least specify the -d option to indicate a device!"
	echo "Typical Usage: bbb-make-sdcard.sh -a -d /dev/sda1"
	exit 1
fi

read -p "This will obliterate the partition table on $device... Are you sure? (y/n)" -n 1 -r
echo 
if [[ $REPLY =~ ^[Yy]$ ]]
then 
	if [[ $partition -eq 1 ]]; then
		# Unmount existing filesystems
		umount $device"1"
		umount $device"3"
		umount $device"4"
		umount $device"5"
		umount $device"6"
		umount $device"7"
		umount $device"8"

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
" | fdisk $device
		# List the partition table to console
		fdisk -l $device
	fi

	if [[ make_fs -eq 1 ]]; then
		# Create filesystems on the two partitions
		mkfs.vfat -v -F 16 $device"1"
		mkfs.ext4 -v $device"2"
	fi

	if [[ install_bootloader -eq 1 ]]; then
		# Get and install the bootloader
		wget -N http://archlinuxarm.org/os/omap/BeagleBone-bootloader.tar.gz -P /tmp
		mkdir -p /tmp/boot
		mount $device"1" /tmp/boot
		tar -xvzf /tmp/BeagleBone-bootloader.tar.gz -C /tmp
		cp /tmp/MLO /tmp/boot
		cp /tmp/u-boot.img /tmp/uEnv.txt /tmp/boot
		umount /tmp/boot
		rm -rf /tmp/boot
	fi

	if [[ install_root -eq 1 ]]; then
		# Get an install the root filesystem
		wget -N http://archlinuxarm.org/os/ArchLinuxARM-am33x-latest.tar.gz -P /tmp
		mkdir -p /tmp/root
		mount $device"2" /tmp/root
		tar -xvzf /tmp/ArchLinuxARM-am33x-latest.tar.gz -C /tmp/root
		umount /tmp/root
		rm -rf /tmp/root
	fi
fi
