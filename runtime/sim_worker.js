/*
 * runtime/sim_worker.js
 *
 * Child process that runs file simulations for the engine (see
 * sim_service.js). It has no machine, no driver and no database: it loads the
 * OpenSBP runtime, is handed the configuration as plain data with each
 * request, runs the simulation and sends the result back.
 *
 * Nothing here may write to the engine's files. The config branches are
 * stand-ins that keep changes in memory, and the engine's log/exit handlers
 * (which save and rotate the engine's logs) are removed.
 */
var log = require("../log");

// log.js installs handlers that save and rotate the ENGINE's log files on an
// uncaught exception or SIGINT. This process must never do that.
["exit", "SIGINT", "uncaughtException"].forEach(function (evt) {
    process.removeAllListeners(evt);
});
try {
    log.setGlobalLevel("warn");
} catch (e) {
    /* logging is best-effort here */
}

var config = require("../config");
var Config = require("../config/config").Config;
var OpenSBPConfig = require("../config/opensbp_config").OpenSBPConfig;
var extend = require("../util").extend;
var macros = require("../macros");
var service = require("./sim_service");
var SBPRuntime = require("./opensbp/opensbp").SBPRuntime;

// The OpenSBP command set is attached to the runtime's prototype by an
// explicit step at engine start-up. Do the same here, once.
new SBPRuntime().loadCommands(function () {});

// Make a config branch that answers reads from the snapshot and keeps any
// write in memory only.
function standIn(branch, cache) {
    branch._cache = cache || {};
    branch.update = function (data, callback, force) {
        try {
            if (data && data.variables && typeof data.variables === "object") {
                if (!this._cache.variables) this._cache.variables = {};
                extend(this._cache.variables, data.variables, true);
            }
            extend(this._cache, data || {}, force === undefined ? true : force);
        } catch (e) {
            if (callback) return callback(e);
            return;
        }
        if (callback) setImmediate(callback, null, data);
    };
    branch.setMany = branch.update;
    branch.save = function (callback) {
        if (callback) setImmediate(callback, null);
    };
    branch.load = function (filename, callback) {
        if (callback) setImmediate(callback, null, this._cache);
    };
    branch.apply = function (callback) {
        if (callback) setImmediate(callback, null);
    };
    branch.init = function () {
        var cb = arguments[arguments.length - 1];
        if (typeof cb === "function") setImmediate(cb, null);
    };
    return branch;
}

function installConfig(snapshot) {
    snapshot = snapshot || {};
    config.opensbp = standIn(new OpenSBPConfig(), snapshot.opensbp);
    config.machine = standIn(new Config("machine"), snapshot.machine);
    config.machine.applyLimitInputActions = function () {};
    config.driver = standIn(new Config("g2"), snapshot.driver);
    config.engine = standIn(new Config("engine"), snapshot.engine);
    config.instance = standIn(new Config("instance"), snapshot.instance);
}

function reply(id, err, result) {
    var msg = { id: id };
    if (err) {
        msg.error = (err && err.message) || String(err);
    } else {
        msg.result = result;
    }
    try {
        process.send(msg);
    } catch (e) {
        process.exit(1);
    }
}

process.on("message", function (msg) {
    if (!msg || !msg.req) return;
    var done = false;
    var finish = function (err, result) {
        if (done) return;
        done = true;
        reply(msg.id, err, result);
    };
    try {
        installConfig(msg.config);
        // Macros can be edited between requests; a file that calls one must
        // see the current text.
        macros.load(function () {
            try {
                service.simulateLocal(msg.req, finish);
            } catch (e) {
                finish(e);
            }
        });
    } catch (e) {
        finish(e);
    }
});

// A simulation that throws outside its callback would otherwise leave the
// engine waiting for the timeout. Exit; the engine repeats the request itself.
process.on("uncaughtException", function () {
    process.exit(1);
});

// If the engine goes away, so does this process.
process.on("disconnect", function () {
    process.exit(0);
});
