# The FabMo Engine
The FabMo engine is host software that connects to a G2 motion control platform and manages it, exposing a web interface.  The engine serves the following major functions:


* Streaming of G-Code files to G2
* Monitoring of G2 motion state and cycle progress
* Storage and management of files (that currently cannot be stored on G2)
* Interpretation of the OpenSBP (ShopBot) language
* Hosting of the "FabMo Dashboard" a web frontend to the FabMo Engine that provides an app hosting environment

## Documentation
[Source Code Documentation](http://fabmo.github.io/FabMo-Engine/)

[API Documentation](http://fabmo.github.io/FabMo-Engine/api)

## Quick Start
1. Install nodejs - The officially supported version is v16.14.0  - Newer versions *may not work at this time*
1. Check out the source code https://github.com/FabMo/FabMo-Engine
1. From inside the source directory, install all of the engine dependencies with `npm install`
1. Create the engine data directory at `/opt/fabmo` or `C:\opt\fabmo` if you're on windows.  Set the permissions on this directory so that the user running the engine can read/write to it.
1. Start the engine with `npm run debug` for development mode or `npm start` for production mode.
1. On Windows it is unlikely that the default COM port settings are satisfactory.  After running the engine once, edit `C:\fabmo\config\engine.json` and set the two COM ports for your platform with the appropriate values for your system.

** Note that you should not need to run the engine as a privileged user.  If you have to run your engine using `sudo` check your node installation and the permissions settings for the /opt/fabmo directory **

When the engine starts, it will connect to G2 and setup an http server to accept connections on port 80.  Once the engine is running you can visit [http://localhost/](http://localhost/) to use the fabmo dashboard.

## Installing the Engine
The engine is run from source, and only needs to be checked out and stored in a local directory.  Run `npm install` from the source directory to install the needed dependencies and perform the webpack step that builds the frontend.

### On the Raspberry Pi

![Raspberry Pi](/doc/raspi.png)

To install the engine in the "standard" location on the Raspberry Pi, perform the following steps.

1. Checkout the source into `/fabmo` with `git clone https://github.com/FabMo/FabMo-Engine /fabmo`
2. Checkout the appropriate branch of the source tree.  The `release` branch is the most recent stable release.  (`git checkout release`)
3. Install dependencies using npm: `cd /fabmo; npm install`
4. Run the engine using the instructions below

## Running the Engine
For debugging the engine, you can run it directly from the command prompt with `npm start` or `node server.js` - make sure you have built the dashboard with `npm run webpack` - alternatively, you can run `npm run dev` which will run the system in debug mode (which adds some logging and more aggressively reloads apps) as well as run the webpack first.  If you want to run in debug mode, but skip the webpack step, run `npm run debug`

## Development Automation
A number of grunt tasks have been set up to facilitate engine development.  To see them, run `grunt` with no arguments in the source directory, and a list will be produced with explanations.

## Building the Documentation
Source code documentation is generated with groc, and API documentation for the engine's REST API is generated with apidoc.  To generate documentation: `grunt doc` - to generate documentation and push it to Github Pages, linked at the top of this readme: `grunt doc-dist`

## Getting Started with Development
The entry point for the application is `server.js` but for an overview of how the engine starts, begin with `engine.js` - particularly the `start` method.  This is the function that initializes the system and starts all the processes (including the webserver) that make the application work.

