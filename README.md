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
The engine runs best on Linux/OSX, but has limited support for Microsoft Windows as well.  To obtain the dependencies, just run `npm start` in the source code directory.  For a list of dependencies and their versions, consult `package.json`

Installing the Engine
---------------------
The engine is run from source, and only needs to be checked out and stored in a local directory.   There are a few directories that you need to have created for the engine to work properly.  Under linux, these are `/opt/shopbot/parts` and `/opt/shopbot/tmp`.  On windows, use `c:\opt\shopbot\parts` and `c:\opt\shopbot\tmp` The process that is running the engine server needs read/write access to both of these directories.

Running the Engine
------------------
For debugging the engine, you can run it directly from the command prompt with `node server.js`or `npm start`
