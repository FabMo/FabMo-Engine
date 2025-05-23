#!/bin/bash

# https://retropie.org.uk/forum/topic/2295/runcommand-warning-if-voltage-temperature-throttling
# modified slightly ...
# using: vcgencmd get_throttled
#          throttled=0x50005
# New info for Rpi5: https://forums.raspberrypi.com/viewtopic.php?t=370719

#Flag Bits
UNDERVOLTED=0x1
CAPPED=0x2
THROTTLED=0x4
HAS_UNDERVOLTED=0x10000
HAS_CAPPED=0x20000
HAS_THROTTLED=0x40000

#Text Colors
GREEN=`tput setaf 2`
RED=`tput setaf 1`
NC=`tput sgr0`

#Output Strings
GOOD="${GREEN}NO${NC}"
BAD="${RED}YES${NC}"

#Get Status, extract hex
STATUS=$(vcgencmd get_throttled)
STATUS=${STATUS#*=}

echo " "
echo "================================ Volt & Temp Fail Report "
echo -n "Status (combined in binary; > 0 means throttling): "
(($STATUS!=0)) && echo "${RED}${STATUS}${NC}" || echo "${GREEN}${STATUS}${NC}"
echo "----------------------------------------------decoded--- "

echo "Undervolted:"
echo -n "   Now: "
((($STATUS&UNDERVOLTED)!=0)) && echo "${BAD}" || echo "${GOOD}"
echo -n "  Past: "
((($STATUS&HAS_UNDERVOLTED)!=0)) && echo "${BAD}" || echo "${GOOD}"

echo "Throttled (voltage OK? then throttling from temp):"
echo -n "   Now: "
((($STATUS&THROTTLED)!=0)) && echo "${BAD}" || echo "${GOOD}"
echo -n "  Past: "
((($STATUS&HAS_THROTTLED)!=0)) && echo "${BAD}" || echo "${GOOD}"

echo "Frequency Capped:"
echo -n "   Now: "
((($STATUS&CAPPED)!=0)) && echo "${BAD}" || echo "${GOOD}"
echo -n "  Past: "
((($STATUS&HAS_CAPPED)!=0)) && echo "${BAD}" || echo "${GOOD}"
echo "-------------------------------------------------------- "
echo "volts ===============(core Pi4~0.8-1.2V; Pi5~0.7-0.9V)== "
# Loop through each id and echo the voltage
for id in core sdram_c sdram_i sdram_p ; do
    echo -e "$id:\t$(vcgencmd measure_volts $id)"
done
echo "======================================================== "
echo " "
