The FabMo Dashboard
===================
This directory contains the client-side portion of the FabMo system.  The files in the `dashboard` directory are generally what are served to clients that are connecting to the FabMo engine with their web browser.

Apps
----
The dashboard apps are hosted from a special location that resides outside the source tree.  The reason for this is because apps are installable by users, and it is important that nothing inside the source tree is ever written, other than during a software update.  At the start of the engine, FabMo apps are copied from their source directory (and decompressed as needed) into the hosted directory, where they are served by the engine.

System Apps
-----------
There are two sources of apps in FabMo.  _System Apps_ Are apps that come with the engine, and are generally not removable.  _User Apps_ are apps that are installed by users, and can be added and removed at any time.  From the Engine's perspective, they work the same way.  An app is simply a source of HTML/js/CSS/etc. that is copied to a hosted directory when the engine is launched. (Or when the app is installed at runtime)  The system apps are stored in the `apps` subdirectory of the dashboard.  They are generally not stored compressed because they are routinely revised, along with the engine source.
