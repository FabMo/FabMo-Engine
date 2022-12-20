/*
 * server.js
 *
 * Engine server module.
 *
 * This is the entry point for the fabmo engine.  It just starts the engine.
 */
var config = require("./config");
var log = require("./log").logger("server");
var engine = require("./engine");
var argv = require("minimist")(process.argv);

engine.start(function (err, data) {
    // Start the debug monitor if requested, but only after the engine is fully started
    if ("debug" in argv) {
        require("./debug").start();
    }
});

exports.engine = engine;
