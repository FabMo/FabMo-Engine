FabMo Previewer App
===================

The previewer app allows you to view a 3D drawing of GCode or OpenSBP tool
paths.  You can rotate, pan or zoom the drawing using mouse buttons.  The view
includes the following:

  * The dimensions of the bounds of the tool path.
  * X, Y and Z axes indicator at centered (0, 0, 0).
  * A conical representation of the tool and it's current position.
  * A grid on the XY plane with user configurable spacing.
  * The path it self color coded by move type.

## Live Mode
When the currently running program is selected for viewing the display will
show the current tool position in real-time and the completed parts of the path
will be colored magenta.

## Path Simulation
When the program is not currently running the user can click the "play" button
to start a simulation of the program.  This simulation can be paused or
restarted.  Simulation speed is configurable.

## Snap to View
Three buttons in the top left of the screen make it possible to snap to views
looking down any one of the three axes.

## Settings Dialog
The gear button will open the settings dialog where the following can be
configured:

  * Simulation speed
  * Display Units
  * Grid step size
  * Show or hide the grid, dimensions, axes or tool.

## Help Dialog
The "i" button in the bottom right opens the help dialog which provides
information about the app's controls, buttons and settings.

## Software Design
The app consists of HTML, CSS, JavaScript, JSON and image files.  These files
have the following purposes:

| File             | Description                                               |
| ---------------- | --------------------------------------------------------- |
| package.json     | Application meta data. |
| icon.png         | Application icon. |
| index.html       | Defines the structure of the UI. |
| css/style.css    | Sets HTML element colors, positions and other attributes. |
| js/README.md     | This file. |
| js/app.js        | Main entry point, setup, FabMo events mapping, etc. |
| js/viewer.js     | Central hub of the application, connects other parts. |
| js/parser.js     | GCode parser. (https://github.com/ryansturmer/node-gcode) |
| js/move.js       | Tracks each GCode move. |
| js/path.js       | Handles GCode processing, simulation and live view. |
| js/gui.js        | Handles buttons and dialogs. |
| js/tool.js       | Tool view. |
| js/grid.js       | Grid view. |
| js/axes.js       | Axes view. |
| js/dimensions.js | Dimensions view. |
| js/util.js       | Utility functions used by other parts. |
| js/cookie.js     | Read and write browser cookies.  Used to save settings. |
| js/three.js      | 3D graphics library. (https://threejs.org/) |
| js/OrbitControls.js | Converts mouse inputs to camera positions. |
| js/helvetiker_regular.typeface.js | THREE.js font file. |
| images/*.png     | Button icons. |
