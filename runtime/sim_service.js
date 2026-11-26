/*
 * runtime/sim_service.js
 *
 * File simulation, run outside the engine process.
 *
 * Turning an OpenSBP file into g-code (for the previewer and the job
 * thumbnail) and scanning a file for its bounds (soft-limit badge, keep-out
 * check, ghost-run Z lift) both mean running the whole file through the
 * OpenSBP runtime in simulation. That is pure computation and takes seconds on
 * a large job. Done inside the engine it holds the event loop for that long:
 * status stops reaching the dashboard, requests queue up, a freshly submitted
 * job is slow to appear.
 *
 * This module hands the work to a child process (sim_worker.js). The child is
 * started on first use, handles one request at a time, and exits after sitting
 * idle. Each request carries a snapshot of the configuration the simulation
 * reads, so the child never touches the engine's config files or its state.
 *
 * If the child cannot be started, dies, or reports an error, the request is
 * run in-process the way it always was, so a problem with the child costs
 * speed, never a working preview or bounds check.
 *
 *   simulate(request, callback)
 *     request:  { kind: "sbp" | "gcode",
 *                 file: path  |  code: string,
 *                 start: { x, y, z },          (sbp only; default 0,0,0)
 *                 want: { gcode: bool, bounds: bool } }
 *     callback: (err, { gcode, bounds, partial, durationMs })
 */
var fs = require("fs");
var path = require("path");
var child_process = require("child_process");
var log = require("../log").logger("sim");

var WORKER_PATH = path.join(__dirname, "sim_worker.js");
var IDLE_EXIT_MS = 60 * 1000; // free the child's memory when previews stop
var REQUEST_TIMEOUT_MS = 3 * 60 * 1000; // a stuck simulation is killed

var worker = null;
var workerBroken = false; // could not be started: stop trying, stay in-process
var queue = [];
var active = null;
var nextId = 1;
var idleTimer = null;

// ---------------------------------------------------------------------------
// The work itself. Runs in the child normally, and here as the fallback.
// ---------------------------------------------------------------------------
function simulateLocal(req, callback) {
    var t0 = Date.now();
    var want = req.want || {};
    var bounds = require("./bounds");

    function finish(gcode, partial) {
        var result = { durationMs: 0 };
        if (partial) result.partial = true;
        try {
            if (want.bounds) result.bounds = bounds.scanGCodeBounds(gcode || "");
        } catch (e) {
            return callback(e);
        }
        if (want.gcode) result.gcode = gcode;
        result.durationMs = Date.now() - t0;
        callback(null, result);
    }

    function withCode(code) {
        if (req.kind !== "sbp") {
            return finish(code, false);
        }
        // Lazy require: the OpenSBP runtime is heavy and pulls in most of the
        // engine; bounds.js and friends must stay cheap to load.
        var SBPRuntime = require("./opensbp/opensbp").SBPRuntime;
        var start = req.start || {};
        try {
            new SBPRuntime().simulateString(
                code,
                Number(start.x) || 0,
                Number(start.y) || 0,
                Number(start.z) || 0,
                function (err, gcode, info) {
                    if (err) return callback(err);
                    finish(gcode, !!(info && info.partial));
                }
            );
        } catch (e) {
            callback(e);
        }
    }

    if (typeof req.code === "string") {
        return withCode(req.code);
    }
    fs.readFile(req.file, "utf8", function (err, data) {
        if (err) return callback(err);
        withCode(data);
    });
}

// ---------------------------------------------------------------------------
// Child process management
// ---------------------------------------------------------------------------

// The configuration the simulation reads, as plain data for the child.
function configSnapshot() {
    var config = require("../config");
    var snap = {};
    ["opensbp", "machine", "driver", "engine", "instance"].forEach(function (name) {
        var branch = config[name];
        snap[name] = (branch && branch._cache) || {};
    });
    return snap;
}

function startWorker() {
    if (worker || workerBroken) return worker;
    try {
        worker = child_process.fork(WORKER_PATH, [], {
            // The child logs like the engine does; keep that out of the
            // engine's own output. Errors come back in the reply.
            stdio: ["ignore", "ignore", "ignore", "ipc"],
            serialization: "advanced",
        });
    } catch (e) {
        log.warn("Could not start the simulation process (" + e.message + "); simulating in the engine instead.");
        workerBroken = true;
        worker = null;
        return null;
    }
    var mine = worker;
    mine.on("message", function (msg) {
        if (!active || !msg || msg.id !== active.id) return;
        var job = active;
        settle();
        if (msg.error) {
            // Could be a real problem with the file or one peculiar to the
            // child. Either way the in-process run gives the engine's answer.
            log.warn("Simulation process reported: " + msg.error + " — repeating in the engine.");
            return simulateLocal(job.req, job.callback);
        }
        job.callback(null, msg.result);
    });
    mine.on("error", function (err) {
        log.warn("Simulation process error: " + err.message);
    });
    mine.on("exit", function (code, signal) {
        if (worker === mine) worker = null;
        if (active && active.worker === mine) {
            var job = active;
            settle();
            if (!job.timedOut) {
                log.warn(
                    "Simulation process ended early (code " + code + ", signal " + signal +
                        "); repeating in the engine."
                );
                return simulateLocal(job.req, job.callback);
            }
        }
        pump();
    });
    return worker;
}

// Clear the active request and move on to the next one.
function settle() {
    if (active && active.timer) clearTimeout(active.timer);
    active = null;
    setImmediate(pump);
}

function armIdleExit() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
        if (!active && !queue.length && worker) {
            worker.kill();
        }
    }, IDLE_EXIT_MS);
    if (idleTimer.unref) idleTimer.unref();
}

function pump() {
    if (active) return;
    var job = queue.shift();
    if (!job) return armIdleExit();

    var w = startWorker();
    if (!w) {
        setImmediate(pump);
        return simulateLocal(job.req, job.callback);
    }
    active = job;
    job.worker = w;
    job.timer = setTimeout(function () {
        job.timedOut = true;
        log.warn("Simulation timed out after " + REQUEST_TIMEOUT_MS / 1000 + " s; stopping it.");
        var cb = job.callback;
        try {
            w.kill("SIGKILL");
        } catch (e) {
            /* already gone */
        }
        cb(new Error("Simulation timed out."));
    }, REQUEST_TIMEOUT_MS);
    try {
        w.send({ id: job.id, req: job.req, config: configSnapshot() });
    } catch (e) {
        settle();
        log.warn("Could not reach the simulation process (" + e.message + "); simulating in the engine instead.");
        simulateLocal(job.req, job.callback);
    }
}

function simulate(req, callback) {
    var called = false;
    var once = function (err, result) {
        if (called) return;
        called = true;
        callback(err, result);
    };
    queue.push({ id: nextId++, req: req, callback: once });
    pump();
}

// Stop the child (engine shutdown, tests).
function shutdown() {
    if (idleTimer) clearTimeout(idleTimer);
    if (worker) {
        try {
            worker.kill();
        } catch (e) {
            /* already gone */
        }
    }
}

exports.simulate = simulate;
exports.simulateLocal = simulateLocal;
exports.shutdown = shutdown;
