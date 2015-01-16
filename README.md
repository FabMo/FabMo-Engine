The FabMo Engine
================
The FabMo engine is host software that connects to a G2 motion control platform and manages it, exposing a web interface.  The engine serves the following major functions:

* Streaming of G-Code files to G2
* Monitoring of G2 motion state and cycle progress
* Storage and management of files (that currently cannot be stored on G2)
* Interpretation of the OpenSBP (ShopBot) language
* Hosting of the "FabMo Dashboard" a web frontend to the FabMo Engine that provides an app hosting environment

Documentation
-------------
[Source Code Documentation](http://shopbottools.github.io/FabMo-Engine/) 

[API Documentation](http://shopbottools.github.io/FabMo-Engine/api)

Quick Start
-----------
1. Check out the source code https://github.com/ShopBotTools/FabMo-Engine.git
2. From inside the source directory, install all of the engine dependencies with `npm install`
3. Create the engine data directory at `/opt/fabmo` or `C:\opt\fabmo` if you're on windows.  Make sure the user running the engine has write access to this directory.
4. Start the engine with `npm start`

When the engine starts, it will connect to G2 and setup an http server to accept connections on port 9876.  Once the engine is running you can visit http://localhost:9876/ or http://0.0.0.0:9876/ to use the engine dashboard.

Installing the Engine
---------------------
The engine is run from source, and only needs to be checked out and stored in a local directory.   The engine needs access to the directory `/opt/fabmo` to store its internal settings, apps, etc.

Running the Engine
------------------
For debugging the engine, you can run it directly from the command prompt with `npm start` or `node server.js`

Development
-----------
A number of grunt tasks have been set up to facilitate engine development.  To see them, run `grunt` with no arguments in the source directory, and a list will be produced with explanations.  Currently, tasks exist for testing and generating/publishing documentation.