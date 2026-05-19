var db = require("../db");
var util = require("../util");
var log = require("../log").logger("routes");
var machine = require("../machine").machine;
var config = require("../config");
var bounds = require("../runtime/bounds");
var fs = require("fs");
var os = require("os");
var path = require("path");
var upload = require("./util").upload;

// Background-compute bounds + soft-limit violation flag for a freshly
// submitted job and persist them on the job record. Runs after we've
// already responded to the client so submit latency is unaffected; the
// dashboard learns of the result via the `change` event from job.save().
function analyzeJobBounds(job) {
    if (!job || !job._id) return;
    db.Job.getFileForJobId(job._id, function (err, file) {
        if (err || !file || !file.path) {
            return log.warn("analyzeJobBounds: file lookup failed: " + (err || "no file"));
        }
        bounds.computeFileBounds(file.path, function (err, result) {
            if (err) {
                log.warn("analyzeJobBounds: " + err.message);
                return;
            }
            var envelope = config.machine.get("envelope") || {};
            var g55 = {
                x: config.driver.get("g55x") || 0,
                y: config.driver.get("g55y") || 0,
                z: config.driver.get("g55z") || 0,
            };
            var check = bounds.checkAgainstEnvelope(result.bounds, envelope, g55);
            db.Job.getById(job._id, function (err, fresh) {
                if (err || !fresh) return;
                // Only persist work-coord bounds; the dashboard re-evaluates
                // violations live against current envelope + g55 so the badge
                // stays correct after VA/ZT/Z* offset changes (see job_manager.js
                // and runtime/opensbp/commands/location.js).
                fresh.bounds = result.bounds;
                fresh.save(function () {});
                log.info(
                    "Bounds for job " + job._id + ": exceeds=" + check.exceeds +
                    " (" + result.durationMs + "ms) bounds=" + JSON.stringify(result.bounds) +
                    " env=" + JSON.stringify(envelope) + " g55=" + JSON.stringify(g55)
                );
            });
        });
    });
}

var submitJob = function (req, res, next) {
    upload(req, res, next, function (err, upload) {
        log.info("entering submitJob.upload.callback");
        var uploads = upload.files;
        // Single file only, for now
        if (uploads.length > 1) {
            log.warn("Got an upload of " + uploads.length + " files for a submitted job when only one is allowed.");
        }

        // eslint-disable-next-line no-undef
        async.eachOf(
            uploads,
            function create_job(item, index, callback) {
                var file = item.file;
                var filename = item.filename || !file.name || file.name === "blob" ? item.filename : file.name;
                item.filename = filename;
                item.name = item.name || filename;
                item.index = index;

                // Reject disallowed files
                if (!util.allowed_file(filename)) {
                    return callback(new Error("File " + filename + " is not allowed."));
                }

                // Create a job and respond
                db.createJob(file, item, function (err, job) {
                    callback(err, job);
                    if (!err && job) analyzeJobBounds(job);
                });
            }, // create_job
            function on_complete(err, jobs) {
                log.info("Just completed upload of " + uploads.length + " jobs.");
                if (err) {
                    log.error(err.message);
                    return res.json({
                        status: "error",
                        message: err.message,
                    });
                }
                return res.json({
                    status: "success",
                    data: {
                        status: "complete",
                        data: { jobs: jobs },
                    },
                });
            }
        ); // on_complete
    }); // async.map
}; // submitJob

/**
 * @api {delete} /jobs/queue Clear job queue
 * @apiGroup Jobs
 * @apiDescription Empty the job queue of all pending jobs.
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data null
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */

// eslint-disable-next-line no-unused-vars
var clearQueue = function (req, res, next) {
    var answer;
    db.Job.deletePending(function (err) {
        if (err) {
            answer = {
                status: "error",
                message: err,
            };
            res.json(answer);
        } else {
            answer = {
                status: "success",
                data: null,
            };
            res.json(answer);
        }
    });
};

