The FabMo Engine
================
The FabMo engine is host software that connects to a G2 motion control platform and manages it, exposing a web interface.  The engine serves the following major functions:

* Streaming of G-Code files to G2
* Monitoring of G2 motion state and cycle progress
* Storage and management of files (that currently cannot be stored on G2)
* Interpretation of the OpenSBP (ShopBot) language
* Exposure of an API that allows clients to connect to the motion system through the web

The source code documentation is available here: http://shopbottools.github.io/FabMo-Engine/ 

Dependencies
------------
The engine runs best on linux, but can run with limited functionality on windows.  To run the engine, you need the following software packages:

* NodeJS (http://nodejs.org/)
* restify 
* serialport
* process
* colors (optional, for colorized log output)
* tingodb

Installing the Engine
---------------------
The engine is run from source, and only needs to be checked out and stored in a local directory.   There are a few directories that you need to have created for the engine to work properly.  Under linux, these are `/opt/shopbot/parts` and `/opt/shopbot/tmp`.  On windows, use `c:\opt\shopbot\parts` and `c:\opt\shopbot\tmp` The process that is running the engine server needs read/write access to both of these directories.

Running the Engine
------------------
For debugging the engine, you can run it directly from the command prompt with `node server.js`
