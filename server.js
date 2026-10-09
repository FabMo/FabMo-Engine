/*
 * server.js
 *
 * Engine server module.
 *
 * This is the entry point for the fabmo engine.  It just starts the engine.
 */
// Bind the web port immediately — BEFORE the (slow) engine module tree is
// require()'d — and serve a "FabMo is starting…" page, so the browser shows
// progress instead of connection-refused during the cold-boot window. The
// engine hands the port over to the real server at the end of startup.
var bootSplash = require("./boot_splash");
bootSplash.start(function () {
    bootSplash.setStatus("Loading engine…");
});

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