/**
 * @apiGroup Jobs
 * @api {post} /jobs/queue/run Run next job in queue
 * @apiDescription Runs the next job in the queue if able.
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data null
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
// eslint-disable-next-line no-unused-vars
var runNextJob = function (req, res, next) {
    var answer;
    log.info("Running the jobs.js:nextJob in the queue");
    machine.runNextJob(function (err, job) {
        if (err) {
            log.error(err);
            answer = {
                status: "failed",
                data: { job: err },
            };
            res.json(answer);
        } else {
            answer = {
                status: "success",
                data: { job: job },
            };
            res.json(answer);
        }
    });
};

/**
 * @apiGroup Jobs
 * @api {post} /jobs/:id Resubmit job
 * @apiDescription Submit a new job identical to the one specified.  Used to re-run completed jobs without modification.
 * @apiParam {String} id ID of job to resubmit
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data null
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
// eslint-disable-next-line no-unused-vars
var resubmitJob = function (req, res, next) {
    var answer;
    log.debug("Resubmitting job " + req.params.id);
    db.Job.getById(req.params.id, function (err, result) {
        if (err) {
            log.error(JSON.stringify(err));
            answer = {
                status: "error",
                message: err,
            };
            return res.json(answer);
        }
        result.clone(function (err, result) {
            log.debug("Cloned!");
            if (err) {
                log.error(err);
                answer = {
                    status: "failed",
                    data: { job: err },
                };
                res.json(answer);
            } else {
                answer = {
                    status: "success",
                    data: { job: result },
                };
                res.json(answer);
            }
        });
    });
};

/**
 * @apiGroup Jobs
 * @api {get} /jobs/queue Job queue
 * @apiDescription Get a list of all the pending jobs currently in the queue.
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data Response data
 * @apiSuccess {Object[]} data.jobs List of all jobs
 * @apiSuccess {Number} data.jobs._id Unique job ID
 * @apiSuccess {String} data.jobs.state `pending` | `running` | `finished` | `cancelled`
 * @apiSuccess {String} data.jobs.name Human readable job name
 * @apiSuccess {String} data.jobs.description Job description
 * @apiSuccess {Number} data.jobs.created_at Time job was added to the queue (UNIX timestamp)
 * @apiSuccess {Number} data.jobs.started_at Time job was started (UNIX timestamp)
 * @apiSuccess {Number} data.jobs.finished_at Time job was finished (UNIX timestamp)
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
// eslint-disable-next-line no-unused-vars
var getQueue = function (req, res, next) {
    db.Job.getPending(function (err, pending) {
        if (err) {
            log.error(err);
            return res.json({
                status: "error",
                message: "failed to get pending jobs from DB",
            });
        }

        db.Job.getRunning(function (err, running) {
            if (err) {
                log.error(err);
                return res.json({
                    status: "error",
                    message: "failed to get running jobs from DB",
                });
            }

            return res.json({
                status: "success",
                data: {
                    jobs: {
                        pending: pending,
                        running: running,
                    },
                },
            });
        });
    });
};

/**
 * @apiGroup Jobs
 * @api {get} /jobs List all jobs
 * @apiDescription Get a list of all jobs, including those that are pending, currently running, and finished.
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data Response data
 * @apiSuccess {Object[]} data.jobs List of all jobs
 * @apiSuccess {Number} data.jobs._id Unique job ID
 * @apiSuccess {String} data.jobs.state `pending` | `running` | `finished` | `cancelled`
 * @apiSuccess {String} data.jobs.name Human readable job name
 * @apiSuccess {String} data.jobs.description Job description
 * @apiSuccess {Number} data.jobs.created_at Time job was added to the queue (UNIX timestamp)
 * @apiSuccess {Number} data.jobs.started_at Time job was started (UNIX timestamp)
 * @apiSuccess {Number} data.jobs.finished_at Time job was finished (UNIX timestamp)
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
// eslint-disable-next-line no-unused-vars
var getAllJobs = function (req, res, next) {
    var answer;
    db.Job.getAll(function (err, result) {
        if (err) {
            log.error(err);
            answer = {
                status: "error",
                message: "failed to get jobs from DB",
            };
            res.json(answer);
        } else {
            answer = {
                status: "success",
                data: { jobs: result },
            };
            res.json(answer);
        }
    });
};

/**
 * @apiGroup Jobs
 * @api {get} /jobs/history List jobs in the history
 * @apiDescription Get a list of all jobs in the history. (This does not include the currently running job, or any jobs in the queue)
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data Response data
 * @apiSuccess {Object[]} data.jobs List of all jobs
 * @apiSuccess {Number} data.jobs._id Unique job ID
 * @apiSuccess {String} data.jobs.state `pending` | `running` | `finished` | `cancelled`
 * @apiSuccess {String} data.jobs.name Human readable job name
 * @apiSuccess {String} data.jobs.description Job description
 * @apiSuccess {Number} data.jobs.created_at Time job was added to the queue (UNIX timestamp)
 * @apiSuccess {Number} data.jobs.started_at Time job was started (UNIX timestamp)
 * @apiSuccess {Number} data.jobs.finished_at Time job was finished (UNIX timestamp)
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
// eslint-disable-next-line no-unused-vars
var getQueueAndHistory = function (req, res, next) {
    var options = {
        start: req.params.start || 0,
        count: req.params.count || 10,
    };

    db.Job.getQueueAndHistory(options, function (err, result) {
        if (err) {
            log.error(err);
            return res.json({
                status: "error",
                message: "failed to get jobs from DB",
            });
        }
        return res.json({
            status: "success",
            data: result,
        });
    });
};

var getJobHistory = function (req, res, next) {
    var answer;
    var options = {
        start: req.params.start || 0,
        count: req.params.count || 0,
    };

    db.Job.getHistory(options, function (err, result) {
        if (err) {
            log.error(err);
            answer = {
                status: "error",
                message: "failed to get jobs from DB",
            };
            res.json(answer);
        } else {
            answer = {
                status: "success",
                data: { jobs: result },
            };
            res.json(answer);
        }
    });
};

/**
 * @apiGroup Jobs
 * @api {get} /jobs/:id Job info
 * @apiDescription Get detailed information about a specific job.
 * @apiParam {String} id ID of requested job
 * @apiSuccess {Object} data Response data
 * @apiSuccess {Object} data.job Requested job
 * @apiSuccess {Number} data.job._id Unique job ID
 * @apiSuccess {String} data.job.state `pending` | `running` | `finished` | `cancelled`
 * @apiSuccess {String} data.job.name Human readable job name
 * @apiSuccess {String} data.job.description Job description
 * @apiSuccess {Number} data.job.created_at Time job was added to the queue (UNIX timestamp)
 * @apiSuccess {Number} data.job.started_at Time job was started (UNIX timestamp)
 * @apiSuccess {Number} data.job.finished_at Time job was finished (UNIX timestamp)
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
// eslint-disable-next-line no-unused-vars
var getJobById = function (req, res, next) {
    var answer;
    db.Job.getById(req.params.id, function (err, job) {
        if (err) {
            answer = {
                status: "fail",
                data: { job: err },
            };
            return res.json(answer);
        }
        db.File.getByID(job.file_id, function (err, file) {
            if (err) {
                job.file = {};
            } else {
                job.file = file;
            }
            answer = {
                status: "success",
                data: { job: job },
            };
            res.json(answer);
        });
    });
};

/**
 * @apiGroup Jobs
 * @api {delete} /jobs/:id Cancel job
 * @apiDescription Cancel a pending job.
 * @apiParam {String} id ID of job to cancel
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data null
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
// eslint-disable-next-line no-unused-vars
var cancelJob = function (req, res, next) {
    var answer;
    db.Job.getById(req.params.id, function (err, result) {
        if (err) {
            log.error(err);
            answer = {
                status: "fail",
                data: { job: err },
            };
            res.json(answer);
        } else {
            result.cancelOrTrash(function (err, result) {
                if (err) {
                    log.error(err);
                    answer = {
                        status: "fail",
                        data: { job: err },
                    };
                    res.json(answer);
                } else {
                    answer = {
                        status: "success",
                        data: { job: result },
                    };
                    res.json(answer);
                }
            });
        }
    });
};

// eslint-disable-next-line no-unused-vars
var updateOrder = function (req, res, next) {
    var answer;
    var order = parseInt(req.params.order);
    var id = parseInt(req.params.id);
    db.Job.getById(id, function (err, result) {
        if (err) {
            answer = {
                status: "fail",
                data: { job: err },
            };
            return res.json(answer);
        } else {
            result.update_order(order, function (err, result) {
                if (err) {
                    log.error(err);
                    answer = {
                        status: "fail",
                        data: { job: err },
                    };
                    res.json(answer);
                } else {
                    answer = {
                        status: "success",
                        data: { job: result },
                    };
                    res.json(answer);
                }
            });
        }
    });
};

// eslint-disable-next-line no-unused-vars
var getJobFile = function (req, res, next) {
    db.Job.getFileForJobId(req.params.id, function (err, file) {
        if (err) {
            log.error(err);
            var answer = {
                status: "fail",
                data: { file: err },
            };
            res.json(answer);
        } else {
            fs.readFile(file.path, function (err, data) {
                res.header("Content-Type", "text/plain");
                res.header("Content-Disposition", 'attachment; filename="' + file.filename + '"');
                res.status(200);
                res.write(data);
                res.end();
            });
        }
    });
};

// eslint-disable-next-line no-unused-vars
var getJobGCode = function (req, res, next) {
    db.Job.getFileForJobId(req.params.id, function (err, file) {
        if (err) {
            log.error(err);
            var answer = {
                status: "fail",
                data: { file: err },
            };
            res.json(answer);
        } else {
            var gcode_filename = "gcode.nc";
            machine.getGCodeForFile(file.path, function (err, gcode) {
                if (err) {
                    return res.send(403, err.message);
                }
                res.setHeader("content-type", "applications/octet-stream");
                res.setHeader("content-disposition", 'filename="' + gcode_filename + '"');
                res.send(gcode);
            });
        }
    });
};

// eslint-disable-next-line no-unused-vars
var setJobRepeat = function (req, res, next) {
    var body = req.body || {};
    var desired = typeof body.repeat !== "undefined" ? !!body.repeat : null;
    // count: integer = total runs (incl current), null = indefinite, absent =
    // don't touch existing value. Negative/zero/NaN coerces to null.
    var countProvided = Object.prototype.hasOwnProperty.call(body, "count");
    var rawCount = body.count;
    var parsedCount = null;
    if (countProvided && rawCount !== null && rawCount !== "") {
        var n = parseInt(rawCount, 10);
        parsedCount = isFinite(n) && n >= 1 ? n : null;
    }
    db.Job.getById(req.params.id, function (err, job) {
        if (err || !job) {
            return res.json({ status: "error", message: err || "Job not found" });
        }
        job.repeat = desired === null ? !job.repeat : desired;
        if (!job.repeat) {
            job.repeatCount = null;
        } else if (countProvided) {
            job.repeatCount = parsedCount;
        }
        job.save(function (saveErr, saved) {
            if (saveErr) {
                return res.json({ status: "error", message: saveErr });
            }
            // If the toggled job is currently running, the machine holds its
            // own in-memory copy loaded at job start. Mirror the change there
            // so a mid-run toggle takes effect when finish() decides whether
            // to auto-restart (and so finish()'s save doesn't overwrite the
            // toggled DB value with the stale in-memory one).
            if (
                machine &&
                machine.status &&
                machine.status.job &&
                String(machine.status.job._id) === String(saved._id)
            ) {
                machine.status.job.repeat = saved.repeat;
                machine.status.job.repeatCount = saved.repeatCount;
            }
            res.json({ status: "success", data: { job: saved } });
        });
    });
};

// Build a tiny SBP file that drives around the X/Y bounding rectangle of
// `bnds` (work coords) at the configured jog rate. Starts with an SK prompt
// so the operator can raise Z to a safe height before any motion. Visits the
// four corners starting from whichever is nearest to (curX, curY), traces
// the rectangle, returns to that corner, then back to the original XY.
function buildPerimeterSBP(bnds, curX, curY) {
    var x0 = bnds.min.x, x1 = bnds.max.x;
    var y0 = bnds.min.y, y1 = bnds.max.y;
    // Corners in walk-order around the rectangle.
    var ring = [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
    ];
    var startIdx = 0, best = Infinity;
    for (var i = 0; i < 4; i++) {
        var dx = ring[i].x - curX, dy = ring[i].y - curY;
        var d = dx * dx + dy * dy;
        if (d < best) { best = d; startIdx = i; }
    }
    var lines = [
        "'Generated by FabMo ghost-run (perimeter trace)",
        'SK,"Move Z to safe height before starting motion"',
    ];
    for (var k = 0; k <= 4; k++) {
        var p = ring[(startIdx + k) % 4];
        lines.push("J2," + p.x.toFixed(4) + "," + p.y.toFixed(4));
    }
    lines.push("J2," + curX.toFixed(4) + "," + curY.toFixed(4));
    return lines.join("\n") + "\n";
}

// eslint-disable-next-line no-unused-vars
var ghostRunJob = function (req, res, next) {
    var fail = function (msg) {
        return res.json({ status: "error", message: msg });
    };
    if (!machine || !machine.isConnected || !machine.isConnected()) {
        return fail("Machine not connected");
    }
    if (machine.status.state !== "idle") {
        return fail("Machine is not idle (state=" + machine.status.state + ")");
    }
    var body = req.body || {};
    var mode = body.mode || "lift";

    db.Job.getById(req.params.id, function (err, original) {
        if (err || !original) return fail(err || "Job not found");

        if (mode === "trace") return runPerimeterTrace(original, res, fail);
        if (mode === "lift") return runLiftGhost(original, body, res, fail);
        return fail("Unknown ghost mode: " + mode);
    });
};

function runLiftGhost(original, body, res, fail) {
    var zOffset = parseFloat(body.zOffset);
    if (!isFinite(zOffset) || zOffset === 0) {
        return fail("Invalid zOffset");
    }

    // SBP only — gcode runtime ignores transforms entirely
    if (!/\.sbp$/i.test(original.name || "")) {
        return fail("Lift mode is only available for OpenSBP (.sbp) jobs");
    }

    var transforms = config.opensbp.get("transforms") || {};
    var currentMove = transforms.move || { apply: false, x: 0, y: 0, z: 0 };
    var snapshot = {
        apply: !!currentMove.apply,
        x: currentMove.x || 0,
        y: currentMove.y || 0,
        z: currentMove.z || 0,
    };
    var newMove = {
        apply: true,
        x: snapshot.x,
        y: snapshot.y,
        z: snapshot.z + zOffset,
    };

    config.opensbp.setMany({ transforms: { move: newMove } }, function (setErr) {
        if (setErr) return fail("Failed to set transform: " + setErr);

        var ghostJob = new db.Job({
            file_id: original.file_id,
            name: original.name + " (ghost)",
            description: (original.description ? original.description + " — " : "") +
                "ghost run, Z+" + zOffset,
            ghost: true,
            ghost_restore_move: snapshot,
        });
        ghostJob.save(function (saveErr, saved) {
            if (saveErr) return fail(saveErr);
            saved.start(function (startErr) {
                if (startErr) return fail(startErr);
                machine.runJob(saved);
                res.json({ status: "success", data: { job: saved } });
            });
        });
    });
}

function runPerimeterTrace(original, res, fail) {
    var b = original.bounds;
    if (!b || !b.min || !b.max ||
        !isFinite(b.min.x) || !isFinite(b.max.x) ||
        !isFinite(b.min.y) || !isFinite(b.max.y) ||
        b.max.x < b.min.x || b.max.y < b.min.y) {
        return fail("Job bounds unavailable — cannot trace perimeter");
    }
    // A line cut (zero extent in one axis) is fine — the rectangle
    // collapses and J2 commands drive back and forth along it. Only
    // reject a true single point.
    if (b.max.x === b.min.x && b.max.y === b.min.y) {
        return fail("Job has zero X/Y extent — nothing to trace");
    }
    var curX = (machine.status && isFinite(machine.status.posx)) ? machine.status.posx : b.min.x;
    var curY = (machine.status && isFinite(machine.status.posy)) ? machine.status.posy : b.min.y;
    var sbp = buildPerimeterSBP(b, curX, curY);

    var tmpPath = path.join(os.tmpdir(), "fabmo_trace_" + Date.now() + ".sbp");
    fs.writeFile(tmpPath, sbp, function (writeErr) {
        if (writeErr) return fail("Failed to write trace file: " + writeErr.message);

        db.File.add(original.name.replace(/\.[^.]+$/, "") + "_trace.sbp", tmpPath, function (addErr, dbfile) {
            // File.add moves/cleans the source; nothing to unlink here.
            if (addErr || !dbfile) return fail("Failed to store trace file: " + (addErr || "unknown"));

            var ghostJob = new db.Job({
                file_id: dbfile._id,
                name: original.name + " (perimeter trace)",
                description: (original.description ? original.description + " — " : "") +
                    "perimeter trace of bounds X[" + b.min.x.toFixed(2) + "," + b.max.x.toFixed(2) +
                    "] Y[" + b.min.y.toFixed(2) + "," + b.max.y.toFixed(2) + "]",
                ghost: true,
            });
            ghostJob.save(function (saveErr, saved) {
                if (saveErr) return fail(saveErr);
                saved.start(function (startErr) {
                    if (startErr) return fail(startErr);
                    machine.runJob(saved);
                    res.json({ status: "success", data: { job: saved } });
                });
            });
        });
    });
}

module.exports = function (server) {
    server.post("/job", submitJob);
    server.get("/jobs", getAllJobs);
    server.get("/job/:id", getJobById);
    server.del("/job/:id", cancelJob);
    server.patch("/job/:id", updateOrder);
    // More-specific :id sub-paths must register before the bare /:id route so
    // restify matches them first.
    server.post("/job/:id/repeat", setJobRepeat);
    server.post("/job/:id/ghost", ghostRunJob);
    server.get("/job/:id/file", getJobFile);
    server.get("/job/:id/gcode", getJobGCode);
    server.post("/job/:id", resubmitJob);
    //server.get('/job/:id/thumbnail', getThumbnailImage);

    server.get("/jobs/queue", getQueue);
    server.del("/jobs/queue", clearQueue);
    server.post("/jobs/queue/run", runNextJob);
    server.get("/jobs/history", getJobHistory);
    server.get("/jobs/queue-and-history", getQueueAndHistory);
};
