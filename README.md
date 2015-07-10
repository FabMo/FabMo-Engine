# The FabMo Engine
The FabMo engine is host software that connects to a G2 motion control platform and manages it, exposing a web interface.  The engine serves the following major functions:

* Streaming of G-Code files to G2
* Monitoring of G2 motion state and cycle progress
* Storage and management of files (that currently cannot be stored on G2)
* Interpretation of the OpenSBP (ShopBot) language
* Hosting of the "FabMo Dashboard" a web frontend to the FabMo Engine that provides an app hosting environment

## Documentation
[Source Code Documentation](http://shopbottools.github.io/FabMo-Engine/) 

[API Documentation](http://shopbottools.github.io/FabMo-Engine/api)

## Quick Start
1. Check out the source code https://github.com/ShopBotTools/FabMo-Engine.git
2. From inside the source directory, install all of the engine dependencies with `npm install`
3. Create the engine data directory at `/opt/fabmo` or `C:\opt\fabmo` if you're on windows.  Make sure the user running the engine has write access to this directory.
4. Start the engine with `npm run debug` for development mode or `npm start` for production mode.

When the engine starts, it will connect to G2 and setup an http server to accept connections on port 9876.  Once the engine is running you can visit http://localhost:9876/ or http://0.0.0.0:9876/ to use the engine dashboard.

## Installing the Engine
The engine is run from source, and only needs to be checked out and stored in a local directory.   The engine needs access to the directory `/opt/fabmo` to store its internal settings, apps, etc.

### On the Intel Edison
To install the engine in the "standard" location on the Intel Edison, perform the following steps.

1. Checkout the source into `/fabmo` with `git checkout https://github.com/FabMo/FabMo-Engine /fabmo`
2. Install dependencies using npm: `cd /fabmo; npm install`
3. Install the systemd service file `cp /fabmo/conf/fabmo.service /etc/systemd/system`
4. Set the appropriate permissions on the service file `chmod 0775 /etc/systemd/system/fabmo.service`
5. Inform systemd of the unit file change `systemd daemon-reload`
6. Enable the new service `systemctl enable fabmo`
7. Start the new service immediately `systemctl start fabmo`
8. After the engine has had time to start, check its status: `systemctl status fabmo`

## Running the Engine
For debugging the engine, you can run it directly from the command prompt with `npm start` or `node server.js`

## Development
A number of grunt tasks have been set up to facilitate engine development.  To see them, run `grunt` with no arguments in the source directory, and a list will be produced with explanations.  Currently, tasks exist for testing and generating/publishing documentation.
