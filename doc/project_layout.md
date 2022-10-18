# /config

The config package manages configuration data on disk and in memory. It provides
functions for loading, updating, and saving configuration information.

# /dashboard

## The FabMo Dashboard

This directory contains the client-side portion of the FabMo system. The files in the `dashboard/static` directory make up the dashboard scaffolding that is served to clients connecting to the engine with their browsers. `dashboard/apps` contains the built-in apps that come with the engine installation. App hosting is discussed below.

## Apps

The dashboard apps are hosted from a special location that resides outside the source tree. (In general, this is `/opt/fabmo/approot`) The reason for this is because apps are installable by users, and it is important that nothing inside the source tree is ever written, other than during a software update. When the engine starts, FabMo apps are copied from their source directory (and decompressed as needed) into the hosted directory, where they are served by the engine.

## System Apps

There are two sources of apps in FabMo. _System Apps_ Are apps that come with the engine, and are generally not removable. _User Apps_ are apps that are installed by users, and can be added and removed at any time. From the Engine's perspective, they work the same way. An app is simply a source of HTML/js/CSS/etc. that is copied to a hosted directory when the engine is launched. (Or when the app is installed at runtime) The system apps are stored in the `apps` subdirectory of the dashboard. They are generally not stored compressed because they are routinely revised, along with the engine source.

# /data

## /data/g2_errors.json

This file is generated from the `errors.h` header in the G2 source tree. It should be regenerated whenever there is a firmware change that changes error codes.

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


# /profiles

This is the profiles directory. Profiles are collections of settings, macros and apps that can be applied to an engine installation to produce a sensible default state. For an example of a profile see http://github.com/fabmo/fabmo-profile-dt

This profiles directory holds all of the profiles for an installation. All but the `default` subdirectory are deliberately ignored in git (except development exceptions), so that even when running the engine from source, profiles can be freely dropped into this location and be picked up by the engine.

For more information about profiles and how they work, see `profiles.js`

# /routes

This is where application routes are stored. Each js module in this folder exports a single function, which accepts the restify server object, and is understood to attach routes to it. Routers are broken up by function. They can be disabled individually by moving them out of this folder, or changing their names, and new routes can be added simply by putting new modules in this directory.

`index.js` is responsible for loading all the routes, and all the other javascript files in the directory contain the routes themselves.
