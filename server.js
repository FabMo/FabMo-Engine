/*
 * server.js
 *
 * Engine server module.
 *
 * This is the entry point for the fabmo engine.  It just starts the engine.
 */
var engine = require("./engine");
// eslint-disable-next-line no-undef
var argv = require("minimist")(process.argv); // process is undefined

// eslint-disable-next-line no-unused-vars
engine.start(function (err, data) {
    // Start the debug monitor if requested, but only after the engine is fully started
    if ("debug" in argv) {
        require("./debug").start();
    }
});

exports.engine = engine;
