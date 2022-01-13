# /firmware
Currently, this directory contains the previous 'shipping' G2 firmware file for FabMo - which is called `orig_g2.bin`. This version doesn't work with current versions of FabMo. It might work with old handibots. 

This directory includes includes the two most recent 'development' version of the G2 firmware named with version tag as well as one simply labled `g2.bin` (eventually for auto install/update). The version named g2.bin is mostly compatible with modern FabMo but is woefully out of date. When we start releasing to users, g2.bin will be the "current version" shipped with each FabMo release.

At the time of writing the directory contents are typical and look like this: annotated with comments using "//"


g2.bin                               // an outdated but functional g2 core image supported by current fabmo 
g2core_101.57.28build_FabMo-G2.bin   // the same image with more info spelled out in the name
g2core.bin.101.57.30                 // an image known to work that is 1 image behind current
g2core.bin.101.57.31                 // the most current image (as indicated by version number)
orig_g2.bin                          // an image that might work with Handibot era images but not with current

The two images named "g2core.bin.{version_number}" represent the 2 images that will change over time
as we release new images of g2core.bin firmware. The release numbers will increment as we release new images.

