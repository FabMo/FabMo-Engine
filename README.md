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
1. Install nodejs - The officially supported version is v0.12.7  - Newer versions *do not work at this time*
1. Check out the source code https://github.com/ShopBotTools/FabMo-Engine.git
1. From inside the source directory, install all of the engine dependencies with `npm install`
1. Create the engine data directory at `/opt/fabmo` or `C:\opt\fabmo` if you're on windows.  Set the permissions on this directory so that the user running the engine can read/write to it.
1. Start the engine with `npm run debug` for development mode or `npm start` for production mode.
1. On Windows it is unlikely that the default COM port settings are satisfactory.  After running the engine once, edit `C:\fabmo\config\engine.json` and set the two COM ports for your platform with the appropriate values for your system.

** Note that you should not need to run the engine as a privileged user.  If you have to run your engine using `sudo` check your node installation and the permissions settings for the /opt/fabmo directory **

When the engine starts, it will connect to G2 and setup an http server to accept connections on port 80.  Once the engine is running you can visit [http://localhost/](http://localhost/) to use the fabmo dashboard.

## Installing the Engine
The engine is run from source, and only needs to be checked out and stored in a local directory.  Run `npm install` from the source directory to install the needed dependencies.

### On the Intel Edison

![Intel Edison](/doc/intel_edison.jpg)

To install the engine in the "standard" location on the Intel Edison, perform the following steps.

1. Checkout the source into `/fabmo` with `git checkout https://github.com/FabMo/FabMo-Engine /fabmo`
2. Install dependencies using npm: `cd /fabmo; npm install`
3. Install the systemd service file `cp /fabmo/conf/fabmo.service /etc/systemd/system`
4. Set the appropriate permissions on the service file `chmod 0775 /etc/systemd/system/fabmo.service`
5. Inform systemd of the unit file change `systemctl daemon-reload`
6. Enable the new service `systemctl enable fabmo`
7. Start the new service immediately `systemctl start fabmo`
8. After the engine has had time to start, check its status: `systemctl status fabmo`

### On the Raspberry Pi 3

![Raspberry Pi](/doc/raspi.png)

To install the engine in the "standard" location on the Raspberry Pi 3, perform the following steps.

1. Checkout the source into `/fabmo` with `git checkout https://github.com/FabMo/FabMo-Engine /fabmo`
2. Checkout the appropriate branch of the source tree.  The `release` branch is the most recent stable release.  (`git checkout release`)
3. Install dependencies using npm: `cd /fabmo; npm install`
4. Run the engine using the instructions below

## Running the Engine
For debugging the engine, you can run it directly from the command prompt with `npm start` or `node server.js`  Running with `npm run debug` puts the engine in debug mode, in which it does more agressive app reloading.  `npm debug slow` introduces deliberate network latency on GET/POST requests, for testing.  This latency can be adjusted in `engine.js`

## Development
A number of grunt tasks have been set up to facilitate engine development.  To see them, run `grunt` with no arguments in the source directory, and a list will be produced with explanations.
